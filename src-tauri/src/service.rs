use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU16, Ordering},
        Mutex, TryLockError,
    },
    thread,
    time::{Duration, Instant},
};

pub const PORT: u16 = 25252;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSettings {
    pub port: u16,
}
impl Default for LaunchSettings {
    fn default() -> Self {
        Self { port: PORT }
    }
}
impl LaunchSettings {
    fn validate(&self) -> Result<(), String> {
        if self.port < 1024 {
            Err("端口必须是 1024–65535 之间的整数".into())
        } else {
            Ok(())
        }
    }
}

const REVISION: &str = "7e8663cd9c184a550b37238218bdd32c6efc68e9";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: &'static str,
    pub url: String,
    pub lan_urls: Vec<String>,
    data_dir: String,
    bundled: bool,
}

pub struct Service {
    resources: PathBuf,
    data: PathBuf,
    child: Mutex<Option<Child>>,
    updating: AtomicBool,
    shutting_down: AtomicBool,
    port: AtomicU16,
    remote: Mutex<Option<RemoteProcess>>,
}

struct RemoteProcess {
    gateway: Child,
    tunnel: Option<Child>,
    _files: tempfile::TempDir,
    public_url: String,
}
impl Drop for RemoteProcess {
    fn drop(&mut self) {
        // Close the protected ingress first, even if the relay is unresponsive.
        terminate(&mut self.gateway);
        if let Some(child) = self.tunnel.as_mut() {
            terminate(child);
        }
    }
}

impl Service {
    pub fn new(resources: PathBuf, data: PathBuf) -> Self {
        Self {
            resources,
            data,
            child: Mutex::new(None),
            updating: AtomicBool::new(false),
            shutting_down: AtomicBool::new(false),
            port: AtomicU16::new(PORT),
            remote: Mutex::new(None),
        }
    }

    fn snapshot(&self, phase: &'static str) -> Status {
        Status {
            phase,
            url: format!("http://127.0.0.1:{}", self.port.load(Ordering::SeqCst)),
            lan_urls: if phase == "running" {
                lan_urls(self.port.load(Ordering::SeqCst))
            } else {
                Vec::new()
            },
            data_dir: self.data.to_string_lossy().into_owned(),
            bundled: self.resources.join("manifest.json").is_file(),
        }
    }

    pub fn status(&self) -> Result<Status, String> {
        match self.child.try_lock() {
            Ok(mut guard) => {
                if let Some(child) = guard.as_mut() {
                    if child
                        .try_wait()
                        .map_err(|_| "无法读取酒馆进程状态")?
                        .is_none()
                    {
                        return Ok(self.snapshot("running"));
                    }
                    self.close_remote();
                    *guard = None;
                }
                Ok(self.snapshot("stopped"))
            }
            Err(TryLockError::WouldBlock) => Ok(self.snapshot("starting")),
            Err(TryLockError::Poisoned(_)) => Err("酒馆状态异常，请重新启动小厨".into()),
        }
    }

    pub fn remote_status(&self) -> Result<crate::remote::RemoteStatus, String> {
        let mut remote = self.remote.lock().map_err(|_| "远程访问状态异常")?;
        if let Some(active) = remote.as_mut() {
            let gateway_alive = active
                .gateway
                .try_wait()
                .map_err(|_| "无法读取访问入口状态")?
                .is_none();
            let tunnel_alive = match active.tunnel.as_mut() {
                Some(child) => child.try_wait().map_err(|_| "无法读取隧道状态")?.is_none(),
                None => false,
            };
            if gateway_alive && tunnel_alive {
                return Ok(crate::remote::RemoteStatus {
                    enabled: true,
                    public_url: active.public_url.clone(),
                    message:
                        "隧道进程运行中；开启时已验证 HTTPS 入口，当前网络可用性请以手机访问为准"
                            .into(),
                });
            }
            *remote = None;
            return Ok(crate::remote::disabled("隧道已退出，请检查配置后重新开启"));
        }
        Ok(crate::remote::disabled("远程访问已关闭"))
    }

    pub fn stop_remote(&self) -> Result<crate::remote::RemoteStatus, String> {
        self.remote.lock().map_err(|_| "远程访问状态异常")?.take();
        Ok(crate::remote::disabled("远程访问已关闭"))
    }

    fn close_remote(&self) {
        self.remote.lock().unwrap_or_else(|e| e.into_inner()).take();
    }

    pub fn start_remote(
        &self,
        request: crate::remote::RemoteRequest,
    ) -> Result<crate::remote::RemoteStatus, String> {
        let public_url = crate::remote::validate(&request)?;
        // Same lock order as stop/update/shutdown. No tunnel may outlive its service.
        let mut service = self.child.lock().map_err(|_| "酒馆状态异常")?;
        if self.updating.load(Ordering::SeqCst) || self.shutting_down.load(Ordering::SeqCst) {
            return Err("正在更新或退出，无法开启远程访问".into());
        }
        if !matches!(service.as_mut().map(|c| c.try_wait()), Some(Ok(None))) {
            return Err("请先启动酒馆".into());
        }
        let mut remote = self.remote.lock().map_err(|_| "远程访问状态异常")?;
        if remote.is_some() {
            return Err("请先关闭当前远程连接".into());
        }
        let executable = crate::remote::client(&self.data)?;
        if self.shutting_down.load(Ordering::SeqCst) {
            return Err("小厨正在退出".into());
        }
        let files = tempfile::Builder::new()
            .prefix("chef25-remote-")
            .tempdir()
            .map_err(|_| "无法创建临时配置目录")?;
        let marker = files
            .path()
            .file_name()
            .ok_or("无法创建验证标识")?
            .to_string_lossy()
            .into_owned();
        let mut command =
            Command::new(
                self.resources
                    .join(if cfg!(windows) { "node.exe" } else { "node" }),
            );
        command
            .args([
                "--input-type=module",
                "-e",
                include_str!("../../native/remote-gateway.mjs"),
            ])
            .env_remove("NODE_OPTIONS")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let gateway = command.spawn().map_err(|_| "无法启动受保护访问入口")?;
        let mut active = RemoteProcess {
            gateway,
            tunnel: None,
            _files: files,
            public_url: public_url.clone(),
        };
        let input = serde_json::json!({ "targetPort": self.port.load(Ordering::SeqCst), "password": request.password, "marker": marker });
        writeln!(
            active.gateway.stdin.as_mut().ok_or("入口配置管道不可用")?,
            "{input}"
        )
        .map_err(|_| "无法配置访问入口")?;
        let output = active.gateway.stdout.take().ok_or("入口状态管道不可用")?;
        let (sender, receiver) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(output).read_line(&mut line).map(|_| line);
            let _ = sender.send(result);
        });
        let line = receiver
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "访问入口启动超时")?
            .map_err(|_| "无法读取入口状态")?;
        let ready: serde_json::Value =
            serde_json::from_str(&line).map_err(|_| "访问入口状态无效")?;
        let port = ready["port"]
            .as_u64()
            .and_then(|p| u16::try_from(p).ok())
            .filter(|p| *p > 0)
            .ok_or("入口端口无效")?;
        let config =
            crate::remote::configuration(&request.configuration.replace("\r\n", "\n"), port)?;
        let config_path = active._files.path().join("frpc.ini");
        let mut file = fs::OpenOptions::new();
        file.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            file.mode(0o600);
        }
        file.open(&config_path)
            .and_then(|mut f| f.write_all(config.as_bytes()))
            .map_err(|_| "无法写入临时隧道配置")?;
        let mut command = Command::new(executable);
        command
            .arg("--config")
            .arg(&config_path)
            .arg("--noupdate")
            .current_dir(active._files.path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        active.tunnel = Some(
            command
                .spawn()
                .map_err(|_| "缺少 OpenFrp 客户端，请准备运行环境或安装新版小厨")?,
        );
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| "无法验证远程入口")?;
        let mut verified = false;
        for _ in 0..10 {
            if self.shutting_down.load(Ordering::SeqCst) {
                return Err("小厨正在退出".into());
            }
            if active
                .tunnel
                .as_mut()
                .ok_or("隧道未启动")?
                .try_wait()
                .map_err(|_| "无法读取隧道状态")?
                .is_some()
            {
                return Err("OpenFrp 启动失败，请核对 INI 配置、账号额度和节点状态".into());
            }
            if let Ok(response) = client.get(&public_url).send() {
                if response.status() == reqwest::StatusCode::UNAUTHORIZED
                    && response
                        .headers()
                        .get("x-chef25-gateway")
                        .and_then(|v| v.to_str().ok())
                        == Some(marker.as_str())
                {
                    verified = true;
                    break;
                }
            }
            thread::sleep(Duration::from_millis(500));
        }
        if !verified {
            return Err("HTTPS 入口验证失败，隧道已关闭。请确认域名和证书有效，且节点将 HTTPS 转发到此 HTTP 隧道".into());
        }
        if !matches!(service.as_mut().map(|c| c.try_wait()), Some(Ok(None))) {
            return Err("酒馆已停止，远程连接已取消".into());
        }
        *remote = Some(active);
        drop(remote);
        drop(service);
        self.remote_status()
    }

    pub fn settings(&self) -> Result<LaunchSettings, String> {
        match fs::read(self.data.join("launcher-settings.json")) {
            Ok(bytes) => {
                let settings: LaunchSettings = serde_json::from_slice(&bytes)
                    .map_err(|_| "启动设置损坏，请在设置页面重新保存")?;
                settings.validate()?;
                Ok(settings)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(LaunchSettings::default())
            }
            Err(_) => Err("无法读取启动设置".into()),
        }
    }

    pub fn save_settings(&self, settings: LaunchSettings) -> Result<(), String> {
        settings.validate()?;
        let mut guard = self
            .child
            .try_lock()
            .map_err(|_| "酒馆正在执行其他操作，请稍后重试")?;
        if let Some(child) = guard.as_mut() {
            if child
                .try_wait()
                .map_err(|_| "无法确认酒馆已停止")?
                .is_none()
            {
                return Err("请先停止酒馆，再修改启动端口".into());
            }
            *guard = None;
        }
        fs::create_dir_all(&self.data).map_err(|_| "无法创建设置目录")?;
        let bytes = serde_json::to_vec_pretty(&settings).map_err(|_| "无法保存启动设置")?;
        let temporary = self.data.join("launcher-settings.json.tmp");
        fs::write(&temporary, bytes).map_err(|_| "无法写入启动设置")?;
        fs::rename(temporary, self.data.join("launcher-settings.json"))
            .map_err(|_| "无法保存启动设置".to_string())
    }

    pub fn reset(&self, confirmation: &str) -> Result<(), String> {
        if confirmation != "确认重置" {
            return Err("请输入完整的确认文字：确认重置".into());
        }
        let mut guard = self
            .child
            .try_lock()
            .map_err(|_| "酒馆正在执行其他操作，请稍后重试")?;
        if self.updating.load(Ordering::SeqCst) {
            return Err("正在安装更新，不能重置".into());
        }
        if let Some(child) = guard.as_mut() {
            if child
                .try_wait()
                .map_err(|_| "无法确认酒馆已停止")?
                .is_none()
            {
                return Err("请先停止酒馆，再执行重置".into());
            }
            *guard = None;
        }
        // Refuse a possibly orphaned service; never kill an unknown port owner.
        let port = self
            .settings()
            .map(|settings| settings.port)
            .unwrap_or(PORT);
        let _reservation = reserve_port(port)?;
        crate::storage::reset(&self.data)?;
        // The launch port is a user preference and survives a data reset.
        self.port.store(port, Ordering::SeqCst);
        Ok(())
    }

    pub fn transfer(
        &self,
        importing: bool,
        confirmation: &str,
        path: &Path,
    ) -> Result<String, String> {
        crate::backup::confirm(importing, confirmation)?;
        let mut guard = self
            .child
            .try_lock()
            .map_err(|_| "酒馆正在执行其他操作，请稍后重试")?;
        if self.updating.load(Ordering::SeqCst) || self.shutting_down.load(Ordering::SeqCst) {
            return Err("正在更新或退出，无法导入导出".into());
        }
        if let Some(child) = guard.as_mut() {
            if child
                .try_wait()
                .map_err(|_| "无法确认酒馆已停止")?
                .is_none()
            {
                return Err("请先停止酒馆，再导入或导出".into());
            }
            *guard = None;
        }
        let _reservation = reserve_port(self.settings().map(|s| s.port).unwrap_or(PORT))?;
        if importing {
            let result = crate::backup::import(&self.data, path)?;
            self.port.store(self.settings()?.port, Ordering::SeqCst);
            Ok(result)
        } else {
            crate::backup::export(&self.data, path)?;
            Ok("导出完成。ZIP 未加密，请妥善保管，勿直接公开分享。".into())
        }
    }

    pub fn start(&self) -> Result<Status, String> {
        let mut guard = self.child.lock().map_err(|_| "酒馆状态异常")?;
        if self.shutting_down.load(Ordering::SeqCst) {
            return Err("小厨正在退出".into());
        }
        if self.updating.load(Ordering::SeqCst) {
            return Err("小厨正在安装更新，请等待应用重启".into());
        }
        if let Some(child) = guard.as_mut() {
            if child
                .try_wait()
                .map_err(|_| "无法读取酒馆进程状态")?
                .is_none()
            {
                return Ok(self.snapshot("running"));
            }
            *guard = None;
        }
        // Never attach to an unrelated process, and never kill the port owner.
        let settings = self.settings()?;
        let port = settings.port;
        let reservation = reserve_port(port)?;
        self.port.store(port, Ordering::SeqCst);
        let installed = self.prepare()?;
        let logs = self.data.join("logs");
        fs::create_dir_all(&logs).map_err(|_| "无法创建日志目录")?;
        let log = fs::File::create(logs.join("sillytavern.log")).map_err(|_| "无法创建日志文件")?;
        let error_log = log.try_clone().map_err(|_| "无法创建日志输出")?;
        let mut command =
            Command::new(
                self.resources
                    .join(if cfg!(windows) { "node.exe" } else { "node" }),
            );
        command
            .current_dir(&installed)
            .arg("server.js")
            .arg("--configPath")
            .arg(self.data.join("config.yaml"))
            .arg("--dataRoot")
            .arg(self.data.join("data"))
            .args([
                "--port",
                &port.to_string(),
                "--listen",
                "true",
                "--listenAddressIPv4",
                "0.0.0.0",
                "--whitelist",
                "true",
                "--enableIPv4",
                "true",
                "--enableIPv6",
                "false",
                "--browserLaunchEnabled",
                "false",
            ])
            // Restrict remote access to private LAN clients; leave persistent config intact.
            .env(
                "SILLYTAVERN_WHITELIST",
                r#"["127.0.0.1","::1","10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"]"#,
            )
            .env("SILLYTAVERN_WHITELISTDOCKERHOSTS", "false")
            .env_remove("NODE_OPTIONS")
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(error_log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        if self.shutting_down.load(Ordering::SeqCst) {
            return Err("小厨正在退出".into());
        }
        drop(reservation);
        let mut child = command
            .spawn()
            .map_err(|_| "无法启动内置运行环境，请重新安装完整版本")?;
        let outcome = wait_ready(&mut child, port, &self.shutting_down);
        if let Err(error) = outcome {
            terminate(&mut child);
            // Surface a bind conflict if another process claims the port after reservation.
            let occupied = is_bind_conflict(
                &fs::read_to_string(logs.join("sillytavern.log")).unwrap_or_default(),
            );
            if occupied {
                return Err(port_in_use_message(port));
            }
            return Err(error);
        }
        *guard = Some(child);
        Ok(self.snapshot("running"))
    }

    fn prepare(&self) -> Result<PathBuf, String> {
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(self.resources.join("manifest.json"))
                .map_err(|_| "安装包缺少酒馆运行环境。开发者请先运行 npm run runtime:prepare")?,
        )
        .map_err(|_| "运行环境清单无效")?;
        if manifest["sillyTavernCommit"] != REVISION {
            return Err("运行环境版本与小厨不匹配，请重新安装".into());
        }
        fs::create_dir_all(&self.data).map_err(|_| "无法创建本地数据目录")?;
        let runtime_root = self.data.join("runtimes");
        fs::create_dir_all(&runtime_root).map_err(|_| "无法创建酒馆运行目录")?;
        let destination = runtime_root.join(REVISION);
        if destination.join(".chef25-ready").is_file() {
            return Ok(destination);
        }
        let staging = runtime_root.join(format!("{REVISION}.preparing"));
        if staging.exists() {
            fs::remove_dir_all(&staging).map_err(|_| "无法清理上次未完成的准备目录")?;
        }
        copy_tree(&self.resources.join("sillytavern"), &staging)
            .map_err(|_| "准备酒馆文件失败，请检查磁盘空间和目录权限")?;
        fs::write(staging.join(".chef25-ready"), REVISION).map_err(|_| "无法写入准备状态")?;
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|_| "无法清理未完成的运行环境")?;
        }
        fs::rename(&staging, &destination).map_err(|_| "无法保存酒馆运行环境")?;
        Ok(destination)
    }

    pub fn stop(&self) -> Result<Status, String> {
        let mut guard = self.child.lock().map_err(|_| "酒馆状态异常")?;
        self.close_remote();
        if let Some(mut child) = guard.take() {
            terminate(&mut child);
        }
        Ok(self.snapshot("stopped"))
    }

    /// Seal startup before waiting for the child mutex: an in-flight start must
    /// cancel readiness and queued commands must never spawn after exit cleanup.
    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
        let mut guard = self.child.lock().unwrap_or_else(|error| error.into_inner());
        self.close_remote();
        if let Some(mut child) = guard.take() {
            terminate(&mut child);
        }
    }

    pub fn begin_update(&self) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|_| "酒馆状态异常")?;
        self.updating.store(true, Ordering::SeqCst);
        self.close_remote();
        if let Some(mut child) = guard.take() {
            terminate(&mut child);
        }
        Ok(())
    }

    pub fn end_update(&self) {
        self.updating.store(false, Ordering::SeqCst);
    }
}

impl Drop for Service {
    fn drop(&mut self) {
        self.close_remote();
        if let Ok(guard) = self.child.get_mut() {
            if let Some(mut child) = guard.take() {
                terminate(&mut child);
            }
        }
    }
}

fn usable_lan_address(address: &if_addrs::Ifv4Addr) -> bool {
    let host = u32::from(address.ip) & !u32::from(address.netmask);
    address.ip.is_private()
        && address.prefixlen < 31
        && host != 0
        && host != !u32::from(address.netmask)
}

fn lan_urls(port: u16) -> Vec<String> {
    let mut addresses: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|interface| interface.is_oper_up() && !interface.is_p2p())
        .filter_map(|interface| match interface.addr {
            if_addrs::IfAddr::V4(address) if usable_lan_address(&address) => Some(address.ip),
            _ => None,
        })
        .collect();
    addresses.sort();
    addresses.dedup();
    addresses
        .into_iter()
        .map(|ip| format!("http://{ip}:{port}"))
        .collect()
}

fn is_bind_conflict(log: &str) -> bool {
    log.contains("EADDRINUSE") || log.contains(
        "Error: Startup aborted because IPv4 is the only enabled protocol and its listen port is already in use."
    )
}

fn port_in_use_message(port: u16) -> String {
    format!("本地端口 {port} 已被占用，请在设置中更换端口。")
}

fn reserve_port(port: u16) -> Result<TcpListener, String> {
    let describe = |error: std::io::Error| {
        if error.kind() == std::io::ErrorKind::AddrInUse {
            port_in_use_message(port)
        } else {
            format!("无法绑定本地端口 {port}，请检查权限或在设置中更换端口。")
        }
    };
    // macOS may allow wildcard binding alongside an existing specific-address listener.
    // Probe each advertised interface as well, without connecting to or killing its owner.
    if port != 0 {
        let mut addresses = vec![Ipv4Addr::LOCALHOST];
        addresses.extend(
            if_addrs::get_if_addrs()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|interface| match interface.ip() {
                    std::net::IpAddr::V4(ip) => Some(ip),
                    _ => None,
                }),
        );
        addresses.sort();
        addresses.dedup();
        for address in addresses {
            // Some tunnel interfaces report addresses that cannot be bound locally.
            match TcpListener::bind((address, port)) {
                Ok(probe) => drop(probe),
                Err(error) if error.kind() == std::io::ErrorKind::AddrNotAvailable => {}
                Err(error) => return Err(describe(error)),
            }
        }
    }
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port)).map_err(describe)
}

fn wait_ready(child: &mut Child, port: u16, shutting_down: &AtomicBool) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法创建本地健康检查")?;
    let deadline = Instant::now() + Duration::from_secs(90);
    while Instant::now() < deadline {
        if shutting_down.load(Ordering::SeqCst) {
            return Err("小厨正在退出".into());
        }
        if child.try_wait().map_err(|_| "无法读取酒馆进程")?.is_some() {
            return Err("酒馆启动失败，请查看本地数据目录中的 logs/sillytavern.log".into());
        }
        if let Ok(response) = client.get(format!("http://127.0.0.1:{port}")).send() {
            if response.status().is_success()
                && response.text().unwrap_or_default().contains("SillyTavern")
            {
                // Verify ownership again after HTTP so a failed child is never reported ready.
                thread::sleep(Duration::from_millis(200));
                if child.try_wait().map_err(|_| "无法读取酒馆进程")?.is_none() {
                    return Ok(());
                }
            }
        }
        thread::sleep(Duration::from_millis(300));
    }
    Err("酒馆启动超时，已停止本次进程。请检查本地日志后重试。".into())
}

fn terminate(child: &mut Child) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }
    #[cfg(unix)]
    {
        // This PID comes only from our live Child handle, never from port discovery.
        unsafe {
            libc::kill(child.id() as i32, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if child.try_wait().ok().flatten().is_some() {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn copy_tree(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target)?;
        }
        // npm .bin symlinks are unnecessary: launch only the fixed server.js entry point.
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_addresses_exclude_virtual_network_ids_and_public_ips() {
        for (ip, expected) in [
            (Ipv4Addr::new(192, 168, 1, 42), true),
            (Ipv4Addr::new(192, 168, 97, 0), false),
            (Ipv4Addr::new(192, 168, 1, 255), false),
            (Ipv4Addr::new(127, 0, 0, 1), false),
            (Ipv4Addr::new(8, 8, 8, 8), false),
        ] {
            assert_eq!(
                usable_lan_address(&if_addrs::Ifv4Addr {
                    ip,
                    netmask: Ipv4Addr::new(255, 255, 255, 0),
                    prefixlen: 24,
                    broadcast: None,
                }),
                expected
            );
        }
    }

    #[test]
    fn transfers_require_confirmation_idle_service_and_free_port() {
        let temporary = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let root = temporary.path().join("data-root");
        let destination = temporary.path().join("backup.zip");
        let service = Service::new(PathBuf::new(), root.clone());
        let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).unwrap();
        service
            .save_settings(LaunchSettings {
                port: listener.local_addr().unwrap().port(),
            })
            .unwrap();
        assert!(service.transfer(false, "", &destination).is_err());
        assert!(service.transfer(true, "确认导出", &destination).is_err());
        assert!(service.transfer(false, "确认导出", &destination).is_err());
        assert!(!destination.exists());
        service.updating.store(true, Ordering::SeqCst);
        assert!(service.transfer(false, "确认导出", &destination).is_err());
        service.end_update();
        {
            let _guard = service.child.lock().unwrap();
            assert!(service.transfer(false, "确认导出", &destination).is_err());
        }
        drop(listener);
        service.transfer(false, "确认导出", &destination).unwrap();
        service
            .transfer(true, "确认覆盖导入", &destination)
            .unwrap();
        assert!(root.join("data").is_dir());
    }

    #[test]
    fn reset_requires_confirmation_idle_service_and_free_port() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("chef25-reset-service-{}", std::process::id()));
        let service = Service::new(PathBuf::new(), root.clone());
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let kept_port = listener.local_addr().unwrap().port();
        service
            .save_settings(LaunchSettings { port: kept_port })
            .unwrap();
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(root.join("data/keep"), "keep").unwrap();
        for confirmation in ["", "确认", "确认重置 "] {
            assert!(service.reset(confirmation).is_err());
        }
        assert!(service.reset("确认重置").is_err());
        drop(listener);
        service.updating.store(true, Ordering::SeqCst);
        assert!(service.reset("确认重置").is_err());
        service.end_update();
        {
            let _guard = service.child.lock().unwrap();
            assert!(service.reset("确认重置").is_err());
        }
        assert!(root.join("data/keep").exists());
        service.reset("确认重置").unwrap();
        assert!(!root.join("data").exists());
        assert_eq!(
            service.settings().unwrap(),
            LaunchSettings { port: kept_port }
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recognizes_upstream_bind_errors_without_retrying_other_failures() {
        assert!(is_bind_conflict(
            "Error: listen EADDRINUSE: address already in use"
        ));
        assert!(is_bind_conflict("Error: Startup aborted because IPv4 is the only enabled protocol and its listen port is already in use."));
        assert!(!is_bind_conflict("Error: EACCES permission denied"));
        assert!(!is_bind_conflict(
            "Error: Failed to start server on IPv4 and IPv6 disabled"
        ));
    }

    #[test]
    fn settings_reject_out_of_range_ports() {
        assert!(LaunchSettings { port: 0 }.validate().is_err());
        assert!(LaunchSettings { port: 1023 }.validate().is_err());
        assert!(LaunchSettings { port: 65535 }.validate().is_ok());
        assert!(
            serde_json::from_str::<LaunchSettings>(r#"{"automatic":true,"port":65536}"#).is_err()
        );
    }

    #[test]
    fn legacy_modes_preserve_port_and_are_removed_when_saved() {
        assert_eq!(LaunchSettings::default().port, 25252);
        for automatic in [true, false] {
            let settings: LaunchSettings =
                serde_json::from_str(&format!(r#"{{"automatic":{automatic},"port":31000}}"#))
                    .unwrap();
            assert_eq!(settings.port, 31000);
            assert_eq!(
                serde_json::to_value(settings).unwrap(),
                serde_json::json!({"port": 31000})
            );
        }
    }

    #[test]
    fn settings_persist_and_bad_settings_do_not_silently_reset() {
        let root =
            std::env::temp_dir().join(format!("chef25-settings-test-{}", std::process::id()));
        assert!(!root.exists());
        let service = Service::new(PathBuf::new(), root.clone());
        assert_eq!(service.settings().unwrap(), LaunchSettings::default());
        let settings = LaunchSettings { port: 31000 };
        service.save_settings(settings.clone()).unwrap();
        let reopened = Service::new(PathBuf::new(), root.clone());
        assert_eq!(reopened.settings().unwrap(), settings);
        // Replacing an existing setting is supported on every target OS.
        service.save_settings(LaunchSettings::default()).unwrap();
        assert_eq!(reopened.settings().unwrap(), LaunchSettings::default());
        fs::write(root.join("launcher-settings.json"), b"bad json").unwrap();
        assert!(service.settings().is_err());
        service.save_settings(settings).unwrap();
        assert!(service.settings().is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn settings_require_stopped_service() {
        let temporary = tempfile::tempdir().unwrap();
        let service = Service::new(PathBuf::new(), temporary.path().to_path_buf());
        service
            .save_settings(LaunchSettings { port: 31000 })
            .unwrap();
        {
            let _guard = service.child.lock().unwrap();
            assert!(service
                .save_settings(LaunchSettings { port: 31001 })
                .is_err());
        }
        *service.child.lock().unwrap() = Some(Command::new("sleep").arg("30").spawn().unwrap());
        assert!(service
            .save_settings(LaunchSettings { port: 31001 })
            .unwrap_err()
            .contains("请先停止酒馆"));
        assert_eq!(service.settings().unwrap().port, 31000);
        service.stop().unwrap();
        service
            .save_settings(LaunchSettings { port: 31001 })
            .unwrap();
        assert_eq!(service.settings().unwrap().port, 31001);
    }

    #[cfg(unix)]
    #[test]
    fn remote_children_are_reaped_by_stop_update_and_shutdown() {
        for action in ["stop", "update", "shutdown", "remote"] {
            let service = Service::new(PathBuf::new(), PathBuf::new());
            let gateway = Command::new("sleep").arg("30").spawn().unwrap();
            let tunnel = Command::new("sleep").arg("30").spawn().unwrap();
            let pids = [gateway.id(), tunnel.id()];
            *service.remote.lock().unwrap() = Some(RemoteProcess {
                gateway,
                tunnel: Some(tunnel),
                _files: tempfile::tempdir().unwrap(),
                public_url: "https://example.com/".into(),
            });
            match action {
                "stop" => {
                    service.stop().unwrap();
                }
                "update" => {
                    service.begin_update().unwrap();
                }
                "remote" => {
                    service.stop_remote().unwrap();
                }
                _ => service.shutdown(),
            }
            assert!(!service.remote_status().unwrap().enabled);
            for pid in pids {
                // Signal 0 only checks existence of these test-owned PIDs.
                assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
            }
        }
    }

    #[test]
    fn updating_blocks_service_start_before_touching_runtime_or_port() {
        let service = Service::new(PathBuf::new(), PathBuf::new());
        service.begin_update().unwrap();
        assert!(service.start().unwrap_err().contains("正在安装更新"));
        service.end_update();
        assert!(!service.updating.load(Ordering::SeqCst));
    }

    #[test]
    #[ignore = "requires the prepared runtime; reserves an isolated ephemeral test port"]
    fn bundled_runtime_lifecycle() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("chef25-runtime-test-{}", std::process::id()));
        assert!(!root.exists());
        let service = Service::new(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/runtime"),
            root.clone(),
        );
        let other = reserve_port(0).unwrap();
        let test_port = other.local_addr().unwrap().port();
        service
            .save_settings(LaunchSettings { port: test_port })
            .unwrap();
        assert!(service.start().unwrap_err().contains("已被占用"));
        assert!(other.local_addr().is_ok());
        drop(other);
        let started = service.start().unwrap();
        assert_eq!(started.phase, "running");
        assert_eq!(started.url, format!("http://127.0.0.1:{test_port}"));
        // A real LAN-origin request exercises binding, whitelist and upstream session/CSRF setup.
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        for url in &started.lan_urls {
            assert!(client.get(url).send().unwrap().status().is_success());
            let csrf = client.get(format!("{url}/csrf-token")).send().unwrap();
            assert!(csrf.status().is_success());
            assert!(csrf.headers().contains_key(reqwest::header::SET_COOKIE));
            let body: serde_json::Value = serde_json::from_str(&csrf.text().unwrap()).unwrap();
            assert!(body["token"]
                .as_str()
                .is_some_and(|token| !token.is_empty()));
            assert_eq!(
                client
                    .post(format!("{url}/api/settings/get"))
                    .send()
                    .unwrap()
                    .status(),
                reqwest::StatusCode::FORBIDDEN
            );
        }
        assert_eq!(service.start().unwrap().phase, "running");
        assert!(service.reset("确认重置").unwrap_err().contains("请先停止"));
        let config = fs::read(root.join("config.yaml")).unwrap();
        fs::write(root.join("data/chef25-preservation-test"), "keep me").unwrap();
        let stopped = service.stop().unwrap();
        assert_eq!(stopped.phase, "stopped");
        assert!(stopped.lan_urls.is_empty());
        assert!(reserve_port(test_port).is_ok());
        assert_eq!(service.start().unwrap().phase, "running");
        assert_eq!(fs::read(root.join("config.yaml")).unwrap(), config);
        assert_eq!(
            fs::read_to_string(root.join("data/chef25-preservation-test")).unwrap(),
            "keep me"
        );
        service.stop().unwrap();
        service.reset("确认重置").unwrap();
        assert!(!root.join("data").exists());
        // Reset keeps the launch port, so acceptance stays on the test port.
        assert_eq!(
            service.settings().unwrap(),
            LaunchSettings { port: test_port }
        );
        assert_eq!(service.start().unwrap().phase, "running");
        assert!(root.join("config.yaml").is_file());
        assert!(!root.join("data/chef25-preservation-test").exists());
        let config = fs::read(root.join("config.yaml")).unwrap();
        fs::write(root.join("data/chef25-preservation-test"), "keep me").unwrap();
        service.shutdown();
        service.shutdown(); // ExitRequested and Exit may both perform cleanup.
        assert!(service.start().unwrap_err().contains("正在退出"));
        assert!(reserve_port(test_port).is_ok());
        // Reopening the launcher can immediately reuse the same port and data.
        let reopened = Service::new(service.resources.clone(), root.clone());
        assert_eq!(reopened.start().unwrap().phase, "running");
        assert_eq!(fs::read(root.join("config.yaml")).unwrap(), config);
        assert_eq!(
            fs::read_to_string(root.join("data/chef25-preservation-test")).unwrap(),
            "keep me"
        );
        drop(reopened);
        assert!(reserve_port(test_port).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shutdown_blocks_future_start_before_touching_runtime_or_port() {
        let service = Service::new(PathBuf::new(), PathBuf::new());
        service.shutdown();
        assert!(service.start().unwrap_err().contains("正在退出"));
        assert_eq!(service.status().unwrap().phase, "stopped");
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_cancels_in_flight_readiness_and_reaps_child() {
        let service = Service::new(PathBuf::new(), PathBuf::new());
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        thread::scope(|scope| {
            let mut guard = service.child.lock().unwrap();
            let shutdown = scope.spawn(|| service.shutdown());
            // shutdown sets cancellation before waiting for the startup mutex.
            let deadline = Instant::now() + Duration::from_secs(5);
            while !service.shutting_down.load(Ordering::SeqCst) {
                assert!(Instant::now() < deadline);
                thread::yield_now();
            }
            assert!(wait_ready(&mut child, 0, &service.shutting_down)
                .unwrap_err()
                .contains("正在退出"));
            *guard = Some(child);
            drop(guard);
            shutdown.join().unwrap();
        });
        assert_eq!(service.status().unwrap().phase, "stopped");
        // waitpid returns ECHILD only after the owned child has been reaped.
        assert_eq!(
            unsafe { libc::waitpid(pid as i32, std::ptr::null_mut(), libc::WNOHANG) },
            -1
        );
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
    }

    #[test]
    fn refuses_an_occupied_port_without_connecting_to_it() {
        let owner = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = owner.local_addr().unwrap().port();
        assert!(reserve_port(port).is_err());
        assert!(owner.local_addr().is_ok());
    }

    #[test]
    fn reports_stopped_without_inventing_installed_runtime() {
        let root = std::env::temp_dir().join(format!("chef25-test-{}", std::process::id()));
        let service = Service::new(root.join("missing"), root.join("data"));
        let status = service.status().unwrap();
        assert_eq!(status.phase, "stopped");
        assert!(!status.bundled);
        assert!(service.prepare().is_err());
    }
}
