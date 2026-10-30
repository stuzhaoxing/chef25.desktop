use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: String,
    kind: &'static str,
    size: u64,
    modified: Option<u64>,
}

// Resolve only relative paths below the app-owned root. Links are listed but
// never followed, including junctions/reparse points on Windows.
fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if Path::new(relative).components().any(|c| matches!(c, Component::Normal(n) if n.to_string_lossy().eq_ignore_ascii_case("private-remote"))) {
        return Err("设备凭据不可浏览".into());
    }
    let mut target = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(name) = component else {
            return Err("只能浏览本地数据目录内的文件".into());
        };
        target.push(name);
        let metadata = fs::symlink_metadata(&target).map_err(|_| "文件已移动或无法访问")?;
        if is_link(&metadata) {
            return Err("不支持打开链接，请浏览实际文件夹".into());
        }
    }
    let canonical_root = root.canonicalize().map_err(|_| "无法访问存储目录")?;
    let canonical_target = target.canonicalize().map_err(|_| "文件已移动或无法访问")?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err("只能浏览本地数据目录内的文件".into());
    }
    if canonical_target.strip_prefix(&canonical_root).map_err(|_| "无法解析文件路径")?.components().any(|c| matches!(c, Component::Normal(n) if n.to_string_lossy().trim_end_matches(['.', ' ']).eq_ignore_ascii_case("private-remote"))) {
        return Err("设备凭据不可浏览".into());
    }
    Ok(canonical_target)
}

pub(crate) fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}

pub fn list(root: &Path, relative: &str) -> Result<Vec<Entry>, String> {
    if relative.is_empty() && !root.exists() {
        return Ok(Vec::new());
    }
    let target = resolve(root, relative)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(target).map_err(|_| "无法读取此文件夹")? {
        let entry = entry.map_err(|_| "无法读取文件夹条目，请刷新重试")?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "文件名编码不受支持")?;
        if name.eq_ignore_ascii_case("private-remote") {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|_| "文件已变化，请刷新重试")?;
        let kind = if is_link(&metadata) {
            "link"
        } else if metadata.is_dir() {
            "directory"
        } else if metadata.is_file() {
            "file"
        } else {
            "other"
        };
        entries.push(Entry {
            path: if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            },
            name,
            kind,
            size: metadata.len(),
            modified: metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
        });
    }
    entries.sort_by_cached_key(|entry| (entry.kind != "directory", entry.name.to_lowercase()));
    Ok(entries)
}

pub fn preview(root: &Path, relative: &str) -> Result<String, String> {
    let target = resolve(root, relative)?;
    if !fs::metadata(&target)
        .map_err(|_| "无法读取文件信息")?
        .is_file()
    {
        return Err("此项目不是普通文件".into());
    }
    let file = fs::File::open(target).map_err(|_| "无法读取此文件")?;
    if !file.metadata().map_err(|_| "无法读取文件信息")?.is_file() {
        return Err("此项目不是普通文件".into());
    }
    let mut bytes = Vec::new();
    file.take(128 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取此文件")?;
    if bytes.len() > 128 * 1024 {
        return Err("文件超过 128 KB，暂不支持内置预览".into());
    }
    if bytes.contains(&0) {
        return Err("此文件暂不支持文本预览".into());
    }
    String::from_utf8(bytes).map_err(|_| "此文件暂不支持文本预览（仅支持 UTF-8）".into())
}

// Only fixed application-owned entries are removed, never a renderer-supplied path.
pub fn reset(root: &Path) -> Result<(), String> {
    for ancestor in root.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if is_link(&metadata) => {
                return Err("数据目录包含链接，无法安全重置".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("无法检查数据目录，未执行重置".into()),
        }
    }
    for name in [
        "data",
        "config.yaml",
        "logs",
        "runtimes",
        "launcher-settings.json.tmp",
    ] {
        let path = root.join(name);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("重置未完成，部分数据可能已清除；请检查目录权限后重试".into()),
        };
        // remove_dir_all does not follow symlinks. Windows directory reparse
        // points must be removed as directories, not with remove_file.
        let result = if metadata.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        result.map_err(|_| "重置未完成，部分数据可能已清除；请检查目录权限后重试")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reset_clears_only_owned_entries_and_does_not_follow_links() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("chef25-reset-storage-{}", std::process::id()));
        let outside = root.with_extension("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep"), "keep").unwrap();
        for name in ["data", "logs", "runtimes"] {
            fs::create_dir_all(root.join(name)).unwrap();
            fs::write(root.join(name).join("private"), "delete").unwrap();
        }
        for name in [
            "config.yaml",
            "launcher-settings.json",
            "launcher-settings.json.tmp",
            "unrelated",
        ] {
            fs::write(root.join(name), "content").unwrap();
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("data/link")).unwrap();
            let alias = root.with_extension("alias");
            std::os::unix::fs::symlink(&root, &alias).unwrap();
            assert!(reset(&alias).is_err());
            assert!(root.join("data/private").exists());
            fs::remove_file(alias).unwrap();
        }
        reset(&root).unwrap();
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        assert!(root.join("unrelated").exists());
        assert_eq!(
            fs::read_to_string(root.join("launcher-settings.json")).unwrap(),
            "content"
        );
        assert!(!root.join("launcher-settings.json.tmp").exists());
        assert_eq!(fs::read_to_string(outside.join("keep")).unwrap(), "keep");
        reset(&root).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn browse_and_preview_stay_inside_root() {
        let root = std::env::temp_dir().join(format!("chef25-browser-{}", std::process::id()));
        fs::create_dir_all(root.join("folder")).unwrap();
        fs::write(root.join("note.txt"), "你好").unwrap();
        fs::write(root.join("large.txt"), vec![b'a'; 128 * 1024 + 1]).unwrap();
        fs::write(root.join("binary"), [0, 1, 2]).unwrap();
        assert_eq!(list(&root, "").unwrap()[0].name, "folder");
        assert_eq!(preview(&root, "note.txt").unwrap(), "你好");
        assert!(list(&root, "folder").unwrap().is_empty());
        assert!(preview(&root, "large.txt").is_err());
        assert!(preview(&root, "binary").is_err());
        assert!(resolve(&root, "../outside").is_err());
        assert!(resolve(&root, root.to_str().unwrap()).is_err());
        assert!(resolve(&root, "folder/../../outside").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(std::env::temp_dir(), root.join("link")).unwrap();
            assert!(list(&root, "link").is_err());
            assert!(preview(&root, "link/file").is_err());
        }
        fs::remove_dir_all(&root).unwrap();
        assert!(list(&root, "").unwrap().is_empty());
    }
}
