# 发布流程

## 当前发布渠道

目前仅提供 **开发预览** 流程。0.2.0 起 macOS 发布必须通过 Developer ID 签名、Apple 公证与 Gatekeeper 检查；Windows 尚无 Authenticode。官网按平台显示实际签名状态，仍保留预览标记。CI 不替代真实设备交互验收。

## 构建与同步

1. 在同一个 PR 更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`Cargo.lock`、`tauri.conf.json` （界面从包版本读取），补齐 CHANGELOG。
2. 合并到 main，确认 Quality checks 通过。
3. Actions → **Build and publish desktop preview** → Run workflow。首次检查可不选 publish，仅保存产物；选中 publish 后两个平台通过才自动上传 R2，公开清单验证成功后自动创建 GitHub Pre-release；首次需完成 [R2 接入](r2-distribution.md)。
4. 两个安装包：macOS Universal（Apple Silicon + Intel）和 Windows x64。macOS runner 交叉编译两个 Rust 架构并合并，内置 Node.js 也合并为 Universal；CI 验证两种 Node 架构均能执行。
   Linux 准备任务先下载固定版本的上游归档并校验，通过 Actions artifact 传给两个构建任务。构建任务通过 `CHEF25_RUNTIME_ARCHIVES` 读取归档并再次校验，避开 macOS runner 到 Node CDN 的慢速链路；缓存缺失或哈希不符直接失败。
5. 流水线执行格式、类型、单测、Clippy、真实酒馆启停与数据保留测试。Windows 另做安装、进程存活与卸载冒烟；macOS 校验最终 DMG 容器。
6. 汇总两个安装包及其 SHA-256，并生成匹配当前 commit 的源码归档。所有产物通过 R2 S3 API 上传，发布器校验哈希、密码学签名及清单一致性，再通过自定义域名完整下载验证 SHA-256 与 Range。全部通过后分别更新 `updater.json` 和 `latest.json`；两份清单并非跨对象原子事务，但都只指向已验证完整版本。发布的原始 distribution artifact 保存 14 天，供相同字节重试。

源码与安装包位于同一个 `/downloads/v<version>/`，同版本文件不可覆盖。代码修复必须升级版本号。仅网络故障可重试完全相同的产物；重新构建可能产生不同字节，因此不得覆盖已发布版本。

GitHub Release 使用 `v<version>` 标签并指向本次构建的精确 commit，说明取自 CHANGELOG 对应版本，附件直接复用已发布的 distribution（两个安装包、macOS 更新包、匹配源码、两份清单和 SHA256SUMS）。保持 Pre-release 标记，不设为 Latest。只有最后的 `github-release` job 获得 `contents: write`，使用内置 `GITHUB_TOKEN`，无需新增密钥。仅构建或 R2 发布验证失败时不会创建 Release。

如果 GitHub Release 步骤失败，R2 已完成的发布仍然有效。优先仅重跑失败的 job，复用原始 distribution；已有同名 Release 时命令会失败，不覆盖附件。上传中断留下的草稿需核对原始 distribution 后补齐并发布，或删除未发布草稿再重跑该 job；不得删除、移动已发布版本标签。已有标签指向其他 commit 时停止。

## GitHub 配置

环境：`downloads-preview`，限制为 main 分支。R2 发布所需变量、密钥、初始化、旧版迁移与回滚步骤见 [R2 分发接入](r2-distribution.md)。日常发布不再使用下载服务器的 SSH 密钥。

旧 `deploy/receive-release.py` 和服务器磁盘配置保留供迁移前使用与回滚；不通过旧接收端发布带有新下载域名的清单。原下载 SSH 权限仍仅用于 `/srv/chef25/downloads`，不得复用为管理权限。

## 发布后的验收

- HTTPS 首页与 `/downloads/latest.json` 正常，版本与构建 commit 相符。
- 两个平台下载均返回正确长度，抽检 Range 与 SHA-256。
- 在真实目标设备安装并启动，检查模型配置与用户数据可读写。
- 对比已有服务健康与进程状态，确认下载发布未干预它们。

CI 的进程存活与后端测试不能替代各平台原生窗口交互验收，也不代表模型服务可用。

## 签名与应用内更新

`desktop-macos-release` 和 `desktop-windows-release` 环境都限制 main 分支，并配置 `TAURI_SIGNING_PRIVATE_KEY`（密钥内容）与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。公钥提交到 Tauri 配置，私钥必须离线备份；丢失后旧客户端无法信任新签名。

macOS 环境额外配置 `APPLE_CERTIFICATE`（P12 的 base64）、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`（应用专用密码）和 `APPLE_TEAM_ID`。账户标识与诊断不写入公开日志。Developer ID 证书的发布者身份属于安装包签名的公开信息；账户密码和私钥始终保密。

P12 必须包含 Developer ID 中间证书链，避免只在开发者本机已有证书的环境成功。

`release-macos.py` 使用临时钥匙串并在退出时恢复原搜索列表，依次签名 Node、更新运行时哈希、签名应用、公证和装订应用、生成并签名更新归档、创建并签名 DMG、公证和装订 DMG。校验包括 hardened runtime、两个 CPU 架构、Gatekeeper、装订票据，以及重新解压后的应用。任何一步失败均禁止收集产物。手工运行需先构建 Universal app bundle，并在私有环境加载同样的凭据。

更新签名绑定应用版本，客户端开启 `requireSignedVersion`。macOS 更新归档是 `.app.tar.gz`；Windows 复用 EXE。官网仍只提供一个 DMG 和一个 EXE。客户端仅在用户确认后安装，先下载并验证更新，再停止自有酒馆进程并重启；应用数据目录不受覆盖。0.1.0 需手动安装一次 0.2.0。

公证失败时用私有诊断查明原因，禁止跳过签名或修改状态标记发布。证书、更新密钥、P12 与账户配置不得提交仓库。发布前运行隐私检查，并在提交后再对实际提交执行检查。

## macOS 安装引导

DMG 使用 `src-tauri/dmg/background.svg`（可编辑源文件）及 `background.png`（1360×920、144 DPI）显示 680×460 点的暖橙色安装引导。App 与 Applications 位于 (200, 205) 和 (480, 205)。本机 Tauri 配置与发布用 `dmgbuild.py` 保持相同布局。

发布前执行 `python3 -m pip install -r scripts/requirements-dmg.txt`（建议使用虚拟环境）；CI 自动安装。发布脚本通过 dmgbuild 直接写入 `.DS_Store`，不依赖 Finder 自动化权限，然后继续签名、公证及装订 DMG。布局变更仍需新版本发布，不覆盖线上旧包。

更新背景后执行：

```sh
rsvg-convert -w 1360 -h 920 src-tauri/dmg/background.svg -o src-tauri/dmg/background.png
sips -s dpiWidth 144 -s dpiHeight 144 src-tauri/dmg/background.png
```

挂载最终安装包，检查背景、箭头、中文提示、两个真实图标和标签无重叠，并实际拖入 Applications 验收。仅检查图片或 `.DS_Store` 存在不能替代 Finder 视觉验收。
