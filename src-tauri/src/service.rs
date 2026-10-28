use serde::Serialize;
use std::{
    fs,
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, TryLockError},
    thread,
    time::{Duration, Instant},
};

pub const PORT: u16 = 25252;
pub const URL: &str = "http://127.0.0.1:25252";
const REVISION: &str = "7e8663cd9c184a550b37238218bdd32c6efc68e9";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: &'static str,
    url: &'static str,
    data_dir: String,
    bundled: bool,
}

pub struct Service {
    resources: PathBuf,
    data: PathBuf,
    child: Mutex<Option<Child>>,
}

impl Service {
    pub fn new(resources: PathBuf, data: PathBuf) -> Self {
        Self {
            resources,
            data,
            child: Mutex::new(None),
        }
    }

    fn snapshot(&self, phase: &'static str) -> Status {
        Status {
            phase,
            url: URL,
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
                    *guard = None;
                }
                Ok(self.snapshot("stopped"))
            }
            Err(TryLockError::WouldBlock) => Ok(self.snapshot("starting")),
            Err(TryLockError::Poisoned(_)) => Err("酒馆状态异常，请重新启动小厨".into()),
        }
    }

    pub fn start(&self) -> Result<Status, String> {
        let mut guard = self.child.lock().map_err(|_| "酒馆状态异常")?;
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
        let reservation = reserve_port(PORT)?;
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
                &PORT.to_string(),
                "--listen",
                "false",
                "--enableIPv4",
                "true",
                "--enableIPv6",
                "false",
                "--browserLaunchEnabled",
                "false",
            ])
            .env_remove("NODE_OPTIONS")
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(error_log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        drop(reservation);
        let mut child = command
            .spawn()
            .map_err(|_| "无法启动内置运行环境，请重新安装完整版本")?;
        let outcome = wait_ready(&mut child);
        if let Err(error) = outcome {
            terminate(&mut child);
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
        if let Some(mut child) = guard.take() {
            terminate(&mut child);
        }
        Ok(self.snapshot("stopped"))
    }
}

impl Drop for Service {
    fn drop(&mut self) {
        if let Ok(guard) = self.child.get_mut() {
            if let Some(mut child) = guard.take() {
                terminate(&mut child);
            }
        }
    }
}

fn reserve_port(port: u16) -> Result<TcpListener, String> {
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).map_err(|_| {
        format!("本地端口 {port} 已被占用。请关闭使用该端口的程序后重试；小厨不会接管其他服务。")
    })
}

fn wait_ready(child: &mut Child) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法创建本地健康检查")?;
    let deadline = Instant::now() + Duration::from_secs(90);
    while Instant::now() < deadline {
        if child.try_wait().map_err(|_| "无法读取酒馆进程")?.is_some() {
            return Err("酒馆启动失败，请查看本地数据目录中的 logs/sillytavern.log".into());
        }
        if let Ok(response) = client.get(URL).send() {
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
    #[ignore = "requires the prepared runtime and exclusive port 25252"]
    fn bundled_runtime_lifecycle() {
        let root = std::env::temp_dir().join(format!("chef25-runtime-test-{}", std::process::id()));
        assert!(!root.exists());
        let service = Service::new(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/runtime"),
            root.clone(),
        );
        let other = reserve_port(PORT).expect("dedicated test port must be free");
        assert!(service.start().unwrap_err().contains("已被占用"));
        drop(other);
        assert_eq!(service.start().unwrap().phase, "running");
        assert_eq!(service.start().unwrap().phase, "running");
        let config = fs::read(root.join("config.yaml")).unwrap();
        fs::write(root.join("data/chef25-preservation-test"), "keep me").unwrap();
        assert_eq!(service.stop().unwrap().phase, "stopped");
        assert!(reserve_port(PORT).is_ok());
        assert_eq!(service.start().unwrap().phase, "running");
        assert_eq!(fs::read(root.join("config.yaml")).unwrap(), config);
        assert_eq!(
            fs::read_to_string(root.join("data/chef25-preservation-test")).unwrap(),
            "keep me"
        );
        drop(service);
        assert!(reserve_port(PORT).is_ok());
        fs::remove_dir_all(root).unwrap();
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
