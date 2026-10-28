# 25小厨 · Chef25 Desktop

**为你的酒馆，备好一切。** 一个面向 Windows 和 macOS 的开源 SillyTavern 桌面启动器。

> 开发预览，尚未发布正式安装包。构建成功不等于目标平台安装、签名和运行验收完成。

## 现在能做什么

- 一键启动、打开、停止随包提供的 SillyTavern 1.19.0。
- 独立酒馆窗口，远程内容不授予原生文件或 Shell 权限。
- 固定回环端口，冲突即报错；不接管、不结束其他程序。
- 角色、聊天、配置保存在应用数据目录，运行环境按上游 commit 隔离。
- 单实例运行，正常退出时回收本次启动的服务。

模型服务、账号与 API Key 由用户在 SillyTavern 中自行配置。本项目目前没有付费额度、角色市场、自动更新或移动端。

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

应用内「本地数据」显示确切路径。典型位置：macOS `~/Library/Application Support/com.chef25.desktop`；Windows `%APPDATA%/com.chef25.desktop`。

- `data/`：SillyTavern 用户数据，升级不覆盖。
- `config.yaml`：用户配置，升级不覆盖。
- `runtimes/<commit>/`：可写运行副本；首次启动从应用资源准备。
- `logs/sillytavern.log`：当前运行日志，可能含个人内容，分享前脱敏。

强制终止、操作系统崩溃或断电可能留下服务进程；下次启动会拒绝占用端口，不盲目接管。当前没有后台托盘常驻。

## 开源与发布

项目采用 **AGPL-3.0-only**。SillyTavern 源码不做私有修改；版本、commit、归档 SHA-256 固定在 `runtime.lock.json`。分发包含对应源码归档和许可证。详情见 [第三方说明](THIRD_PARTY_NOTICES.md)。

- [贡献指南](CONTRIBUTING.md) · [安全反馈](SECURITY.md) · [行为准则](CODE_OF_CONDUCT.md)
- [架构说明](docs/architecture.md) · [发布流程](docs/releasing.md) · [变更记录](CHANGELOG.md)
- 官网：[www.chef25.com](https://www.chef25.com)

25小厨是独立项目，与 SillyTavern 官方无隶属关系。感谢 [SillyTavern](https://github.com/SillyTavern/SillyTavern)、[Tauri](https://tauri.app/) 和所有贡献者。
