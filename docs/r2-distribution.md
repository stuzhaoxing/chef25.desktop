# R2 下载分发与自动发布

## 状态与架构

下载入口改为 Pages Functions + 私有 R2。默认下载域名为 `https://download.chef25.com`；主域名 DNS 保持在阿里云。R2 中已有 0.1.0 原始发行文件；官网路由和当前版本清单尚未切换。具体云端验收以最新交接记录为准。

```text
GitHub Actions
  → macOS Universal / Windows x64 构建、签名与检查
  → 汇总 distribution，保留原始发布 artifact
  → 上传 R2 不可变版本目录
  → 从下载域名完整下载并校验 SHA-256、长度、Range
  → 更新 R2 的 updater.json、latest.json（no-store）

官网 / 现有客户端 → www.chef25.com/downloads/{latest,updater}.json
                    → Caddy 只代理小清单 → Pages Functions → 私有 R2
安装包 / 更新包   → download.chef25.com → Pages Functions (Workers Free) → 私有 R2
旧版安装包 URL    → 官网返回 307 → download.chef25.com
```

保留已有客户端内置的更新检查 URL，无需先更新客户端才能接收后续版本。官网仍只展示 macOS 和 Windows 两个安装入口；macOS `.app.tar.gz` 只用于应用内更新。新版本 updater 清单直接写下载域名；迁移旧版清单时不改字节，原官网 URL 经 307 跳转。

## 一次性准备：Pages Functions 与外部 DNS

主域名继续由阿里云等现有 DNS 提供商管理。只为 `download.chef25.com` 添加 CNAME，不改根域名 NS，也不需要 Cloudflare zone Active。

1. 开通 R2 并创建私有 Standard 桶 `chef25-downloads`。当前桶和 0.1.0 文件已存在，直接复用，不要重新构建覆盖。
2. 初始化新账户时使用独立 API Token（目标账户 Workers R2 Storage Write），私有环境注入 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`。`python3 deploy/setup-r2.py` 只显示离线计划，`--apply` 创建私有桶并关闭 r2.dev；不再要求 zone 权限。
3. 保持 Workers Free。使用 `wrangler login --device --use-keyring` 或专用部署 Token；部署 Pages 需要 Cloudflare Pages Edit（OAuth `pages:write`），私有桶绑定另需相应 R2 权限。不要为此启用不相关权限。
4. 创建 Pages 项目并部署：

```sh
npm ci
npx wrangler pages project create chef25-downloads --production-branch main --force
npm run downloads:deploy
```

创建命令的 `--force` 固定使用 Pages API，避免新版 CLI 自动迁移到 Workers 并改写桌面 Vite 项目。已有项目的部署命令不需要 `--force`。`deploy/wrangler.jsonc` 为 Pages 配置。构建脚本将同一下载处理器复制为 `artifacts/download-pages/_worker.js`（Pages Functions advanced mode），所有请求交给 Function，静态输出只有 404 页面，不包含安装包、源码归档或凭据。自定义域名和明确配置的生产 `PAGES_HOST` 可以下载；其他主机名（含部署预览）返回 404，预览环境关闭下载且不绑定 R2。稳定的 pages.dev 生产地址用于 DNS 生效前的验收，也是公开入口，与自定义域名共享函数限额。

5. 先在实际创建成功的 Pages 项目中添加自定义域名 `download.chef25.com`。如果旧独立 Worker 占用此域名，先保存旧配置并解除该域名绑定（保留 Worker 和 R2 对象），再绑定 Pages。
6. 在阿里云 DNS 增加 `CNAME download → <实际项目>.pages.dev`，TTL 使用默认值。项目名被占用时以创建结果为准，并同步配置中的 `name` / `PAGES_HOST` 以及部署命令。先关联 Pages 自定义域名，不能仅添加 CNAME。
7. 等待 Pages 域名和证书 Active，检查公共 DNS、默认 HTTPS 完整下载、哈希和 Range。没有通过前不切换官网 Caddy、不激活新版本。

Pages Functions 的资源耗尽行为设置为 fail closed（关闭 fail open）；静态目录本身没有包可作为回退。下载保持流式 R2 读取，不调用 ASSETS.fetch，也不回退到旧服务器。变更下载域名需同步 `DOWNLOAD_HOST`、`CHEF25_DOWNLOAD_ORIGIN` 和官网 Caddy 配置。

官方说明：[外部 DNS 子域名](https://developers.cloudflare.com/pages/configuration/custom-domains/#add-a-custom-subdomain)、[R2 绑定](https://developers.cloudflare.com/pages/functions/bindings/#r2-buckets)、[Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)。

## 费用边界与停服

- R2 **没有 $1 账户消费硬上限**。预算提醒不会停服；银行卡支付失败也不等于免除账单。
- Workers Free 账户每天 100,000 次请求，UTC 00:00（北京时间 08:00）重置；超额停止函数服务（设置 fail closed）。此配额由整个账户共享，其他 Worker 也会占用。
- 每个下载请求最多两次 R2 Class B 操作，拒绝路径、方法和停服请求不访问 R2；没有公开写入、列表接口或自动重试。按覆盖 32 个 UTC 日的账期上界估算，公众访问最多约 640 万次读取，低于 Standard 每月 1000 万次免费读取。此计算不含其他桶、S3 客户端、管理操作或其他 Worker 的 R2 使用。
- 发布器在持有发布锁时分页统计**整个桶**，包含版本文件和清单增长，超过 **9,000,000,000 字节（9 GB）**或 10,000 个对象就停止。发现未完成 multipart 上传也停止。它使用单次 PUT，不创建 multipart 上传；旧版本不自动删除。
- 9 GB 限制是发布器的防线，不是 R2 服务端配额；手工上传、其他工具和同账户其他桶可绕过。Standard 免费存储为账户共享的 10 GB-month，写入免费额度为每月 100 万次，发布频率和其他使用需保持受控。S3 凭据仅授予此桶、只保存在受保护环境。
- 紧急停服：将 `deploy/wrangler.jsonc` 的 `DOWNLOADS_ENABLED` 改为字符串 `"false"` 并重新部署。所有下载在访问 R2 前返回 503；不要打开 r2.dev 或直接 R2 域名作为回退。
- 不承诺整个账户绝对零费用或 $1 封顶。保留 Free 计划、私有桶和受控上传是此下载方案费用约束的前提；免费配额耗尽当天下载与更新会不可用。

官方依据：[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[R2 价格](https://developers.cloudflare.com/r2/pricing/)。

## GitHub 发布配置

在 Desktop 仓库 Settings → Environments → `downloads-preview` 设置，并将环境限制为 main 分支：

| 名称                     | 类型     | 内容                                        |
| ------------------------ | -------- | ------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`  | Variable | R2 所在账户 ID                              |
| `CHEF25_R2_BUCKET`       | Variable | `chef25-downloads`                          |
| `CHEF25_DOWNLOAD_ORIGIN` | Variable | `https://download.chef25.com`，不带末尾斜杠 |
| `R2_ACCESS_KEY_ID`       | Secret   | R2 S3 API Access Key ID                     |
| `R2_SECRET_ACCESS_KEY`   | Secret   | 对应 Secret Access Key                      |

在 R2 控制台创建仅限此桶的 Object Read & Write 凭据。它们与初始化用的 `CLOUDFLARE_API_TOKEN` 不同。无需配置 AWS endpoint：发布器根据账户 ID 构造官方 R2 S3 endpoint。原 Apple 签名、公证、Tauri updater 签名密钥继续保留在原有平台环境。

启用之前保持发布 workflow 的 `publish` 未勾选。启用之后，Actions → **Build and publish desktop preview** → 勾选 `publish`，一次运行完成双平台构建、R2 上传和清单发布。发布触发仍为人工 dispatch，上传与检查全自动，避免每个源码提交都向用户推送新版本。

发布器使用 `deploy/requirements-r2.txt` 固定 Python SDK 及传递依赖。每次发布必须升级应用版本；不要重新构建并覆盖已存在版本。

## 首次迁移现有安装包

先暂停其他发布任务。通过已有授权的读取途径，将服务器上每个 `downloads/v<version>/` **完整复制**到本地私有目录，保留原始 `distribution.json`、`updater.json`（若有）、`SHA256SUMS`、安装包和源码；不要重新生成清单或重新签名。原始发行版本来就包含这些文件。

在项目外建立 Python 环境，加载与 GitHub 相同的 R2 凭据和非敏感变量：

```sh
python3 -m venv /tmp/chef25-r2-publish
/tmp/chef25-r2-publish/bin/pip install -r deploy/requirements-r2.txt

# 每个历史版本先只上传与验证，不修改当前版本指针。
/tmp/chef25-r2-publish/bin/python deploy/publish-r2.py /path/to/v0.1.0 --dry-run
/tmp/chef25-r2-publish/bin/python deploy/publish-r2.py /path/to/v0.1.0

# 所有仍需提供下载的版本迁完后，激活与官网当前版本一致的完整目录。
/tmp/chef25-r2-publish/bin/python deploy/publish-r2.py /path/to/current-version --activate
```

`--dry-run` 只检查本地文件、清单、SHA-256 与更新包密码学签名，不需要云凭据或网络。默认命令只上传；只有 `--activate` 更新版本指针。R2 为空时不知道旧服务器当前版本，因此迁移操作者必须核对，不要将旧历史版本当作当前版本激活。

随后在官网仓库使用已有管理员部署途径，将 **`deploy/chef25-r2.caddy`** 交给现有 `deploy/install-site.py` 安装。该脚本备份配置、验证后 reload，失败会还原。不要用只能发布下载目录的 SSH 密钥执行管理员操作。

原 `deploy/chef25.caddy` 保持磁盘模式，便于迁移前正常部署及回滚。`npm run deploy` 只发布网站静态文件，不会替你启用 R2 路由。切换无需修改官网组件或重建页面。

## 缓存与首次验收

- R2 对象键保持 `downloads/v<version>/<filename>`。版本文件 `Cache-Control: public, max-age=31536000, immutable`。
- `downloads/latest.json`、`downloads/updater.json` 为 `Cache-Control: no-store`。不要用 Cache Everything / Edge TTL 规则覆盖它们；若已有覆盖规则，先为这两个完整路径设置缓存绕过。
- Pages Function 为不可变文件返回长缓存头；这些响应头本身不保证 Function 响应进入 CDN 边缘缓存。不要为未知路径或 404 设置长缓存；不要对下载域名启用交互式挑战，原生更新器无法完成人机验证。
- 使用 Workers Free 的流式读取，不在内存中拼装安装包；当前未启用 Cache API 边缘缓存。网站读取同源小清单，安装包经导航/原生客户端下载，因此当前流程无需浏览器跨域 CORS 放行。
- 发布脚本完整读取公开文件并验证 SHA-256、长度和 Range；不会把 HTTP 200 的登录页/挑战页当作安装包。
- 切换后核对官网两个下载入口；原 `/downloads/latest.json` 与 `/downloads/updater.json` 返回一致版本、禁缓存；旧版本链接 307 后的下载字节一致。
- 在真实 macOS / Windows 客户端执行检查更新、下载、安装与重启，核对角色和聊天保留。国内多运营商测速单独进行，云上传通过不证明国内加速效果。

免费套餐 CDN 的单文件可缓存上限为 512 MB，超过时 R2 仍可提供对象，但不能假定有边缘缓存加速。R2 Standard 的免费存储/请求有额度，出站流量免费；不要启用会删除当前或仍受支持版本的宽泛生命周期规则。R2 设置不能保证永远零账单。

## 重试、并发和恢复

- 同版本使用条件写入 `If-None-Match: *`，已有文件仅在实际字节一致时接受重试；不会覆盖安装包。
- GitHub concurrency 与桶内发布锁共同阻止并发激活。普通异常会释放锁；任务强制终止可能残留 `downloads/.publish-lock`。**先确认所有 CI/本地发布都已停止**，再在 R2 控制台删除这一个锁对象，然后重试；不要按超时时间自动清锁。
- `distribution.json` 先占住版本，其余对象失败时保留已上传部分。使用 Actions 中保存的原始 `distribution` artifact（14 天）或迁移原目录重试。不要重新运行汇总脚本：时间戳和源码归档等字节可能改变。
- 两个当前清单是分别写入的对象，不是跨对象事务。先更新 updater，后更新 latest；中断时可能短暂显示不同版本，但所有指向的文件已完整验证。用同一 distribution 重试即可收敛；两份指针都检查禁止降级。
- 若 R2 尚未激活或验证失败，不切换官网。已切换后可用原磁盘 Caddy 配置回滚，但须确认磁盘保留的是当前仍需提供的版本。对于已发出的更新，不靠回退版本号撤回；应发布更高版本修复。
- 不自动删除原服务器安装包或 R2 历史版本；真实验收后再单独安排保留策略。

参考：[R2 价格](https://developers.cloudflare.com/r2/pricing/)、[自定义域名](https://developers.cloudflare.com/r2/buckets/public-buckets/)、[条件写入](https://developers.cloudflare.com/r2/api/s3/extensions/)、[缓存限制](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)。

## 历史本地验证（2026-10-28，迁移前）

- Python 发布、迁移、故障恢复与初始化测试：37 项通过；使用模拟 S3 / Cloudflare API，不是云端验收。
- Node 测试：原有 8 项及新增真实 Tauri 测试密钥签名的 distribution 汇总测试通过；验证下载域名、双架构别名、SHA-256 清单和重试文件保护。
- ESLint、TypeScript、Prettier、Rust fmt / Clippy 通过；Rust 4 项通过，需真实运行时的启停集成测试按原有标记跳过，本次未修改启动逻辑。
- R2 SDK 条件写入参数已核对。初始化脚本默认离线计划已运行，没有创建云资源。
- Caddy 校验工具获取受网络影响失败，尚未运行真实 Caddy 配置校验；上线时必须由现有 `install-site.py` 运行 `caddy validate` 后再 reload。
- 未执行真实 R2 上传、DNS 切换、线上迁移、安装包重建或真实客户端更新验收。
