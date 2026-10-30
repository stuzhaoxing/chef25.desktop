# 25小厨 · Chef25 Desktop

**为你的酒馆，备好一切。** 一个面向 Windows 和 macOS 的开源 SillyTavern 桌面启动器。

> 开发预览渠道。0.2.0 发布流程要求 macOS Developer ID 签名与 Apple 公证；Windows 尚无 Authenticode。构建和 CI 冒烟不替代真实设备验收。

## 现在能做什么

- 一键启动、打开、停止随包提供的 SillyTavern 1.19.0。
- 酒馆直接在主窗口内打开，保留侧边导航；酒馆内容不授予原生文件或 Shell 权限。
- 支持手动设置启动端口：默认 25252，占用时提示更换端口；支持同一局域网手机访问，不接管、不结束其他程序。
- 角色、聊天、配置保存在应用数据目录，运行环境按上游 commit 隔离。
- 单实例运行，点击主窗口关闭按钮后最小化到 Dock / 任务栏，酒馆继续运行。点击最小化窗口、托盘图标（macOS 菜单栏）、选择「显示主窗口」或再次打开应用可恢复窗口；托盘菜单「退出 25小厨」及系统退出操作会回收本次启动的服务，并取消尚未完成的启动。
- 启动后自动检查更新，发现新版时在左下角「关于」旁显示「有新版本」提示；点击可查看版本、手动检查；确认后下载、验证签名、安装并重启。

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

| 服务               | 地址                             |
| ------------------ | -------------------------------- |
| Vite 与 HMR        | `127.0.0.1:25251`                |
| 开发版 SillyTavern | `127.0.0.1:25272`                |
| 正式版 SillyTavern | `127.0.0.1:25252`                |
| 远程密码网关       | `127.0.0.1` 上的系统分配临时端口 |
| 静态预览           | `127.0.0.1:25253`                |

`npm run desktop:dev` 使用 `com.chef25.desktop.dev`（窗口和 Dock 显示「25小厨 Dev」），单实例锁、应用数据与正式版独立，可以同时运行。开发数据位于 macOS `~/Library/Application Support/com.chef25.desktop.dev` 或 Windows `%APPDATA%/com.chef25.desktop.dev`，不自动复制正式版数据。开发版默认酒馆端口 25272，正式版默认 25252，各自保存的启动端口仍优先；远程密码网关使用系统分配的回环临时端口。根目录 `dev.sh` 只检查网站与 Vite 端口，绝不结束已有监听进程。

开发模式及 `desktop:build:dev` 生成的 debug 测试包，其远程访问申请、容量查询、续租和释放调用本地 `http://127.0.0.1:25250/api/remote/`，不会在失败时回退到官网；release 构建使用官网 HTTPS 接口。本地网站需单独运行或通过根目录 `dev.sh` 一并启动。真实隧道仍需在网站 `.env.local` 配置远程服务开关及 Cloudflare 账号、zone、API Token，详见网站仓库 `deploy/remote-access.md`；未配置时本地接口返回 503，不代表线上服务故障。

dev 重编译重启桌面进程时，本次启动的酒馆会随父进程断开自动停止并释放端口（最多约 3 秒），随后可再次启动。

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

强制终止、操作系统崩溃或断电可能留下服务进程；下次启动时提示端口冲突，不盲目接管。最小化收起后，可通过托盘菜单「退出 25小厨」或系统退出操作彻底退出。

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

酒馆运行时，侧栏显示绿色状态点、同行的轻量「停止」按钮，以及「手机访问」入口。点击打开连接面板，在「同一 Wi-Fi」或「远程访问」中查看二维码、复制地址及远程登录信息；关闭面板不会断开连接。手机与电脑连接同一 Wi-Fi，扫码即可打开同一个酒馆；电脑需保持运行。存在多个网卡时，可选择手机所在网络对应的地址。未连接局域网时显示提示，不生成本机回环地址二维码。电脑防火墙需允许该端口的局域网连接。

启动器监听 IPv4，强制启用白名单，仅允许本机与 RFC1918 私有网络地址（10/8、172.16/12、192.168/16）；不会改写用户 config.yaml 的访问设置，既有登录验证仍生效。同一局域网内可访问此酒馆，请在可信网络使用。公网穿透可在设置中单独开启，见下方 Cloudflare 试用说明。二维码在本机生成，不请求外部二维码服务。

## ZIP 备份与恢复

导出默认文件名包含电脑本地时间，例如 `25小厨备份_2026-10-29_16-30-05.zip`，可在保存对话框中修改。

「本地数据」支持导出和导入 ZIP，必须先停止酒馆。导出输入“确认导出”，再选择保存位置（须位于存储目录之外）；备份包含 `data/`、`config.yaml`、`launcher-settings.json` 和 `logs/`，不包含可重新生成的 `runtimes/`。ZIP 未加密、不会自动脱敏，可能含私人聊天、账号与 API 密钥，请妥善保管。

导入输入“确认覆盖导入”后选择由本应用导出的可信 ZIP。当前角色、聊天、配置、启动设置、日志和运行副本将被替换或清除，不会合并，请先导出旧数据。先在同一磁盘暂存解压并校验格式、路径及 CRC，校验失败不修改当前数据；替换失败尝试恢复原数据，恢复失败时保留恢复目录并提示。导入需要足够空间同时存放新旧数据；目前限制为 10 GB 解压内容和 100,000 个 ZIP 条目，不支持加密 ZIP、链接或跨平台不安全的文件名。导入过程中请勿退出应用或断电；异常中断不保证自动恢复。此功能的自动测试使用隔离临时目录，不接触真实用户数据。

## 联系开发者

通过「关于」底部的「联系开发者」打开微信二维码，添加好友时请备注「来自 25小厨」；也可点击 GitHub Issues 反馈问题或建议。二维码随应用和网站提供，无需从其他服务加载。

## Cloudflare 远程访问（试用）

在「手机访问 → 远程访问」中申请即可，由 `www.chef25.com` 自动申请隧道并显示本机固定地址，不需要填写 Cloudflare Token、HTTPS 域名或入口端口。手机浏览器扫码访问，无需安装客户端。每次启动酒馆后均须手动申请，不再读取旧版自动连接开关。申请成功后持续续租，关闭面板或收起窗口不会释放；停止酒馆或手动关闭远程访问会回收隧道和 DNS，设备地址绑定保留。免费名额已满或分配失败时本地酒馆继续使用。

手机首次访问的用户名为 `chef25`，密码由本机安全生成，在已连接面板显示。设备身份及访问密码保存在应用数据目录的 `private-remote/`：Unix 目录 0700、身份文件 0600；不出现在文件浏览器、日志或 ZIP 备份中，重置/导入不会覆盖它们。不要手动分享或复制这个目录；删除应用数据将获得新身份和新地址。Cloudflare 账号 API Token 只在官网服务器，Desktop 仅收到本次租约的独立连接器 Token。

首次开启从官方 GitHub Release 下载 `runtime.lock.json` 固定版本的 cloudflared 并校验 SHA-256。macOS 下载对应架构 TGZ，Windows x64 下载官方 EXE；不增加安装包数量。缓存位于 `remote-client/cloudflared/`，不纳入备份。每次启动从验证后的下载文件恢复可执行文件。以前下载的 OpenFrp 缓存不再运行。

本机密码网关仅监听系统分配的回环临时端口，账号/密码验证后才转发到当前酒馆。保留 `text/event-stream`、直接传输 SSE 响应，不支持 WebSocket 升级。手机仍需完成酒馆已有的账号登录；酒馆另设 HTTP Basic Auth 时暂不支持叠加两层 Basic Auth。只有外网 HTTPS 返回本次入口标识及 401 才显示二维码；状态表示进程运行，不代替手机实际网络测试。

原生线程每 30 秒续租，也检查酒馆及隧道进程；持续无法续期会关闭本机入口，无需前端保持显示。停止酒馆、安装更新或正常退出先关闭本机入口和 cloudflared，再尽力释放云端租约；崩溃或断网由服务器过期回收兜底，清理失败仍占用名额。临时连接器 Token 使用私有文件传递，不进入命令参数或备份；正常清理会删除，强制终止不保证移除临时文件。

服务端最多允许账号内 1,000 条隧道，且使用保守的免费 DNS 200 条上限（扣除现有记录），因此实际同时在线数会更低。没有付费扩容或自动升级。平台管理员及 Cloudflare 仍是可信路由管理方。免费套餐 HTTP 请求大小和网络质量仍受 Cloudflare 服务限制，较大 ZIP 请在电脑上操作。

这部分为本地实现，官网账号/域名配置、独立回收服务启用、真实手机网络和 Windows 执行仍需上线验收，不代表已发布。网站端部署和额度策略见官网仓库的 `deploy/remote-access.md`；国内体验需实测。

## 教程入口

侧栏固定显示「中文文档」，点击即可查看使用教程；设置页不再提供显隐开关。

## 酒馆使用文档

「中文文档」加载官网 `/guides/sillytavern/` 的中文使用文档，网站和 App 共用页面及搜索。译稿按官方 Usage 目录组织，逐句校对状态在页面上说明。需要联网；超时可刷新或选择网页阅读。旧版 App 仍使用旧文章 API，更新 App 后切换。开发时先启动网站 25250 端口。文档 iframe 使用固定来源、沙箱隔离和校验来源的加载通知，不授予原生权限。
