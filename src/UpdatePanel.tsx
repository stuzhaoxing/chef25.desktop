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
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [update, setUpdate] = useState<Available | null>(null);
  const [checking, setChecking] = useState(false);
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
        if (manual && !found) message.success("当前已是最新版本");
      } catch {
        if (manual) message.error("检查更新失败，请稍后重试");
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

  return (
    <section className="updates" aria-label="应用更新">
      <div className="updates-heading">
        <span>{update ? `发现新版本 ${update.version}` : "软件更新"}</span>
        <Button
          disabled={!native || disabled || checking || !!progress}
          onClick={() => void check(true)}
          icon={RefreshCw}
          iconSize={13}
          iconClassName={checking ? "spin" : ""}
        >
          {checking ? "正在检查…" : "检查更新"}
        </Button>
      </div>
      {progress ? (
        <p role="status">
          {progress.phase === "installing"
            ? "正在安装更新，完成后将重启应用…"
            : progress.total
              ? `正在下载 ${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}%`
              : "正在下载更新…"}
        </p>
      ) : (
        update &&
        (confirming ? (
          <div className="update-confirm">
            <p>安装更新将停止酒馆服务并重启应用，现有数据将保留。</p>
            <Button disabled={disabled} onClick={() => void install()}>
              确认更新并重启
            </Button>
            <Button onClick={() => setConfirming(false)}>取消</Button>
          </div>
        ) : (
          <Button
            disabled={disabled || checking}
            onClick={() => setConfirming(true)}
            icon={Download}
            iconSize={14}
          >
            下载并更新
          </Button>
        ))
      )}
    </section>
  );
}
