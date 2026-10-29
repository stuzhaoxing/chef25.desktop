# 25小厨 · Chef25 Desktop

**为你的酒馆，备好一切。** 一个面向 Windows 和 macOS 的开源 SillyTavern 桌面启动器。

> 开发预览渠道。0.2.0 发布流程要求 macOS Developer ID 签名与 Apple 公证；Windows 尚无 Authenticode。构建和 CI 冒烟不替代真实设备验收。

## 现在能做什么

- 一键启动、打开、停止随包提供的 SillyTavern 1.19.0。
- 酒馆直接在主窗口内打开，保留侧边导航；酒馆内容不授予原生文件或 Shell 权限。
- 支持手动设置启动端口：默认 25252，占用时提示更换端口；支持同一局域网手机访问，不接管、不结束其他程序。
- 角色、聊天、配置保存在应用数据目录，运行环境按上游 commit 隔离。
- 单实例运行，关闭主窗口仅最小化到 Dock／任务栏，酒馆继续运行；再次打开应用会恢复窗口。通过系统退出操作退出时回收本次启动的服务，并取消尚未完成的启动。
- 启动后自动检查更新，也可在左下角「关于」弹窗查看版本、手动检查；确认后下载、验证签名、安装并重启。

模型服务、账号与 API Key 由用户在 SillyTavern 中自行配置。本项目目前没有付费额度、角色市场或移动端。

## 本地开发

正式预览目标为 macOS 13.5+（Universal）与 Windows x64。

需要 Node.js（版本见 `.node-version`）、npm、Rust stable，以及 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)。macOS 需要 Xcode Command Line Tools；Windows 需要 C++ Build Tools 和 WebView2。

```sh
npm ci
npm run runtime:prepare
npm run desktop:dev
```

首次准备需要联网下载固定版本的 SillyTavern 和 npm 依赖。之后安装包内带 Node.js 和酒馆源码，无需最终用户安装 Node.js / Git。

| 服务        | 地址              |
| ----------- | ----------------- |
| Vite 与 HMR | `127.0.0.1:25251` |
| SillyTavern | `127.0.0.1:25252` |
| 静态预览    | `127.0.0.1:25253` |

`npm run dev` 只预览 UI，浏览器中禁用原生启动按钮。端口冲突时请处理对应程序，禁止自动杀占用者。

## 检查与构建

```sh
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build -- --target universal-apple-darwin --bundles dmg # macOS
# Windows: npm run desktop:build -- --bundles nsis
```

macOS 发布使用一个 Universal 安装包，Rust 主程序与内置 Node.js 均包含 Apple Silicon 和 Intel 两种架构；Windows 发布一个 x64 安装包。Node.js 从官方固定版本归档下载并校验哈希，不复制开发者本机可执行文件。`package-lock.json` 和 `Cargo.lock` 必须随版本提交。

## 数据与故障排查

应用内「本地数据」显示确切路径，并提供以此目录为根的只读文件浏览器：打开系统文件夹、复制路径、文件夹导航、返回上级、刷新、当前目录搜索、按名称/大小/修改时间排序，以及不超过 128 KB 的 UTF-8 文本预览。链接不可打开。典型位置：macOS `~/Library/Application Support/com.chef25.desktop`；Windows `%APPDATA%/com.chef25.desktop`。

- `data/`：SillyTavern 用户数据，升级不覆盖。
- `config.yaml`：用户配置，升级不覆盖。
- `runtimes/<commit>/`：可写运行副本；首次启动从应用资源准备。
- `logs/sillytavern.log`：当前运行日志，可能含个人内容，分享前脱敏。

强制终止、操作系统崩溃或断电可能留下服务进程；下次启动时提示端口冲突，不盲目接管。当前没有后台托盘常驻。

## 开源与发布

项目采用 **AGPL-3.0-only**。SillyTavern 源码不做私有修改；版本、commit、归档 SHA-256 固定在 `runtime.lock.json`。分发包含对应源码归档和许可证。详情见 [第三方说明](THIRD_PARTY_NOTICES.md)。

- [贡献指南](CONTRIBUTING.md) · [安全反馈](SECURITY.md) · [行为准则](CODE_OF_CONDUCT.md)
- [架构说明](docs/architecture.md) · [发布流程](docs/releasing.md) · [变更记录](CHANGELOG.md)
- [R2 下载分发与自动发布接入](docs/r2-distribution.md)
- 官网：[www.chef25.com](https://www.chef25.com)

25小厨是独立项目，与 SillyTavern 官方无隶属关系。感谢 [SillyTavern](https://github.com/SillyTavern/SillyTavern)、[Tauri](https://tauri.app/) 和所有贡献者。

## 应用内更新

0.1.0 没有更新模块，需从官网手动安装 0.2.0 一次。0.2.0 起启动三秒后检查新版本；不会未经确认安装。更新包通过独立签名和版本核对后，才停止本应用启动的酒馆服务并安装。角色、聊天、配置及日志保留在应用数据目录。网络或签名检查失败时不停止酒馆；安装失败后可重新启动酒馆并重试。

macOS 更新包与 DMG 中的应用均经过 Developer ID 签名、公证及票据装订。Windows 的更新包签名用于验证更新来源，不等同于 Windows Authenticode，系统仍可能提示未知发布者。

## 启动端口

侧边栏「设置」可手动设置启动端口（1024–65535），默认 25252。运行时端口只读，需停止酒馆后才能修改和保存。设置保存在应用数据目录的 `launcher-settings.json`，启动时使用保存的端口。端口被占用时提示更换，不自动切换端口。旧设置保留端口值，忽略原有模式。实际运行地址可在「设置」查看。

## 重置酒馆数据

设置页「危险操作」可重置酒馆。请先自行备份，再停止酒馆并在确认弹窗中完整输入“确认重置”。重置永久清除应用数据目录内的 `data/`、`config.yaml`、`logs/`、`runtimes/` 和启动设置临时文件，包括角色、聊天及 API 配置；启动端口（`launcher-settings.json`）保持不变，下次启动重新初始化。安装包与其他目录不会删除。失败时可能已经清除部分数据，界面会提示重试。

## 手机扫码聊天

酒馆运行时，侧栏显示绿色状态点、同行的轻量「停止」按钮，以及手机访问二维码和地址复制。手机与电脑连接同一 Wi-Fi，扫码即可打开同一个酒馆；电脑需保持运行。存在多个网卡时，可选择手机所在网络对应的地址。未连接局域网时显示提示，不生成本机回环地址二维码。电脑防火墙需允许该端口的局域网连接。

启动器监听 IPv4，强制启用白名单，仅允许本机与 RFC1918 私有网络地址（10/8、172.16/12、192.168/16）；不会改写用户 config.yaml 的访问设置，既有登录验证仍生效。同一局域网内可访问此酒馆，请在可信网络使用。公网穿透可在设置中单独开启，见下方 OpenFrp 试用说明。二维码在本机生成，不请求外部二维码服务。

## ZIP 备份与恢复

导出默认文件名包含电脑本地时间，例如 `25小厨备份_2026-10-29_16-30-05.zip`，可在保存对话框中修改。

「本地数据」支持导出和导入 ZIP，必须先停止酒馆。导出输入“确认导出”，再选择保存位置（须位于存储目录之外）；备份包含 `data/`、`config.yaml`、`launcher-settings.json` 和 `logs/`，不包含可重新生成的 `runtimes/`。ZIP 未加密、不会自动脱敏，可能含私人聊天、账号与 API 密钥，请妥善保管。

导入输入“确认覆盖导入”后选择由本应用导出的可信 ZIP。当前角色、聊天、配置、启动设置、日志和运行副本将被替换或清除，不会合并，请先导出旧数据。先在同一磁盘暂存解压并校验格式、路径及 CRC，校验失败不修改当前数据；替换失败尝试恢复原数据，恢复失败时保留恢复目录并提示。导入需要足够空间同时存放新旧数据；目前限制为 10 GB 解压内容和 100,000 个 ZIP 条目，不支持加密 ZIP、链接或跨平台不安全的文件名。导入过程中请勿退出应用或断电；异常中断不保证自动恢复。此功能的自动测试使用隔离临时目录，不接触真实用户数据。

## 联系开发者

通过「关于」底部的「联系开发者」打开微信二维码，添加好友时请备注「来自 25小厨」；也可点击 GitHub Issues 反馈问题或建议。二维码随应用和网站提供，无需从其他服务加载。

## OpenFrp 远程访问（试用）

设置 → 远程访问，先启动酒馆，导入自己的 OpenFrp 单隧道 INI 配置，再填写 HTTPS 根地址和至少 16 字节访问密码。当前支持 `common` 加一个 `type = http` 隧道，要求节点为外网域名终止 HTTPS；不支持 TCP、HTTPS 直通、插件、模板、额外代理或 TOML。平台导出的额外高级选项会被明确拒绝。免费账号可用节点、域名、证书和认证条件须以实际控制台为准，不能保证所有免费账号均满足此模式。

首次开启从官方 HTTPS 下载源获取 `runtime.lock.json` 固定的 OpenFrp 客户端，校验 SHA-256 后只提取对应架构的可执行文件。macOS Intel/Apple Silicon 和 Windows x64 分别获取对应版本，不增加安装包数量。客户端缓存位于应用数据目录 `remote-client/`，不纳入 ZIP 备份；安装包不预装第三方客户端。缓存损坏会重新下载，可执行文件每次从已验证归档恢复。下载失败不会打开公网入口。

入口使用独立的本机密码网关，用户名 `chef25`；验证在任何请求转发前进行，支持 HTTP 流式输出，不支持 WebSocket 升级。已有酒馆账号登录仍需正常完成；酒馆另设 HTTP Basic Auth 时暂不支持叠加两层 Basic Auth。启动器强制重写隧道目标为此网关，保留酒馆的局域网白名单。开启时只有外部 HTTPS 返回本次网关标识及 401 才视为成功；验证失败清理进程。运行状态仅表示进程存活，不代表持续外网健康检查。

隧道配置与访问密码不持久保存；敏感 INI 仅写入连接期间的临时目录（Unix 文件权限 0600），正常停止后清除，不写入日志、启动设置或备份。停止酒馆、更新和正常退出会关闭网关及 FRPC，重新启动不会自动开放公网。操作系统崩溃/强制终止可能留下 FRPC 或临时配置，不能把正常退出清理当成崩溃恢复保证。用户应妥善保护本机账号。

本接入由社区开发，OpenFrp 官方不负责除节点问题以外的技术支持。参考 [客户端文档](https://docs.openfrp.net/use/frpc) 和 [服务条款](https://www.openfrp.net/policy/)。当前是本地试用实现：未接入真实账号，未验证三网访问、免费 HTTPS 节点或 Windows 安装运行；没有购买、注册、实名认证或发布操作。

## 教程入口

「设置 → 界面显示 → 显示入门教程」控制侧栏的「酒馆入门」，默认开启，修改立即生效，无需停止酒馆。偏好保存在本机启动器 WebView 的 localStorage，重新打开应用后保留；它不包含在酒馆 ZIP 备份中。关闭后可在同一处恢复。
