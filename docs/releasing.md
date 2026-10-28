# 发布流程

## 当前发布渠道

目前仅提供 **开发预览** 流程。安装包未配置 Windows Authenticode、Apple Developer ID 签名与公证，不应称为正式发行版。官网必须显示预览和未签名状态。正式发布需要补齐签名、公证、第三方许可审查和真实设备验收后再扩展流水线。

## 构建与同步

1. 在同一个 PR 更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`Cargo.lock`、`tauri.conf.json` 和界面版本，补齐 CHANGELOG。
2. 合并到 main，确认 Quality checks 通过。
3. Actions → **Build and publish desktop preview** → Run workflow。首次检查可不选 publish，仅保存产物；选中 publish 后两个平台通过才自动同步服务器。
4. 两个安装包：macOS Universal（Apple Silicon + Intel）和 Windows x64。macOS runner 交叉编译两个 Rust 架构并合并，内置 Node.js 也合并为 Universal；CI 验证两种 Node 架构均能执行。
   Linux 准备任务先下载固定版本的上游归档并校验，通过 Actions artifact 传给两个构建任务。构建任务通过 `CHEF25_RUNTIME_ARCHIVES` 读取归档并再次校验，避开 macOS runner 到 Node CDN 的慢速链路；缓存缺失或哈希不符直接失败。
5. 流水线执行格式、类型、单测、Clippy、真实酒馆启停与数据保留测试。Windows 另做安装、进程存活与卸载冒烟；macOS 校验最终 DMG 容器。
6. 汇总两个安装包及其 SHA-256，并生成匹配当前 commit 的源码归档。所有产物整体通过受限 SSH 账号上传，接收端校验后原子更新下载清单。

源码与安装包位于同一个 `/downloads/v<version>/`，同版本文件不可覆盖。代码修复必须升级版本号。仅网络故障可重试完全相同的产物；重新构建可能产生不同字节，因此不得覆盖已发布版本。

## GitHub 配置

环境：`downloads-preview`。推荐限制为 main 分支。

| 名称                           | 类型     | 用途                              |
| ------------------------------ | -------- | --------------------------------- |
| `CHEF25_DOWNLOADS_SSH_KEY`     | secret   | 仅可发布下载目录的专用 SSH 私钥   |
| `CHEF25_DOWNLOADS_KNOWN_HOSTS` | secret   | 经已有可信 SSH 连接确认的主机公钥 |
| `CHEF25_DOWNLOADS_HOST`        | variable | 下载服务器主机名或地址            |
| `CHEF25_DOWNLOADS_USER`        | variable | 专用非 root 用户                  |

禁止复用 root 部署密钥。服务器 `authorized_keys` 使用 `restrict,command="python3 /usr/local/libexec/chef25-receive-release.py"` 限制密钥。脚本由 root 持有，账号不能更改；账号没有 sudo，只拥有 `/srv/chef25/downloads`。SSH 密钥不能获得交互 Shell、端口转发、PTY 或管理已有服务的权限。

接收端脚本在 `deploy/receive-release.py`。它拒绝路径穿越、链接、超大包、不完整架构、哈希不符、版本覆盖及自动降级。Caddy 直接提供文件与 Range 下载，不经旧应用。

## 发布后的验收

- HTTPS 首页与 `/downloads/latest.json` 正常，版本与构建 commit 相符。
- 两个平台下载均返回正确长度，抽检 Range 与 SHA-256。
- 在真实目标设备安装并启动，检查模型配置与用户数据可读写。
- 对比已有服务健康与进程状态，确认下载发布未干预它们。

CI 的进程存活与后端测试不能替代各平台原生窗口交互验收，也不代表模型服务可用。
