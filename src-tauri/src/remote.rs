use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRequest {
    pub configuration: String,
    pub public_url: String,
    pub password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub enabled: bool,
    pub public_url: String,
    pub message: String,
}

pub fn disabled(message: &str) -> RemoteStatus {
    RemoteStatus {
        enabled: false,
        public_url: String::new(),
        message: message.into(),
    }
}

// Accept only a narrow INI subset. Never forward plugins, includes, executable
// token sources, admin listeners, arbitrary local targets or extra proxies.
pub fn configuration(input: &str, local_port: u16) -> Result<String, String> {
    if input.len() > 32_768 || input.contains(['\0', '\r', '`']) || input.contains("{{") {
        return Err("隧道配置无效，请复制 OpenFrp 的 INI 配置".into());
    }
    let mut sections: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let mut current = String::new();
    for line in input.lines().map(str::trim) {
        if line.is_empty() || line.starts_with(['#', ';']) {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            current = line[1..line.len() - 1].to_string();
            if current.is_empty()
                || !current
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
                || sections.contains_key(&current)
            {
                return Err("隧道配置包含无效或重复的分区".into());
            }
            sections.insert(current.clone(), BTreeMap::new());
            continue;
        }
        let (key, value) = line
            .split_once('=')
            .ok_or("只支持 OpenFrp INI 配置，每行应为 key = value")?;
        let (key, value) = (key.trim(), value.trim());
        let allowed = if current == "common" {
            [
                "server_addr",
                "server_port",
                "user",
                "token",
                "authentication_method",
                "tls_enable",
                "protocol",
                "meta_token",
                "login_fail_exit",
                "dns_server",
                "tcp_mux",
                "log_level",
                "log_file",
                "log_max_days",
                "disable_log_color",
            ]
            .contains(&key)
        } else {
            [
                "type",
                "local_ip",
                "local_port",
                "remote_port",
                "custom_domains",
                "subdomain",
                "use_encryption",
                "use_compression",
                "host_header_rewrite",
            ]
            .contains(&key)
        };
        if !allowed || value.is_empty() || value.contains(['\n', ';', '#', '[', ']']) {
            return Err("配置包含不支持的选项；请使用仅包含一个 HTTP 隧道的基础 INI 配置".into());
        }
        let section = sections.get_mut(&current).ok_or("配置缺少分区")?;
        if section.insert(key.into(), value.into()).is_some() {
            return Err("配置项重复".into());
        }
    }
    if sections.len() != 2 {
        return Err("请导入 common 和一个 HTTP 隧道，共两个分区".into());
    }
    let common = sections.get_mut("common").ok_or("配置缺少 common 分区")?;
    for key in ["server_addr", "server_port", "token"] {
        if !common.contains_key(key) {
            return Err(format!("配置缺少 {key}"));
        }
    }
    let port: u16 = common["server_port"]
        .parse()
        .map_err(|_| "服务器端口无效")?;
    if port == 0 {
        return Err("服务器端口无效".into());
    }
    if !common["server_addr"]
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || b".-".contains(&c))
    {
        return Err("节点地址无效".into());
    }
    // Defaults are enforced rather than trusting supplied safety settings.
    common.insert("tls_enable".into(), "true".into());
    common.insert("login_fail_exit".into(), "true".into());
    common.insert("protocol".into(), "tcp".into());
    common.remove("dns_server");
    for key in [
        "tcp_mux",
        "log_level",
        "log_file",
        "log_max_days",
        "disable_log_color",
    ] {
        common.remove(key);
    }
    common.insert("log_file".into(), "console".into());
    common.insert("log_level".into(), "error".into());
    let proxy = sections
        .iter_mut()
        .find(|(name, _)| name.as_str() != "common")
        .unwrap()
        .1;
    if proxy.get("type").map(String::as_str) != Some("http") {
        return Err("首版仅支持 HTTP 隧道，外网入口须由节点提供 HTTPS".into());
    }
    if !proxy.contains_key("custom_domains") && !proxy.contains_key("subdomain") {
        return Err("隧道缺少域名配置".into());
    }
    proxy.insert("local_ip".into(), "127.0.0.1".into());
    proxy.insert("local_port".into(), local_port.to_string());
    proxy.insert("use_encryption".into(), "true".into());
    proxy.remove("remote_port");
    proxy.remove("host_header_rewrite");
    let mut output = String::new();
    for (name, values) in sections {
        output.push_str(&format!("[{name}]\n"));
        for (key, value) in values {
            output.push_str(&format!("{key} = {value}\n"));
        }
    }
    Ok(output)
}

pub fn validate(request: &RemoteRequest) -> Result<String, String> {
    if request.password.len() < 16
        || request.password.len() > 128
        || request.password.chars().any(char::is_control)
    {
        return Err("访问密码须为 16–128 字节且不含控制字符".into());
    }
    let url = reqwest::Url::parse(request.public_url.trim())
        .map_err(|_| "请输入有效的 HTTPS 访问地址")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("访问地址必须是 HTTPS 根地址，不能包含账号、密码或路径".into());
    }
    configuration(&request.configuration.replace("\r\n", "\n"), 1)?;
    Ok(url.to_string())
}

/// Download only the pinned official client. Never execute a renderer-provided
/// path. Archives are hashed before reading, and only one expected file is copied.
pub fn client(data: &std::path::Path) -> Result<std::path::PathBuf, String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    let lock: serde_json::Value = serde_json::from_str(include_str!("../../runtime.lock.json"))
        .map_err(|_| "客户端清单无效")?;
    let spec = &lock["openfrp"];
    let target = if cfg!(target_os = "windows") {
        "windows-amd64"
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        "darwin-arm64"
    } else if cfg!(target_os = "macos") {
        "darwin-amd64"
    } else {
        return Err("当前平台不支持 OpenFrp 客户端".into());
    };
    let archive = &spec["archives"][target];
    let root = data.join("remote-client");
    std::fs::create_dir_all(&root).map_err(|_| "无法创建客户端目录")?;
    let file_name = format!("frpc_{target}{}", if cfg!(windows) { ".exe" } else { "" });
    let destination = root.join(&file_name);
    let cache = root.join(archive["file"].as_str().ok_or("客户端清单无效")?);
    let expected = archive["sha256"].as_str().ok_or("客户端校验值缺失")?;
    let bytes = match std::fs::read(&cache) {
        Ok(bytes) if format!("{:x}", Sha256::digest(&bytes)) == expected => bytes,
        _ => {
            let url = format!(
                "{}{}",
                spec["baseUrl"].as_str().ok_or("客户端来源缺失")?,
                archive["file"].as_str().ok_or("客户端文件名缺失")?
            );
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(90))
                .user_agent("Chef25/0.2.0")
                .https_only(true)
                .build()
                .map_err(|_| "无法创建下载请求")?;
            let response = client
                .get(url)
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|_| "OpenFrp 客户端下载失败，请检查网络后重试")?;
            let mut bytes = Vec::new();
            response
                .take(64 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "客户端下载未完成")?;
            if bytes.len() > 64 * 1024 * 1024 || format!("{:x}", Sha256::digest(&bytes)) != expected
            {
                return Err("客户端校验失败，未安装或运行".into());
            }
            let mut saved = tempfile::NamedTempFile::new_in(&root).map_err(|_| "无法缓存客户端")?;
            saved.write_all(&bytes).map_err(|_| "无法缓存客户端")?;
            saved.persist(&cache).map_err(|_| "无法保存客户端缓存")?;
            bytes
        }
    };
    let expected_entry = format!(
        "frpc_{}{}",
        target.replace('-', "_"),
        if cfg!(windows) { ".exe" } else { "" }
    );
    let mut extracted = Vec::new();
    if cfg!(windows) {
        let mut zip =
            zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| "客户端归档无效")?;
        let entry = zip.by_name(&expected_entry).map_err(|_| "归档缺少客户端")?;
        entry
            .take(128 * 1024 * 1024 + 1)
            .read_to_end(&mut extracted)
            .map_err(|_| "无法解压客户端")?;
    } else {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes.as_slice()));
        for entry in archive.entries().map_err(|_| "客户端归档无效")? {
            let entry = entry.map_err(|_| "客户端归档无效")?;
            if entry.path().map_err(|_| "归档路径无效")?.as_ref()
                == std::path::Path::new(&expected_entry)
                && entry.header().entry_type().is_file()
            {
                entry
                    .take(128 * 1024 * 1024 + 1)
                    .read_to_end(&mut extracted)
                    .map_err(|_| "无法解压客户端")?;
                break;
            }
        }
    }
    if extracted.is_empty() || extracted.len() > 128 * 1024 * 1024 {
        return Err("归档缺少有效客户端".into());
    }
    // Verify/recreate the executable from the hashed archive on every start.
    let mut output = tempfile::NamedTempFile::new_in(&root).map_err(|_| "无法安装客户端")?;
    output.write_all(&extracted).map_err(|_| "无法写入客户端")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        output
            .as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法设置客户端权限")?;
    }
    output.persist(&destination).map_err(|_| "无法保存客户端")?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    const SAMPLE: &str = "[common]\nserver_addr = node.example.com\nserver_port = 7000\ntoken = example\nuser = demo\n[demo]\ntype = http\ncustom_domains = tavern.example.com\nlocal_ip = 192.168.0.5\nlocal_port = 80\n";
    #[test]
    fn rewrites_target_and_requires_safe_subset() {
        let result = configuration(SAMPLE, 12345).unwrap();
        assert!(result.contains("local_ip = 127.0.0.1"));
        assert!(result.contains("local_port = 12345"));
        assert!(result.contains("tls_enable = true"));
        for extra in [
            "plugin = http_proxy",
            "includes = /tmp/evil",
            "local_port = 22",
            "[other]\ntype = tcp",
        ] {
            assert!(configuration(&format!("{SAMPLE}{extra}\n"), 12345).is_err());
        }
        assert!(configuration(&SAMPLE.replace("type = http", "type = tcp"), 1).is_err());
        assert!(configuration(&SAMPLE.replace("example", "{{ .Envs.SECRET }}"), 1).is_err());
    }
    #[test]
    #[ignore = "verifies the pinned optional client in an isolated temp directory"]
    fn official_client_accepts_generated_config() {
        let data = tempfile::tempdir().unwrap();
        if let Ok(archives) = std::env::var("CHEF25_OPENFRP_ARCHIVES") {
            let filename = if cfg!(windows) {
                "frpc_windows_amd64.zip"
            } else if cfg!(target_arch = "aarch64") {
                "frpc_darwin_arm64.tar.gz"
            } else {
                "frpc_darwin_amd64.tar.gz"
            };
            std::fs::create_dir(data.path().join("remote-client")).unwrap();
            std::fs::copy(
                std::path::Path::new(&archives).join(filename),
                data.path().join("remote-client").join(filename),
            )
            .unwrap();
        }
        let executable = client(data.path()).unwrap();
        let original = std::fs::read(&executable).unwrap();
        std::fs::write(&executable, b"corrupted executable").unwrap();
        let repaired = client(data.path()).unwrap();
        assert_eq!(std::fs::read(repaired).unwrap(), original);
        let config = data.path().join("test.ini");
        std::fs::write(&config, configuration(SAMPLE, 12345).unwrap()).unwrap();
        let result = std::process::Command::new(executable)
            .arg("verify")
            .arg("--config")
            .arg(config)
            .arg("--noupdate")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "Official client rejected the generated config"
        );
    }

    #[test]
    fn requires_https_and_password() {
        for url in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com/path",
            "https://example.com/?token=x",
        ] {
            assert!(validate(&RemoteRequest {
                configuration: SAMPLE.into(),
                public_url: url.into(),
                password: "a-long-test-password".into()
            })
            .is_err());
        }
    }
}
