import ConfirmationDialog from "./components/ConfirmationDialog";
import SectionHeading from "./components/SectionHeading";
import Button from "./components/Button";
import { message } from "./message";
import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { SlidersHorizontal, RotateCcw } from "lucide-react";

import RemoteAccessPanel from "./RemoteAccessPanel";

type LaunchSettings = { port: number };

export default function SettingsPanel({
  disabled,
  running,
  url,
  onBusyChange,
}: {
  disabled: boolean;
  running: boolean;
  url: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const [port, setPort] = useState("25252");
  const [loading, setLoading] = useState(isTauri());
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const resetBlocked =
    disabled || loading || saving || resetting || running || !isTauri();

  async function reset(event: React.FormEvent) {
    event.preventDefault();
    if (resetBlocked || inFlight.current || confirmation !== "确认重置") return;
    inFlight.current = true;
    setResetting(true);
    onBusyChange(true);
    try {
      await invoke("reset_data", { confirmation });
      setConfirmation("");
      setResetOpen(false);
      message.success(
        "重置完成，启动端口保持不变。下次启动酒馆时将重新初始化。",
      );
    } catch (reason) {
      message.error(String(reason));
    } finally {
      inFlight.current = false;
      setResetting(false);
      onBusyChange(false);
    }
  }
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void invoke<LaunchSettings>("launch_settings")
      .then((settings) => {
        if (alive) {
          setPort(String(settings.port));
        }
      })
      .catch((reason) => {
        if (alive) message.error(String(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (
      disabled ||
      running ||
      loading ||
      saving ||
      resetting ||
      inFlight.current ||
      !isTauri()
    )
      return;
    const value = Number(port);
    if (
      !/^\d+$/.test(port) ||
      !Number.isInteger(value) ||
      value < 1024 ||
      value > 65535
    ) {
      message.warning("请输入 1024–65535 之间的整数端口。");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    onBusyChange(true);
    try {
      await invoke("save_launch_settings", {
        settings: { port: value },
      });
      message.success("已保存，下次启动酒馆时生效。");
    } catch (reason) {
      message.error(String(reason));
    } finally {
      inFlight.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }

  return (
    <section className="detail settings-panel">
      <section className="settings-card" aria-labelledby="launch-heading">
        <SectionHeading id="launch-heading" icon={SlidersHorizontal}>
          启动设置
        </SectionHeading>
        <form onSubmit={(event) => void save(event)}>
          <fieldset
            className="settings-row"
            disabled={disabled || loading || saving || resetting}
          >
            <div className="settings-copy">
              <label htmlFor="launch-port">启动端口</label>
            </div>
            <div className="settings-controls">
              <input
                id="launch-port"
                readOnly={running}
                type="number"
                min="1024"
                max="65535"
                step="1"
                required
                value={port}
                onChange={(event) => {
                  setPort(event.target.value);
                }}
              />
              <Button
                className="primary"
                type="submit"
                disabled={running || !isTauri()}
              >
                {saving ? "正在保存…" : "保存"}
              </Button>
            </div>
          </fieldset>
        </form>
        {running && (
          <p className="settings-current-url">
            当前地址：<code>{url}</code>
          </p>
        )}
      </section>
      <RemoteAccessPanel
        disabled={disabled || loading || saving || resetting}
        running={running}
        onBusyChange={onBusyChange}
      />
      <section
        className="settings-card reset-card"
        aria-labelledby="reset-heading"
      >
        <SectionHeading id="reset-heading" icon={RotateCcw}>
          重置数据
        </SectionHeading>
        <div className="reset-card-row">
          <div className="reset-card-copy">
            <p>清空角色、聊天记录和酒馆配置，恢复初始状态。此操作无法撤销。</p>
            {running && <p id="reset-help">请先在侧栏停止酒馆，再执行重置。</p>}
          </div>
          <Button
            type="button"
            className="danger-button"
            aria-describedby={running ? "reset-help" : undefined}
            disabled={resetBlocked}
            onClick={() => {
              setConfirmation("");
              setResetOpen(true);
            }}
          >
            重置数据…
          </Button>
        </div>
      </section>
      <ConfirmationDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onSubmit={(event) => void reset(event)}
        busy={resetting}
        blocked={resetBlocked}
        phrase="确认重置"
        value={confirmation}
        onChange={setConfirmation}
        titleId="reset-title"
        warningId="reset-warning"
        inputId="reset-confirmation"
        className="reset-dialog"
        actionsClassName="reset-actions"
        header={<h2 id="reset-title">确认重置酒馆？</h2>}
        warning={
          <>
            所有角色、聊天记录、酒馆配置（含 API
            密钥）、日志和本地运行副本将永久删除，启动端口保持不变。此操作无法撤销，重置前请先在「本地数据」中导出备份。
          </>
        }
        actionLabel={resetting ? "正在重置…" : "永久删除并重置"}
      />
    </section>
  );
}
