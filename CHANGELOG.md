# Changelog

## Unreleased

- 下载服务改为 Pages Functions，仅需在现有 DNS 添加下载子域名 CNAME；保留流式下载、Range 和私有桶限制，关闭预览环境下载。

### Changed

- 发布流水线支持 Cloudflare R2 与自定义下载域名，保留旧客户端更新入口。
- 上传完成并通过公开下载 SHA-256、Range 校验后才更新版本清单；拒绝同版本覆盖、自动降级与并发发布，支持原始产物重试和历史版本迁移。
- 使用私有 R2 与 Pages Functions 下载入口（Workers Free），每请求最多两次读取，支持断点续传与停服开关；发布前检查 9 GB 容量预算和未完成分片。
- 提供 R2 初始化脚本、固定发布依赖和分阶段上线说明；尚未切换线上下载服务。

## 0.2.0

### Added

- 启动后检查更新、手动检查、下载进度和确认安装；保留角色、聊天、配置及日志。
- 更新包签名与版本绑定校验；验证成功后才停止本应用启动的酒馆服务。
- macOS Universal 应用、内置 Node 和 DMG 的 Developer ID 签名，以及应用和 DMG 的 Apple 公证、票据装订和 Gatekeeper 检查。
- 独立 macOS / Windows 签名环境，服务器发布更新清单，官网保留两个安装包。

### Fixed

- CI 临时钥匙串加入并恢复用户搜索列表，签名凭据包含 Apple 中间证书；签名错误仅公开脱敏类别。

- CI 通过 HFS hybrid 转压缩 DMG 创建安装镜像，避免创建过程依赖临时挂载。

- Apple 接受公证后，对尚未可用的装订票据进行有限重试；失败保留已签名归档，仍阻止发布。

### Migration

- 0.1.0 用户需手动安装 0.2.0；以后可通过应用内更新。
- Windows 尚未配置 Authenticode；更新签名不替代系统代码签名。

## 0.1.0

### Added

- Tauri 2 桌面启动器：启动、停止、打开本地 SillyTavern。
- 固定上游版本及归档校验，随包携带 Node.js、源码和第三方许可。
- 独立数据目录、启动就绪检查、单实例和端口冲突保护。
- Windows / macOS CI 与服务器磁盘分发流程。

### Fixed

- Windows 构建使用系统自带的 tar.exe，避免 Git Bash 将盘符识别为远程归档地址。
- macOS 构建使用系统 HTTPS 客户端下载 Node 归档，增加连接超时与有限重试，保留固定 SHA-256 校验。
- 发布流水线由 Linux 任务准备上游归档，通过 Actions 分发并在构建前再次校验，避免 macOS runner 下载 Node 归档过慢。

### Known limitations

- 0.1.0 为未签名预览包，各平台真实设备验收仍需单独进行。
- 不包含账号、中转、计费、角色市场、自动更新和移动端。
- 首次启动会复制运行环境，需要额外磁盘空间。
