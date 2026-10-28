# Changelog

## Unreleased

### Added

- Tauri 2 桌面启动器：启动、停止、打开本地 SillyTavern。
- 固定上游版本及归档校验，随包携带 Node.js、源码和第三方许可。
- 独立数据目录、启动就绪检查、单实例和端口冲突保护。
- Windows / macOS CI 与服务器磁盘分发流程。

### Fixed

- Windows 构建使用系统自带的 tar.exe，避免 Git Bash 将盘符识别为远程归档地址。

### Known limitations

- 尚未发布正式安装包，签名、公证和各平台真实安装验收待完成。
- 不包含账号、中转、计费、角色市场、自动更新和移动端。
- 首次启动会复制运行环境，需要额外磁盘空间。
