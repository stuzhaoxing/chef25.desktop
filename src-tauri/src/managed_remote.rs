//! The account credential never reaches Desktop. This installation credential is
//! outside user-data backups/reset and is accessible only to the native launcher.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

// Keep native HTTP calls aligned with the local website used by the dev app.
// Never fall back to production when the local service is unavailable.
const API: &str = if cfg!(debug_assertions) {
    "http://127.0.0.1:25250/api/remote"
} else {
    "https://www.chef25.com/api/remote"
};
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CapacityState {
    Idle,
    Busy,
    Full,
    Unknown,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capacity {
    state: CapacityState,
    inventory: Option<Inventory>,
    inventory_error: Option<String>,
    api: ApiBudget,
    checked_at: String,
}
#[derive(Deserialize, Serialize)]
pub struct Quota {
    occupied: u32,
    limit: u32,
    remaining: u32,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    tunnels: Quota,
    dns: Quota,
    checked_at: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiBudget {
    used: u32,
    limit: u32,
    remaining: u32,
    window_seconds: u32,
    next_recovery_seconds: u32,
}
pub fn capacity() -> Result<Capacity, String> {
    let response = reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "无法查询远程容量")?
        .post(format!("{API}/capacity"))
        .header("Content-Type", "application/json")
        .body("{}")
        .send()
        .map_err(|_| "无法查询远程容量")?
        .error_for_status()
        .map_err(|_| "远程容量暂不可用")?;
    serde_json::from_reader(response.take(4096)).map_err(|_| "远程容量返回无效".into())
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Identity {
    pub key: String,
    pub password: String,
}
fn random_secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "无法生成安全设备凭据")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn private_dir(data: &Path) -> Result<PathBuf, String> {
    let dir = data.join("private-remote");
    for ancestor in dir.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if crate::storage::is_link(&meta) => {
                return Err("设备凭据目录不能包含链接".into())
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err("无法检查设备凭据目录".into())
            }
            _ => {}
        }
    }
    fs::create_dir_all(&dir).map_err(|_| "无法创建设备凭据目录")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护设备凭据目录")?;
    }
    Ok(dir)
}
fn regular(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !crate::storage::is_link(&meta) => Ok(true),
        Ok(_) => Err("设备凭据文件类型异常".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("无法读取设备凭据".into()),
    }
}
impl Identity {
    pub fn load(data: &Path) -> Result<Self, String> {
        let path = private_dir(data)?.join("identity.json");
        if !regular(&path)? {
            let identity = Self {
                key: random_secret()?,
                password: random_secret()?,
            };
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&path)
                .map_err(|_| "无法创建设备凭据，请重试")?;
            file.write_all(&serde_json::to_vec(&identity).map_err(|_| "无法生成设备凭据")?)
                .and_then(|_| file.sync_all())
                .map_err(|_| "无法保存设备凭据")?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .map_err(|_| "无法保护设备凭据")?;
        }
        let file = fs::File::open(&path).map_err(|_| "无法读取设备凭据")?;
        let identity: Self = serde_json::from_reader(file.take(4096))
            .map_err(|_| "设备凭据损坏，请保留文件并联系开发者")?;
        if [&identity.key, &identity.password].iter().any(|v| {
            v.len() != 64
                || !v
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        }) {
            return Err("设备凭据损坏，请保留文件并联系开发者".into());
        }
        Ok(identity)
    }
    pub fn public_url(&self) -> String {
        let hash = format!("{:x}", Sha256::digest(self.key.as_bytes()));
        format!("https://r-{}.chef25.com/", &hash[..60])
    }
    pub fn call(
        &self,
        action: &str,
        value: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(if action == "acquire" {
                90
            } else {
                8
            }))
            .build()
            .map_err(|_| "无法连接分配服务")?;
        let response = client
            .post(format!("{API}/{action}"))
            .bearer_auth(&self.key)
            .header("Content-Type", "application/json")
            .body(value.to_string())
            .send()
            .map_err(|_| {
                if cfg!(debug_assertions) {
                    "无法连接本地远程访问接口，请先启动本地网站（127.0.0.1:25250）"
                } else {
                    "无法连接 www.chef25.com，请检查网络后重试"
                }
            })?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                404 if cfg!(debug_assertions) => {
                    "本地远程访问接口不存在，请确认本地网站已更新并运行在 25250 端口"
                }
                404 => "远程访问服务尚未上线，请等待服务开放后再试；本地酒馆可继续使用",
                409 => "上次隧道正在回收或设备域名冲突，请稍后重试",
                410 => "远程访问租约已失效，请重新开启",
                429 => "隧道分配繁忙，请稍后重试",
                503 if cfg!(debug_assertions) => {
                    "本地远程访问服务未就绪，请检查本地服务配置和免费隧道名额；本地酒馆可继续使用"
                }
                503 => "免费隧道名额已满或服务尚未就绪，请稍后重试；本地酒馆可继续使用",
                _ => "远程访问服务暂不可用，请稍后重试",
            }
            .into());
        }
        let mut bytes = Vec::new();
        response
            .take(16385)
            .read_to_end(&mut bytes)
            .map_err(|_| "无法读取分配结果")?;
        if bytes.len() > 16384 {
            return Err("分配结果异常".into());
        }
        serde_json::from_slice(&bytes).map_err(|_| "分配结果无效".into())
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lease {
    pub lease_id: String,
    pub public_url: String,
    pub token: String,
}
impl Lease {
    pub fn acquire(identity: &Identity, port: u16) -> Result<Self, String> {
        let value = identity.call("acquire", serde_json::json!({"gatewayPort":port}))?;
        let lease: Self = serde_json::from_value(value).map_err(|_| "隧道分配结果无效")?;
        if lease.lease_id.len() != 36
            || !lease
                .lease_id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() || b == b'-')
            || lease.public_url != identity.public_url()
        {
            return Err("隧道分配与设备不匹配".into());
        }
        Ok(lease)
    }
    pub fn renew(&self, identity: &Identity) -> Result<(), String> {
        identity
            .call("renew", serde_json::json!({"leaseId":self.lease_id}))
            .map(|_| ())
    }
    pub fn release(&self, identity: &Identity) {
        let _ = identity.call("release", serde_json::json!({"leaseId":self.lease_id}));
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capacity_preserves_shared_budget_when_inventory_is_unknown() {
        let value = serde_json::json!({
            "state": "unknown", "inventory": null, "inventoryError": "暂时无法查询远程容量",
            "api": {"used":1200,"limit":1200,"remaining":0,"windowSeconds":300,"nextRecoverySeconds":45},
            "checkedAt":"2026-10-30T10:00:00.000Z"
        });
        let capacity: Capacity = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(capacity).unwrap(), value);
    }

    #[test]
    fn identity_is_stable_private_and_survives_reset() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().canonicalize().unwrap();
        let identity = Identity::load(&data).unwrap();
        assert_eq!(identity.key, Identity::load(&data).unwrap().key);
        assert_ne!(identity.key, identity.password);
        assert!(identity.public_url().starts_with("https://r-"));
        assert!(crate::storage::list(&data, "").unwrap().is_empty());
        assert!(crate::storage::preview(&data, "private-remote/identity.json").is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(data.join("private-remote"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(data.join("private-remote/identity.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        let output = tempfile::tempdir().unwrap();
        let backup = output.path().join("backup.zip");
        crate::backup::export(&data, &backup).unwrap();
        let zip = zip::ZipArchive::new(fs::File::open(backup).unwrap()).unwrap();
        assert!(zip
            .file_names()
            .all(|name| !name.contains("private-remote")));
        crate::storage::reset(&data).unwrap();
        assert_eq!(identity.key, Identity::load(&data).unwrap().key);
        fs::write(root.path().join("private-remote/identity.json"), b"broken").unwrap();
        assert!(Identity::load(&data).is_err());
        assert_eq!(
            fs::read(root.path().join("private-remote/identity.json")).unwrap(),
            b"broken"
        );
    }
    #[cfg(unix)]
    #[test]
    fn identity_rejects_links() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(other.path(), root.path().join("private-remote")).unwrap();
        assert!(Identity::load(&root.path().canonicalize().unwrap()).is_err());
        assert!(fs::read_dir(other.path()).unwrap().next().is_none());
    }
}
