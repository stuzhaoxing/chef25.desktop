use crate::storage::is_link;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const CONTENT: &[&str] = &["data", "config.yaml", "launcher-settings.json", "logs"];
const REPLACE: &[&str] = &[
    "data",
    "config.yaml",
    "launcher-settings.json",
    "logs",
    "runtimes",
    "launcher-settings.json.tmp",
];
const MANIFEST: &str = "chef25-backup.json";
const MARKER: &[u8] = b"{\"format\":\"chef25-backup\",\"version\":1}";
const MAX_BYTES: u64 = 10 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;

pub fn confirm(importing: bool, text: &str) -> Result<(), String> {
    let expected = if importing {
        "确认覆盖导入"
    } else {
        "确认导出"
    };
    if text != expected {
        return Err(format!("请输入完整的确认文字：{expected}"));
    }
    Ok(())
}

fn checked_root(root: &Path) -> Result<PathBuf, String> {
    for ancestor in root.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if is_link(&meta) => return Err("存储目录包含链接，无法安全备份".into()),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("无法检查存储目录".into()),
        }
    }
    fs::create_dir_all(root).map_err(|_| "无法创建存储目录")?;
    root.canonicalize().map_err(|_| "无法访问存储目录".into())
}

// Use a portable subset of file names; reject traversal, Windows aliases and
// case collisions even on macOS so that backups remain safe on both platforms.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 4096
        && name.split('/').count() <= 64
        && name.split('/').all(|part| {
            let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with(['.', ' '])
                && !part
                    .chars()
                    .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
                && !matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(base.len() == 4
                    && (base.starts_with("COM") || base.starts_with("LPT"))
                    && matches!(base.as_bytes()[3], b'1'..=b'9'))
        })
}

pub fn export(root: &Path, destination: &Path) -> Result<(), String> {
    let root = checked_root(root)?;
    let parent = destination
        .parent()
        .ok_or("请选择有效的保存位置")?
        .canonicalize()
        .map_err(|_| "无法访问保存位置")?;
    if parent.starts_with(&root) {
        return Err("请将 ZIP 保存到存储目录之外".into());
    }
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建备份文件")?;
    {
        let mut zip = ZipWriter::new(temporary.as_file_mut());
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600);
        zip.start_file(MANIFEST, options)
            .map_err(|_| "无法写入备份")?;
        zip.write_all(MARKER).map_err(|_| "无法写入备份")?;
        let mut stack: Vec<(PathBuf, String)> = CONTENT
            .iter()
            .map(|n| (root.join(n), n.to_string()))
            .collect();
        let mut seen = HashSet::new();
        let mut total = 0;
        // Always include the data directory, including a fresh installation.
        if !root.join("data").exists() {
            zip.add_directory("data/", options.unix_permissions(0o700))
                .map_err(|_| "无法写入备份")?;
        }
        while let Some((path, name)) = stack.pop() {
            let metadata = match fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(e)
                    if e.kind() == std::io::ErrorKind::NotFound
                        && CONTENT.contains(&name.as_str()) =>
                {
                    continue
                }
                Err(_) => return Err("文件已变化或无法读取，导出已取消".into()),
            };
            if !valid_name(&name)
                || !seen.insert(name.to_lowercase())
                || seen.len() + 2 > MAX_ENTRIES
            {
                return Err("文件名不兼容或文件过多，无法导出".into());
            }
            if is_link(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
                return Err("备份内容包含链接或特殊文件，请先移除后重试".into());
            }
            if metadata.is_dir() {
                zip.add_directory(format!("{name}/"), options.unix_permissions(0o700))
                    .map_err(|_| "无法写入备份")?;
                for entry in fs::read_dir(path).map_err(|_| "无法读取备份目录")? {
                    let entry = entry.map_err(|_| "无法读取备份文件")?;
                    let file_name = entry
                        .file_name()
                        .into_string()
                        .map_err(|_| "文件名编码不受支持")?;
                    stack.push((entry.path(), format!("{name}/{file_name}")));
                }
            } else {
                zip.start_file(name, options).map_err(|_| "无法写入备份")?;
                let file = fs::File::open(path).map_err(|_| "无法读取备份文件")?;
                let copied = std::io::copy(&mut file.take(MAX_BYTES - total + 1), &mut zip)
                    .map_err(|_| "备份写入失败，请检查磁盘空间")?;
                total += copied;
                if total > MAX_BYTES {
                    return Err("备份超过 10 GB，无法导出".into());
                }
            }
        }
        zip.finish().map_err(|_| "无法完成 ZIP 备份")?;
    }
    temporary.as_file().sync_all().map_err(|_| "无法保存备份")?;
    temporary
        .persist(destination)
        .map_err(|_| "无法保存备份，请检查目标文件权限")?;
    Ok(())
}

fn unpack(source: &Path, staging: &Path) -> Result<(), String> {
    let file = fs::File::open(source).map_err(|_| "无法读取所选 ZIP")?;
    let mut zip = ZipArchive::new(file).map_err(|_| "不是有效的 ZIP 备份")?;
    if zip.len() > MAX_ENTRIES {
        return Err("备份文件过多".into());
    }
    let mut seen = HashSet::new();
    let mut total = 0;
    let mut manifest = false;
    let mut spellings = HashMap::new();
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|_| "ZIP 损坏或已加密，无法导入")?;
        let name = entry.name().trim_end_matches('/').to_string();
        let directory = entry.is_dir();
        if !valid_name(&name) || !seen.insert(name.to_lowercase()) {
            return Err("ZIP 包含不安全或重复的路径".into());
        }
        let mut prefix = String::new();
        for part in name.split('/') {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            if let Some(previous) = spellings.insert(prefix.to_lowercase(), prefix.clone()) {
                if previous != prefix {
                    return Err("ZIP 文件路径大小写冲突".into());
                }
            }
        }
        if directory && entry.size() != 0 {
            return Err("ZIP 文件夹条目无效".into());
        }
        let mode = entry.unix_mode().unwrap_or(0) & 0o170000;
        if mode != 0 && mode != if directory { 0o040000 } else { 0o100000 } {
            return Err("ZIP 不允许包含链接或特殊文件".into());
        }
        let top = name.split('/').next().unwrap_or("");
        if name == MANIFEST && !directory {
            if entry.size() > 1024 {
                return Err("备份标识无效".into());
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(|_| "备份标识损坏")?;
            let value: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|_| "备份标识无效")?;
            if value["format"] != "chef25-backup" || value["version"] != 1 {
                return Err("不支持此备份版本".into());
            }
            manifest = true;
            continue;
        }
        if !CONTENT.contains(&top)
            || ((top == "config.yaml" || top == "launcher-settings.json")
                && (name != top || directory))
            || ((top == "data" || top == "logs") && name == top && !directory)
        {
            return Err("ZIP 内容不符合 25小厨备份格式".into());
        }
        if entry.size() > MAX_BYTES - total {
            return Err("解压后超过 10 GB，无法导入".into());
        }
        let target = staging.join(&name);
        if directory {
            fs::create_dir_all(target).map_err(|_| "无法创建导入目录")?;
        } else {
            fs::create_dir_all(target.parent().ok_or("无效备份路径")?)
                .map_err(|_| "无法创建导入目录")?;
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut output = options.open(target).map_err(|_| "备份路径冲突或无法写入")?;
            let copied = std::io::copy(&mut (&mut entry).take(MAX_BYTES - total + 1), &mut output)
                .map_err(|_| "解压失败，ZIP 损坏或磁盘空间不足；当前数据未修改")?;
            total += copied;
            if total > MAX_BYTES {
                return Err("解压后超过 10 GB，无法导入".into());
            }
            output.sync_all().map_err(|_| "无法保存导入文件")?;
        }
    }
    if !manifest || !staging.join("data").is_dir() {
        return Err("请选择由 25小厨导出的 ZIP 备份".into());
    }
    if staging.join("launcher-settings.json").exists() {
        if fs::metadata(staging.join("launcher-settings.json"))
            .map_err(|_| "无法读取启动设置")?
            .len()
            > 65536
        {
            return Err("备份中的启动设置过大".into());
        }
        let bytes =
            fs::read(staging.join("launcher-settings.json")).map_err(|_| "无法读取启动设置")?;
        let settings: crate::service::LaunchSettings =
            serde_json::from_slice(&bytes).map_err(|_| "备份中的启动设置无效")?;
        if settings.port < 1024 {
            return Err("备份中的启动端口无效".into());
        }
    }
    Ok(())
}

pub fn import(root: &Path, source: &Path) -> Result<String, String> {
    import_with_rename(root, source, fs::rename)
}

fn import_with_rename(
    root: &Path,
    source: &Path,
    mut rename: impl FnMut(PathBuf, PathBuf) -> std::io::Result<()>,
) -> Result<String, String> {
    let root = checked_root(root)?;
    // Staging on the same filesystem permits rename-based replacement. Nothing
    // in the current data set is moved until every ZIP entry has been checked.
    let staging = tempfile::Builder::new()
        .prefix(".chef25-import-")
        .tempdir_in(&root)
        .map_err(|_| "无法创建导入暂存目录")?;
    unpack(source, staging.path())?;
    let previous = tempfile::Builder::new()
        .prefix(".chef25-previous-")
        .tempdir_in(&root)
        .map_err(|_| "无法创建数据恢复目录")?;
    let mut moved = Vec::new();
    let mut installed = Vec::new();
    let replacement = (|| -> std::io::Result<()> {
        for name in REPLACE {
            match fs::symlink_metadata(root.join(name)) {
                Ok(_) => {
                    rename(root.join(name), previous.path().join(name))?;
                    moved.push(*name);
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
        }
        for name in CONTENT {
            if staging.path().join(name).exists() {
                rename(staging.path().join(name), root.join(name))?;
                installed.push(*name);
            }
        }
        Ok(())
    })();
    if replacement.is_err() {
        let mut recovered = true;
        for name in installed.iter().rev() {
            recovered &= rename(root.join(name), staging.path().join(name)).is_ok();
        }
        for name in moved.iter().rev() {
            recovered &= rename(previous.path().join(name), root.join(name)).is_ok();
        }
        if !recovered {
            let saved = previous.keep();
            let _ = staging.keep();
            return Err(format!(
                "导入失败，自动恢复未完成。请勿启动酒馆，旧数据保留在 {}，请通过打开目录恢复。",
                saved.file_name().unwrap_or_default().to_string_lossy()
            ));
        }
        return Err("导入失败，已恢复原数据，请检查目录权限和磁盘空间".into());
    }
    // Keep a failed cleanup visible; never silently leave sensitive old data.
    let old_path = previous.keep();
    if fs::remove_dir_all(&old_path).is_err() {
        return Ok(format!(
            "导入完成，但旧数据清理失败。请手动删除存储目录中的 {}（包含旧隐私数据）。",
            old_path.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    Ok("导入完成，当前数据已替换。下次启动酒馆将使用导入的数据。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = ZipWriter::new(fs::File::create(path).unwrap());
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file(MANIFEST, options).unwrap();
        zip.write_all(MARKER).unwrap();
        zip.add_directory("data/", options).unwrap();
        for (name, content) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(content).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn round_trip_replaces_data_preserves_unowned_files_and_excludes_runtime() {
        let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let root = temp.path().join("source");
        fs::create_dir_all(root.join("data/characters")).unwrap();
        fs::create_dir_all(root.join("logs")).unwrap();
        fs::create_dir_all(root.join("runtimes")).unwrap();
        fs::write(root.join("runtimes/skip"), "runtime").unwrap();
        fs::write(root.join("data/characters/角色.json"), "private content").unwrap();
        fs::write(root.join("config.yaml"), "port: 25252").unwrap();
        fs::write(root.join("logs/sillytavern.log"), "private log").unwrap();
        fs::write(root.join("launcher-settings.json"), r#"{"port":25255}"#).unwrap();
        let backup = temp.path().join("backup.zip");
        export(&root, &backup).unwrap();
        let mut zip = ZipArchive::new(fs::File::open(&backup).unwrap()).unwrap();
        assert!(zip.by_name("runtimes/skip").is_err());
        let target = temp.path().join("target");
        fs::create_dir_all(target.join("data")).unwrap();
        fs::create_dir_all(target.join("runtimes")).unwrap();
        fs::write(target.join("data/old"), "old").unwrap();
        fs::write(target.join("unrelated"), "keep").unwrap();
        import(&target, &backup).unwrap();
        assert!(!target.join("data/old").exists());
        assert!(!target.join("runtimes").exists());
        assert!(target.join("unrelated").exists());
        assert_eq!(
            fs::read_to_string(target.join("data/characters/角色.json")).unwrap(),
            "private content"
        );
        assert_eq!(
            fs::read_to_string(target.join("logs/sillytavern.log")).unwrap(),
            "private log"
        );
        assert_eq!(fs::read_dir(&target).unwrap().count(), 5);
    }

    #[test]
    fn failed_replacement_rolls_back_every_moved_entry() {
        for fail_at in 1..=5 {
            let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
            let root = temp.path().join("target");
            fs::create_dir_all(root.join("data")).unwrap();
            fs::create_dir_all(root.join("runtimes")).unwrap();
            fs::write(root.join("data/old"), "original").unwrap();
            fs::write(root.join("config.yaml"), "original config").unwrap();
            let input = temp.path().join("input.zip");
            archive(
                &input,
                &[("data/new", b"new"), ("config.yaml", b"new config")],
            );
            let mut calls = 0;
            assert!(import_with_rename(&root, &input, |from, to| {
                calls += 1;
                if calls == fail_at {
                    return Err(std::io::Error::other("simulated rename failure"));
                }
                fs::rename(from, to)
            })
            .is_err());
            assert_eq!(
                fs::read_to_string(root.join("data/old")).unwrap(),
                "original"
            );
            assert_eq!(
                fs::read_to_string(root.join("config.yaml")).unwrap(),
                "original config"
            );
            assert!(root.join("runtimes").exists());
            assert!(!root.join("data/new").exists());
            assert_eq!(fs::read_dir(&root).unwrap().count(), 3);
        }
    }

    #[test]
    fn corrupted_payload_crc_is_rejected_before_replacement() {
        let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let input = temp.path().join("input.zip");
        archive(&input, &[("data/note", b"unique-payload")]);
        let mut bytes = fs::read(&input).unwrap();
        let position = bytes
            .windows(14)
            .position(|w| w == b"unique-payload")
            .unwrap();
        bytes[position] ^= 1;
        fs::write(&input, bytes).unwrap();
        let root = temp.path().join("target");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(root.join("data/keep"), "keep").unwrap();
        assert!(import(&root, &input).is_err());
        assert!(root.join("data/keep").exists());
    }

    #[test]
    fn invalid_archives_never_touch_existing_data() {
        let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let root = temp.path().join("target");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(root.join("data/keep"), "untouched").unwrap();
        let zip = temp.path().join("input.zip");
        for entries in [
            vec![("../escape", &b"bad"[..])],
            vec![("/absolute", &b"bad"[..])],
            vec![("data/CON.txt", &b"bad"[..])],
            vec![("data/a\\b", &b"bad"[..])],
            vec![("data/a:stream", &b"bad"[..])],
            vec![("data/a", &b"a"[..]), ("data/A", &b"b"[..])],
            vec![("data/A/one", &b"a"[..]), ("data/a/two", &b"b"[..])],
            vec![("runtimes/executable", &b"bad"[..])],
            vec![("launcher-settings.json", &b"{\"port\":80}"[..])],
        ] {
            archive(&zip, &entries);
            assert!(import(&root, &zip).is_err());
            assert_eq!(
                fs::read_to_string(root.join("data/keep")).unwrap(),
                "untouched"
            );
            assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        }
        fs::write(&zip, b"broken zip").unwrap();
        assert!(import(&root, &zip).is_err());
        assert!(root.join("data/keep").exists());
    }

    #[test]
    fn confirmation_and_export_destination_are_guarded() {
        assert!(confirm(false, "确认导出").is_ok());
        assert!(confirm(true, "确认覆盖导入").is_ok());
        for text in ["", "确认导出 ", "确认导入", "确认重置"] {
            assert!(confirm(true, text).is_err());
        }
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        assert!(export(root.path(), &root.path().join("recursive.zip")).is_err());
        assert!(!root.path().join("recursive.zip").exists());
    }

    #[test]
    fn symlink_zip_entries_are_rejected() {
        let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let zip_path = temp.path().join("input.zip");
        let mut zip = ZipWriter::new(fs::File::create(&zip_path).unwrap());
        zip.add_symlink("data/link", "../../outside", SimpleFileOptions::default())
            .unwrap();
        zip.finish().unwrap();
        assert!(import(&temp.path().join("target"), &zip_path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn export_rejects_links_without_replacing_existing_backup() {
        let temp = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let root = temp.path().join("root");
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(temp.path().join("outside"), "private").unwrap();
        std::os::unix::fs::symlink(temp.path().join("outside"), root.join("data/link")).unwrap();
        let zip = temp.path().join("existing.zip");
        fs::write(&zip, "existing backup").unwrap();
        assert!(export(&root, &zip).is_err());
        assert_eq!(fs::read_to_string(zip).unwrap(), "existing backup");
    }
}
