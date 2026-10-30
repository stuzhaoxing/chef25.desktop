import Button from "./components/Button";
import { message } from "./message";
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
  onAvailableVersionChange,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAvailableVersionChange: (version: string | null) => void;
}) {
  const [update, setUpdate] = useState<Available | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const inFlight = useRef(false);
  const native = isTauri();
  const check = useCallback(
    async (manual: boolean) => {
      if (!native || inFlight.current) return;
      inFlight.current = true;
      setChecking(true);
      try {
        const found = await invoke<Available | null>("check_update");
        setUpdate(found);
        setChecked(true);
        onAvailableVersionChange(found?.version ?? null);
        if (manual && !found) message.success("当前已是最新版本");
      } catch {
        if (manual) message.error("检查更新失败，请稍后重试");
      } finally {
        setChecking(false);
        inFlight.current = false;
      }
    },
    [native, onAvailableVersionChange],
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
    setProgress({ phase: "downloading", downloaded: 0, total: null });
    const onProgress = new Channel<Progress>();
    onProgress.onmessage = setProgress;
    try {
      await invoke("install_update", { onProgress });
    } catch (error) {
      message.error(String(error));
    } finally {
      setProgress(null);
      onBusyChange(false);
      inFlight.current = false;
    }
  }

  const progressLabel = progress
    ? progress.phase === "installing"
      ? "正在安装，完成后将重启应用…"
      : progress.total
        ? `正在下载 ${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}%`
        : "正在下载更新…"
    : null;

  return (
    <section className="updates" aria-label="应用更新">
      <div className="updates-heading">
        <div className="updates-status" role="status">
          <span className="updates-title">
            {update ? `发现新版本 ${update.version}` : "软件更新"}
          </span>
          <p>
            {progressLabel ??
              (checking
                ? "正在检查新版本…"
                : update
                  ? "安装完成后将重启应用"
                  : checked
                    ? "当前已是最新版本"
                    : "检查是否有可用的新版本")}
          </p>
        </div>
        {!confirming && !progress && (
          <Button
            className={update ? "update-primary" : undefined}
            disabled={!native || disabled || checking}
            onClick={() => (update ? setConfirming(true) : void check(true))}
            icon={update ? Download : RefreshCw}
            iconSize={14}
            iconClassName={checking ? "spin" : ""}
          >
            {checking ? "正在检查…" : update ? "下载并更新" : "检查更新"}
          </Button>
        )}
      </div>
      {progress && (
        <progress
          className="update-progress"
          aria-label="更新进度"
          max={
            progress.phase === "installing"
              ? undefined
              : (progress.total ?? undefined)
          }
          value={
            progress.phase === "installing" || !progress.total
              ? undefined
              : progress.downloaded
          }
        />
      )}
      {confirming && !progress && (
        <div className="update-confirm">
          <p>安装更新将停止酒馆服务并重启应用，现有数据将保留。</p>
          <div className="update-actions">
            <Button onClick={() => setConfirming(false)}>取消</Button>
            <Button
              className="update-primary"
              disabled={disabled}
              onClick={() => void install()}
            >
              确认更新并重启
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
