use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub enabled: bool,
    pub public_url: String,
    pub message: String,
    pub password: String,
}

pub fn disabled(message: &str) -> RemoteStatus {
    RemoteStatus {
        enabled: false,
        password: String::new(),
        public_url: String::new(),
        message: message.into(),
    }
}

// Accept a connector token, never a full shell command or account-wide API key.
// The token is passed to cloudflared through a private file, not process arguments.
pub fn validate_token(input: &str) -> Result<(), String> {
    let invalid = "分配的 Cloudflare 隧道凭据无效，请稍后重试";
    let token = input.trim();
    if token.is_empty() || token.len() > 8192 {
        return Err(invalid.into());
    }
    let bytes = STANDARD.decode(token).map_err(|_| invalid)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| invalid)?;
    let account = value["a"].as_str().ok_or(invalid)?;
    let tunnel = value["t"].as_str().ok_or(invalid)?;
    let secret = value["s"].as_str().ok_or(invalid)?;
    if account.len() != 32
        || !account.bytes().all(|c| c.is_ascii_hexdigit())
        || tunnel.len() != 36
        || !tunnel.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
        // Cloudflare requires at least 32 bytes; managed tunnels can use 64.
        || STANDARD
            .decode(secret)
            .map_or(true, |bytes| bytes.len() < 32)
    {
        return Err(invalid.into());
    }
    Ok(())
}

// A router can retain the old wildcard answer while a new tunnel DNS record
// propagates. Resolve only our allocated hostname through Cloudflare's public
// resolver; keep the original URL, TLS hostname checks and gateway marker.
pub fn fresh_dns_client(public_url: &str) -> Result<reqwest::blocking::Client, String> {
    use hickory_proto::{
        op::{Message, Query},
        rr::{Name, RecordType},
    };
    use std::net::UdpSocket;
    let invalid = "无法刷新远程入口解析";
    let url = reqwest::Url::parse(public_url).map_err(|_| invalid)?;
    let host = url.host_str().ok_or(invalid)?;
    let device = host
        .strip_prefix("r-")
        .and_then(|s| s.strip_suffix(".chef25.com"))
        .ok_or(invalid)?;
    if url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || device.len() != 60
        || !device.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(invalid.into());
    }
    let mut random = [0u8; 2];
    getrandom::fill(&mut random).map_err(|_| invalid)?;
    let query = Query::query(
        Name::from_ascii(format!("{host}.")).map_err(|_| invalid)?,
        RecordType::A,
    );
    let mut request = Message::new();
    request
        .set_id(u16::from_be_bytes(random))
        .set_recursion_desired(true)
        .add_query(query.clone());
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|_| invalid)?;
    socket
        .set_read_timeout(Some(std::time::Duration::from_secs(2)))
        .map_err(|_| invalid)?;
    socket
        .set_write_timeout(Some(std::time::Duration::from_secs(2)))
        .map_err(|_| invalid)?;
    socket.connect("1.1.1.1:53").map_err(|_| invalid)?;
    socket
        .send(&request.to_vec().map_err(|_| invalid)?)
        .map_err(|_| invalid)?;
    let mut buffer = [0u8; 4096];
    let size = socket.recv(&mut buffer).map_err(|_| invalid)?;
    let answer = Message::from_vec(&buffer[..size]).map_err(|_| invalid)?;
    let addresses = dns_addresses(&answer, &query, request.id());
    if addresses.is_empty() {
        return Err(invalid.into());
    }
    reqwest::blocking::Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(3))
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|_| invalid.into())
}

fn dns_addresses(
    answer: &hickory_proto::op::Message,
    query: &hickory_proto::op::Query,
    id: u16,
) -> Vec<std::net::SocketAddr> {
    use hickory_proto::{
        op::{MessageType, ResponseCode},
        rr::RData,
    };
    if answer.id() != id
        || answer.message_type() != MessageType::Response
        || answer.truncated()
        || answer.response_code() != ResponseCode::NoError
        || answer.queries() != [query.clone()]
    {
        return Vec::new();
    }
    answer
        .answers()
        .iter()
        .filter(|r| r.name() == query.name())
        .filter_map(|r| match r.data() {
            RData::A(ip) => Some(ip.0),
            _ => None,
        })
        .filter(|ip| {
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && ip.octets()[0] != 0
                && ip.octets()[0] < 224
        })
        .take(8)
        .map(|ip| std::net::SocketAddr::new(ip.into(), 443))
        .collect()
}

pub fn tunnel_command(
    executable: &std::path::Path,
    files: &std::path::Path,
    token: &str,
) -> Result<std::process::Command, String> {
    use std::io::Write;
    let path = files.join("tunnel-token");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(&path)
        .and_then(|mut f| f.write_all(token.trim().as_bytes()))
        .map_err(|_| "无法写入临时隧道凭据")?;
    // Do not discover a user's unrelated ~/.cloudflared/config.yml or inherit
    // TUNNEL_* overrides (token, logs, origins, management listeners, etc.).
    let config = files.join("config.json");
    std::fs::write(&config, b"{}").map_err(|_| "无法写入隧道设置")?;
    let mut command = std::process::Command::new(executable);
    command.env_clear();
    for name in ["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
        .arg("tunnel")
        .arg("--config")
        .arg(config)
        .arg("--no-autoupdate")
        .args(["--metrics", "127.0.0.1:0"])
        .arg("run")
        .arg("--token-file")
        .arg(path)
        .current_dir(files)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    Ok(command)
}

/// Download only the pinned official client. Never execute a renderer-provided
/// path. Archives are hashed before reading, and only one expected file is copied.
pub fn client(data: &std::path::Path) -> Result<std::path::PathBuf, String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    let lock: serde_json::Value = serde_json::from_str(include_str!("../../runtime.lock.json"))
        .map_err(|_| "客户端清单无效")?;
    let spec = &lock["cloudflared"];
    let target = if cfg!(target_os = "windows") {
        "windows-amd64"
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        "darwin-arm64"
    } else if cfg!(target_os = "macos") {
        "darwin-amd64"
    } else {
        return Err("当前平台不支持 Cloudflare 客户端".into());
    };
    let archive = &spec["archives"][target];
    let root = data.join("remote-client").join("cloudflared");
    std::fs::create_dir_all(&root).map_err(|_| "无法创建客户端目录")?;
    let file_name = format!(
        "cloudflared_{target}{}",
        if cfg!(windows) { ".exe" } else { "" }
    );
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
                .map_err(|_| "Cloudflare 客户端下载失败，请检查网络后重试")?;
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
    let expected_entry = "cloudflared";
    let mut extracted = Vec::new();
    if cfg!(windows) {
        // The official Windows asset is a raw executable, not a ZIP archive.
        extracted = bytes;
    } else {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes.as_slice()));
        for entry in archive.entries().map_err(|_| "客户端归档无效")? {
            let entry = entry.map_err(|_| "客户端归档无效")?;
            if entry.path().map_err(|_| "归档路径无效")?.as_ref()
                == std::path::Path::new(expected_entry)
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

    #[test]
    fn fresh_dns_answers_require_matching_transaction_question_and_public_ipv4() {
        use hickory_proto::{
            op::{Message, MessageType, Query},
            rr::{rdata::A, Name, RData, Record, RecordType},
        };
        let name = Name::from_ascii(format!("r-{}.chef25.com.", "0".repeat(60))).unwrap();
        let query = Query::query(name.clone(), RecordType::A);
        let mut answer = Message::new();
        answer
            .set_id(42)
            .set_message_type(MessageType::Response)
            .add_query(query.clone());
        for ip in ["104.21.16.172", "127.0.0.1", "192.168.1.1", "224.0.0.1"] {
            answer.add_answer(Record::from_rdata(
                name.clone(),
                60,
                RData::A(A(ip.parse().unwrap())),
            ));
        }
        answer.add_answer(Record::from_rdata(
            Name::from_ascii("other.chef25.com.").unwrap(),
            60,
            RData::A(A("104.21.16.172".parse().unwrap())),
        ));
        let addresses = dns_addresses(&answer, &query, 42);
        assert_eq!(addresses.len(), 1);
        assert_eq!(addresses[0].to_string(), "104.21.16.172:443");
        assert!(dns_addresses(&answer, &query, 43).is_empty());
        let other = Query::query(
            Name::from_ascii("other.chef25.com.").unwrap(),
            RecordType::A,
        );
        assert!(dns_addresses(&answer, &other, 42).is_empty());
        answer.set_truncated(true);
        assert!(dns_addresses(&answer, &query, 42).is_empty());
    }

    #[test]
    fn fresh_dns_rejects_unallocated_urls_before_networking() {
        for url in [
            "https://example.com/",
            "https://r-short.chef25.com/",
            "http://r-short.chef25.com/",
            "https://www.chef25.com/",
        ] {
            assert!(fresh_dns_client(url).is_err());
        }
    }

    #[test]
    #[ignore = "requires an isolated live gateway and temporary Cloudflare lease"]
    fn fresh_dns_verifies_live_gateway_with_tls() {
        let url = std::env::var("CHEF25_TEST_REMOTE_URL").expect("isolated gateway URL required");
        let response = fresh_dns_client(&url).unwrap().get(&url).send().unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers()["x-chef25-gateway"],
            "chef25-diagnostic-probe"
        );
    }

    fn sample_token() -> String {
        STANDARD.encode(
            serde_json::json!({
                "a": "0".repeat(32),
                "t": "00000000-0000-0000-0000-000000000001",
                "s": STANDARD.encode([0u8; 32])
            })
            .to_string(),
        )
    }

    #[test]
    fn rejects_commands_api_keys_and_malformed_connector_tokens() {
        let token = sample_token();
        assert!(validate_token(&format!(" {token}\n")).is_ok());
        for invalid in [
            String::new(),
            "api-key".into(),
            format!("cloudflared tunnel run --token {token}"),
            STANDARD.encode("{}"),
            "A".repeat(8193),
            STANDARD.encode(r#"{"a":"bad","t":"bad","s":"bad"}"#),
        ] {
            let error = validate_token(&invalid).unwrap_err();
            assert!(!error.contains(&token));
        }
    }

    #[test]
    fn accepts_managed_secrets_and_rejects_short_or_invalid_secrets() {
        for size in [0, 1, 31, 32, 33, 64] {
            let token = STANDARD.encode(
                serde_json::json!({
                    "a": "0".repeat(32),
                    "t": "00000000-0000-0000-0000-000000000001",
                    "s": STANDARD.encode(vec![0u8; size])
                })
                .to_string(),
            );
            assert_eq!(validate_token(&token).is_ok(), size >= 32);
        }
        let token = STANDARD.encode(
            serde_json::json!({
                "a": "0".repeat(32),
                "t": "00000000-0000-0000-0000-000000000001",
                "s": "!".repeat(88)
            })
            .to_string(),
        );
        assert!(validate_token(&token).is_err());
    }

    #[test]
    fn connector_uses_private_token_file_and_isolated_configuration() {
        let dir = tempfile::tempdir().unwrap();
        let token = sample_token();
        let command =
            tunnel_command(std::path::Path::new("cloudflared"), dir.path(), &token).unwrap();
        assert!(command
            .get_args()
            .all(|arg| !arg.to_string_lossy().contains(&token)));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("tunnel-token")).unwrap(),
            token
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("config.json")).unwrap(),
            "{}"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(dir.path().join("tunnel-token"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        assert!(tunnel_command(std::path::Path::new("cloudflared"), dir.path(), &token).is_err());
        let path = dir.path().to_path_buf();
        drop(command);
        drop(dir);
        assert!(!path.exists());
    }

    #[test]
    #[ignore = "downloads and checks the official client in an isolated temporary directory"]
    fn official_client_accepts_generated_flags_and_repairs_corrupt_cache() {
        let data = tempfile::tempdir().unwrap();
        let executable = client(data.path()).unwrap();
        let original = std::fs::read(&executable).unwrap();
        std::fs::write(&executable, b"corrupted executable").unwrap();
        assert_eq!(
            std::fs::read(client(data.path()).unwrap()).unwrap(),
            original
        );
        let version = std::process::Command::new(&executable)
            .arg("--version")
            .output()
            .unwrap();
        assert!(version.status.success());
        assert!(String::from_utf8_lossy(&version.stdout).contains("2026.10.6"));
        let files = tempfile::tempdir().unwrap();
        let mut command = tunnel_command(&executable, files.path(), &sample_token()).unwrap();
        // Help parses the exact run flags without making any tunnel connection.
        let output = command
            .arg("--help")
            .stdout(std::process::Stdio::piped())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "official client rejected the run flags"
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("--token-file"));
        let invalid_files = tempfile::tempdir().unwrap();
        let output = tunnel_command(&executable, invalid_files.path(), "invalid")
            .unwrap()
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .unwrap();
        // Exercise config loading and token-file reading, not just --help.
        // This deliberately malformed token is rejected before networking.
        assert!(!output.status.success());
        let diagnostic = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            diagnostic.contains("Provided Tunnel token is not valid"),
            "unexpected startup diagnostic: {diagnostic}"
        );
        let lock: serde_json::Value =
            serde_json::from_str(include_str!("../../runtime.lock.json")).unwrap();
        let target = if cfg!(windows) {
            "windows-amd64"
        } else if cfg!(target_arch = "aarch64") {
            "darwin-arm64"
        } else {
            "darwin-amd64"
        };
        let cache = data.path().join("remote-client/cloudflared").join(
            lock["cloudflared"]["archives"][target]["file"]
                .as_str()
                .unwrap(),
        );
        std::fs::write(cache, b"corrupted download").unwrap();
        assert_eq!(
            std::fs::read(client(data.path()).unwrap()).unwrap(),
            original
        );
    }
}
