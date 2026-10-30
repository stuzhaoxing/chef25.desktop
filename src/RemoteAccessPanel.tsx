import SectionHeading from "./components/SectionHeading";
import Button from "./components/Button";
import { message } from "./message";
import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Globe } from "lucide-react";
import AddressShare from "./components/AddressShare";

type RemoteStatus = { enabled: boolean; publicUrl: string; message: string };

export default function RemoteAccessPanel({
  disabled,
  running,
  onBusyChange,
}: {
  disabled: boolean;
  running: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<RemoteStatus>({
    enabled: false,
    publicUrl: "",
    message: "远程访问默认关闭",
  });
  const [configuration, setConfiguration] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let reported = false;
    async function refresh() {
      if (pending.current) return;
      try {
        const next = await invoke<RemoteStatus>("remote_status");
        if (alive && !pending.current) {
          setStatus(next);
          reported = false;
        }
      } catch {
        if (alive && !reported) {
          reported = true;
          message.error("无法读取远程连接状态，请重试。");
        }
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  async function toggle() {
    if (pending.current || !isTauri()) return;
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const next = status.enabled
        ? await invoke<RemoteStatus>("stop_remote")
        : await invoke<RemoteStatus>("start_remote", {
            request: { configuration, publicUrl, password },
          });
      setStatus(next);
      message.success(next.enabled ? "远程访问已开启" : "远程访问已关闭");
      if (next.enabled) {
        setConfiguration("");
        setPassword("");
      }
    } catch (reason) {
      message.error(String(reason));
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <section
      className="settings-card remote-access"
      aria-labelledby="remote-heading"
    >
      <SectionHeading
        id="remote-heading"
        icon={Globe}
        trailing={
          <>
            <span className="settings-badge">OpenFrp · 试用</span>
            <span
              className={`remote-state${status.enabled ? " is-enabled" : ""}`}
            >
              {status.enabled ? "已开启" : "未开启"}
            </span>
          </>
        }
      >
        远程访问
      </SectionHeading>
      <p>
        使用自己的 OpenFrp
        免费账号，从外网访问电脑上的酒馆。电脑和酒馆需保持运行。
      </p>
      <details className="remote-setup">
        <summary>连接配置</summary>
        <details className="remote-help">
          <summary>首次连接怎么配置？</summary>
          <ol>
            <li>
              在{" "}
              <Button
                type="button"
                disabled={!isTauri()}
                onClick={() => {
                  void invoke("open_openfrp_console").catch(() =>
                    message.error(
                      "无法打开浏览器，请手动访问 console.openfrp.net。",
                    ),
                  );
                }}
              >
                OpenFrp 管理面板
              </Button>{" "}
              注册账号，按节点要求完成认证。
            </li>
            <li>
              创建一个 HTTP 隧道，选择支持 HTTPS
              入口的节点并配置域名和证书；本地地址和端口由小厨接管。
            </li>
            <li>
              复制该隧道的基础 INI 配置（包含 common 和一个隧道分区），填写外网
              HTTPS 地址，并设置访问密码。
            </li>
          </ol>
          <p>
            免费节点、额度和认证条件以平台实际显示为准。首版只支持 HTTP 隧道配合
            HTTPS 入口；不支持 TCP、插件或多隧道配置。
          </p>
          <p>
            首次开启会从官方源下载并校验客户端。配置与密码不保存到启动设置或备份；关闭后需重新填写。退出应用或停止酒馆会断开远程访问。
          </p>
        </details>
        {!status.enabled && (
          <fieldset disabled={disabled || busy || !isTauri()}>
            <legend>连接配置</legend>
            <label htmlFor="remote-config">
              OpenFrp INI 配置（含访问凭据，请勿分享）
            </label>
            <textarea
              id="remote-config"
              rows={4}
              value={configuration}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setConfiguration(e.target.value)}
            />
            <div className="remote-fields">
              <div className="remote-field">
                <label htmlFor="remote-url">外网 HTTPS 地址</label>
                <input
                  id="remote-url"
                  type="url"
                  placeholder="https://你的隧道域名"
                  value={publicUrl}
                  autoComplete="off"
                  onChange={(e) => setPublicUrl(e.target.value)}
                />
              </div>
              <div className="remote-field">
                <label htmlFor="remote-password">远程访问密码</label>
                <input
                  id="remote-password"
                  type="password"
                  aria-describedby="remote-password-help"
                  placeholder="建议 16 位以上随机字母数字"
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <p id="remote-password-help">
              密码至少 16 字节。手机首次打开会要求登录，用户名为{" "}
              <code>chef25</code>
              ，密码为上方设置的密码。
            </p>
          </fieldset>
        )}
      </details>
      <div className="remote-actions">
        <Button
          type="button"
          role="switch"
          aria-checked={status.enabled}
          aria-label="开启内网穿透"
          disabled={
            disabled ||
            busy ||
            !isTauri() ||
            (!status.enabled &&
              (!running ||
                !configuration.trim() ||
                !publicUrl.trim() ||
                !password))
          }
          onClick={() => void toggle()}
        >
          {busy
            ? "正在处理…"
            : status.enabled
              ? "关闭内网穿透"
              : "开启内网穿透"}
        </Button>
        {!running && <p>请先启动酒馆，再开启远程访问。</p>}
        <p role="status">
          {busy
            ? "正在准备客户端、连接并验证 HTTPS 和密码保护，首次下载可能需要约 2 分钟…"
            : status.message}
        </p>
      </div>
      {status.enabled && running && (
        <div className="remote-share">
          <AddressShare
            url={status.publicUrl}
            title="扫码远程访问酒馆"
            label="远程访问地址"
          />
        </div>
      )}
      <small>
        使用 OpenFrp 客户端。此项目由社区开发，OpenFrp
        官方不负责除节点问题以外的技术支持。
      </small>
    </section>
  );
}
