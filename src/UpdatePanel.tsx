import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { Download, RefreshCw } from "lucide-react";

type Available = { version: string; notes: string | null };
type Progress = {
  phase: "downloading" | "installing";
  downloaded: number;
  total: number | null;
};

export default function UpdatePanel({
  disabled,
  onBusyChange,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [update, setUpdate] = useState<Available | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const native = isTauri();
  const check = useCallback(
    async (manual: boolean) => {
      if (!native || inFlight.current) return;
      inFlight.current = true;
      setChecking(true);
      if (manual) setMessage("");
      try {
        const found = await invoke<Available | null>("check_update");
        setUpdate(found);
        if (manual && !found) setMessage("已经是最新版本");
      } catch {
        if (manual) setMessage("暂时无法检查更新，请稍后重试");
      } finally {
        setChecking(false);
        inFlight.current = false;
      }
    },
    [native],
  );
  useEffect(() => {
    const timer = setTimeout(() => void check(false), 3000);
    return () => clearTimeout(timer);
  }, [check]);

  async function install() {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    onBusyChange(true);
    setConfirming(false);
    setMessage("");
    setProgress({ phase: "downloading", downloaded: 0, total: null });
    const onProgress = new Channel<Progress>();
    onProgress.onmessage = setProgress;
    try {
      await invoke("install_update", { onProgress });
    } catch (error) {
      setMessage(String(error));
    } finally {
      setProgress(null);
      onBusyChange(false);
      inFlight.current = false;
    }
  }

  return (
    <section className="updates" aria-label="应用更新">
      <div className="updates-heading">
        <span>
          {update ? `新版本 v${update.version} 已就绪` : "保持小厨常新"}
        </span>
        <button
          disabled={!native || disabled || checking || !!progress}
          onClick={() => void check(true)}
        >
          <RefreshCw size={13} className={checking ? "spin" : ""} />
          {checking ? "正在检查…" : "检查更新"}
        </button>
      </div>
      {update?.notes && <p className="update-notes">{update.notes}</p>}
      {progress ? (
        <p role="status">
          {progress.phase === "installing"
            ? "正在安装，即将重新打开小厨…"
            : progress.total
              ? `正在下载 ${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}%`
              : "正在下载更新…"}
        </p>
      ) : (
        update &&
        (confirming ? (
          <div className="update-confirm">
            <p>
              更新将停止酒馆并重启小厨。请先完成当前对话；角色、聊天和配置会保留。
            </p>
            <button disabled={disabled} onClick={() => void install()}>
              确认更新并重启
            </button>
            <button onClick={() => setConfirming(false)}>稍后再说</button>
          </div>
        ) : (
          <button
            disabled={disabled || checking}
            onClick={() => setConfirming(true)}
          >
            <Download size={14} />
            下载并更新
          </button>
        ))
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
