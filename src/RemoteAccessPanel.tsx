import RemoteQuota, { type RemoteCapacity } from "./RemoteQuota";
import Button from "./components/Button";
import Select from "./components/Select";
import { message } from "./message";
import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Eye, EyeOff, QrCode, Wifi, Globe } from "lucide-react";

type RemoteStatus = {
  enabled: boolean;
  publicUrl: string;
  password: string;
  message: string;
};
export default function RemoteAccessPanel({
  open,
  disabled,
  urls,
  onBusyChange,
}: {
  open: boolean;
  disabled: boolean;
  urls: string[];
  onBusyChange: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<RemoteStatus>({
    enabled: false,
    publicUrl: "",
    password: "",
    message: "每次启动酒馆后，请手动申请远程访问",
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"lan" | "remote">("lan");
  const [selected, setSelected] = useState("");
  const [capacity, setCapacity] = useState<
    "idle" | "busy" | "full" | "unknown"
  >("unknown");
  const [capacityLoading, setCapacityLoading] = useState(true);
  const [quota, setQuota] = useState<RemoteCapacity | null>(null);
  const [quotaRefresh, setQuotaRefresh] = useState(0);
  const lanUrl = urls.includes(selected) ? selected : (urls[0] ?? "");
  const remote = mode === "remote";
  const url = remote ? (status.enabled ? status.publicUrl : "") : lanUrl;
  if (!open && showPassword) setShowPassword(false);
  const pending = useRef(false);
  const operation = useRef(0);
  useEffect(() => {
    if (!isTauri() || !open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = operation.current;
      try {
        if (pending.current) return;
        const next = await invoke<RemoteStatus>("remote_status");
        if (alive && version === operation.current) {
          setStatus(next);
          setStatusError("");
        }
      } catch {
        if (alive && version === operation.current)
          setStatusError("无法读取远程连接状态，请重试。");
      } finally {
        if (alive) timer = setTimeout(() => void refresh(), 3000);
      }
    }
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open]);
  useEffect(() => {
    if (!isTauri() || !open || !remote) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await invoke<RemoteCapacity>("remote_capacity");
        if (alive) {
          setCapacity(next.state);
          setQuota(next);
        }
      } catch {
        if (alive) {
          setCapacity("unknown");
          setQuota(null);
        }
      } finally {
        if (alive) {
          setCapacityLoading(false);
          timer = setTimeout(() => void refresh(), 15000);
        }
      }
    }
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, remote, quotaRefresh]);
  async function toggle(stop: boolean) {
    if (pending.current || !isTauri() || disabled) return;
    pending.current = true;
    operation.current += 1;
    setActionError("");
    setStatusError("");
    setBusy(true);
    onBusyChange(true);
    setShowPassword(false);
    try {
      const next = await invoke<RemoteStatus>(
        stop ? "stop_remote" : "start_remote",
      );
      setStatus(next);
      setStatusError("");
      setMode("remote");
    } catch (reason) {
      setActionError(String(reason));
    } finally {
      setQuotaRefresh((value) => value + 1);
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  function copy(value: string, label: string) {
    void navigator.clipboard
      .writeText(value)
      .then(() => message.success(`${label}已复制`))
      .catch(() => message.error("复制失败，请选中内容手动复制。"));
  }
  const actionStatus =
    actionError ||
    statusError ||
    (busy
      ? "正在申请并验证连接，首次准备可能需要约 2 分钟…"
      : status.enabled
        ? "已连接 · 停止酒馆时释放，下次启动需手动申请"
        : quota?.api.remaining === 0
          ? "共享管理请求已达上限，请稍后重试；聊天和续期不受此预算影响。"
          : capacity === "full"
            ? "名额已满，请等待其他连接释放。"
            : status.message === "远程访问已关闭"
              ? ""
              : status.message);
  return (
    <section className="mobile-access" aria-label="手机连接设置">
      <div className="access-modes" role="group" aria-label="访问方式">
        <Button
          icon={Wifi}
          aria-pressed={!remote}
          onClick={() => {
            setMode("lan");
            setShowPassword(false);
          }}
        >
          同一 Wi-Fi
        </Button>
        <Button
          icon={Globe}
          aria-pressed={remote}
          onClick={() => setMode("remote")}
        >
          远程访问
        </Button>
      </div>
      <div className="mobile-access-layout">
        <div className="mobile-scan">
          <div className="mobile-qr-frame">
            {url ? (
              <QRCodeSVG
                className="mobile-qr"
                value={url}
                size={216}
                marginSize={4}
                level="M"
                title={remote ? "扫码远程访问酒馆" : "手机扫码打开酒馆聊天"}
              />
            ) : (
              <div className="mobile-qr-empty">
                <QrCode size={48} aria-hidden="true" />
                <span>
                  {remote ? "连接成功后显示二维码" : "等待局域网连接"}
                </span>
              </div>
            )}
          </div>
          <p>
            {url
              ? "打开手机相机，扫码访问酒馆"
              : remote
                ? "先申请远程访问，再用手机扫码"
                : "连接 Wi-Fi 后即可扫码"}
          </p>
        </div>
        <div className="mobile-connection-details">
          <h3>{remote ? "随时随地，继续聊天" : "连接同一个 Wi-Fi"}</h3>
          <p className="mobile-mode-description">
            {remote
              ? "手机使用移动网络或其他 Wi-Fi 也能访问。首次打开时，使用下方账号和密码登录。"
              : "让手机与电脑连接同一 Wi-Fi，扫码打开同一个酒馆，无需安装手机端。"}
          </p>
          {!remote && urls.length > 1 && (
            <div className="mobile-field">
              <label id="mobile-lan-label" htmlFor="mobile-lan-address">
                选择电脑的网络地址
              </label>
              <Select
                id="mobile-lan-address"
                labelId="mobile-lan-label"
                value={lanUrl}
                options={urls}
                onChange={setSelected}
              />
            </div>
          )}
          {url ? (
            <>
              <div className="mobile-field">
                <label htmlFor="mobile-share-address">
                  {remote ? "远程访问地址" : "手机访问地址"}
                </label>
                <div className="mobile-field-row">
                  <input
                    id="mobile-share-address"
                    value={url}
                    readOnly
                    onFocus={(event) => event.target.select()}
                  />
                  <Button icon={Copy} onClick={() => copy(url, "地址")}>
                    复制地址
                  </Button>
                </div>
              </div>
              {remote ? (
                <fieldset className="mobile-credentials">
                  <legend>登录信息</legend>
                  <div className="mobile-field">
                    <label htmlFor="remote-username">登录用户名</label>
                    <div className="mobile-field-row">
                      <input
                        id="remote-username"
                        value="chef25"
                        readOnly
                        onFocus={(event) => event.target.select()}
                      />
                      <Button
                        icon={Copy}
                        onClick={() => copy("chef25", "用户名")}
                      >
                        复制用户名
                      </Button>
                    </div>
                  </div>
                  <div className="mobile-field">
                    <label htmlFor="remote-password">
                      访问密码 <span>请勿公开分享</span>
                    </label>
                    <div className="mobile-field-row">
                      <input
                        id="remote-password"
                        type={showPassword ? "text" : "password"}
                        value={status.password}
                        readOnly
                        autoComplete="off"
                      />
                      <Button
                        icon={showPassword ? EyeOff : Eye}
                        aria-label={showPassword ? "隐藏密码" : "显示密码"}
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword(!showPassword)}
                      />
                      <Button
                        icon={Copy}
                        onClick={() => copy(status.password, "密码")}
                      >
                        复制密码
                      </Button>
                    </div>
                  </div>
                </fieldset>
              ) : (
                <p className="mobile-network-note">
                  请在可信网络使用。无法打开时，请检查电脑防火墙
                  {urls.length > 1 ? "，或切换上方地址" : ""}。
                </p>
              )}
            </>
          ) : (
            <p className="mobile-network-note">
              {remote
                ? "远程访问尚未连接，申请成功后会显示专属地址与登录密码。"
                : "未检测到局域网地址。请检查电脑的 Wi-Fi 连接，或切换到远程访问。"}
            </p>
          )}
        </div>
      </div>
      {remote && (
        <div className="mobile-remote">
          <div className="mobile-remote-toolbar">
            <div className="mobile-remote-heading">
              <span>远程连接</span>
              <span
                className={`capacity-badge capacity-${quota?.api.remaining === 0 ? "full" : capacity}`}
                role="status"
              >
                {quota?.api.remaining === 0
                  ? "请求繁忙"
                  : capacity === "idle"
                    ? "空闲"
                    : capacity === "busy"
                      ? "忙碌"
                      : capacity === "full"
                        ? "爆满"
                        : capacityLoading && isTauri()
                          ? "查询中…"
                          : "暂不可用"}
              </span>
            </div>
            <div className="mobile-remote-actions">
              <Button
                className={status.enabled ? "" : "mobile-primary"}
                disabled={
                  disabled ||
                  busy ||
                  !isTauri() ||
                  (!status.enabled &&
                    (capacity === "full" || quota?.api.remaining === 0))
                }
                aria-busy={busy}
                aria-describedby={
                  actionStatus ? "remote-action-status" : undefined
                }
                onClick={() => void toggle(status.enabled)}
              >
                {busy
                  ? "正在处理…"
                  : status.enabled
                    ? "关闭远程访问"
                    : "申请远程访问"}
              </Button>
            </div>
          </div>
          {actionStatus && (
            <p
              id="remote-action-status"
              className={`mobile-remote-status${actionError || statusError ? " mobile-remote-error" : ""}`}
              role={actionError || statusError ? "alert" : "status"}
            >
              {actionStatus}
            </p>
          )}
          {status.enabled && (
            <RemoteQuota value={quota} loading={capacityLoading} />
          )}
        </div>
      )}
    </section>
  );
}
