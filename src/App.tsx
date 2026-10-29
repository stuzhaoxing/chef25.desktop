import BrandMark from "./components/BrandMark";
import Button from "./components/Button";
import { message } from "./message";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import MobileAccess from "./MobileAccess";
import DataPanel from "./DataPanel";
import GuidePanel from "./GuidePanel";
import ChefMascot from "./ChefMascot";
import TavernView from "./TavernView";
import SettingsPanel from "./SettingsPanel";
import ContactDialog from "./ContactDialog";
import AboutDialog from "./AboutDialog";
import {
  CircleHelp,
  Coffee,
  FolderHeart,
  LoaderCircle,
  Play,
  Settings,
  Power,
  Info,
} from "lucide-react";

type Status = {
  phase: "stopped" | "starting" | "running";
  url: string;
  lanUrls: string[];
  dataDir: string;
  bundled: boolean;
};
const initial: Status = {
  phase: "stopped",
  url: "http://127.0.0.1:25252",
  lanUrls: [],
  dataDir: "",
  bundled: false,
};

export default function App() {
  const [showGuide, setShowGuide] = useState(() => {
    try {
      return localStorage.getItem("chef25.showGuide") !== "false";
    } catch {
      return true;
    }
  });
  function changeShowGuide(value: boolean) {
    try {
      localStorage.setItem("chef25.showGuide", String(value));
    } catch {
      message.error("无法保存显示设置，请重试。");
      return;
    }
    setShowGuide(value);
    if (!value && tab === "help") setTab("settings");
  }
  const [status, setStatus] = useState<Status>(initial);
  const [tab, setTab] = useState("tavern");
  const [entered, setEntered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const inFlight = useRef(false);
  const native = isTauri();
  const tavernVisible =
    entered && status.phase === "running" && tab === "tavern";
  const wasRunning = useRef(false);
  const running = status.phase === "running";
  useEffect(() => {
    if (!native || wasRunning.current === running) return;
    wasRunning.current = running;
    void invoke("resize_workspace", { expanded: running }).catch(() => {
      message.error("无法自动调整窗口大小，请手动拖动窗口边缘调整。");
    });
  }, [native, running]);
  const refresh = useCallback(async () => {
    if (native && !inFlight.current && !savingSettings)
      setStatus(await invoke<Status>("service_status"));
  }, [native, savingSettings]);
  useEffect(() => {
    let alive = true;
    let reported = false;
    const poll = async () => {
      try {
        if (alive) await refresh();
        reported = false;
      } catch {
        if (alive && !reported) {
          reported = true;
          message.error("暂时无法读取酒馆状态，请重新打开小厨。");
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refresh]);

  async function action(command: "start_service" | "stop_service") {
    if (inFlight.current || updating || savingSettings) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (command === "start_service")
        setStatus((s) => ({ ...s, phase: "starting" }));
      const result = await invoke<Status | null>(command);
      if (result) setStatus(result);
      setEntered(command === "start_service");
    } catch (reason) {
      message.error(String(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
      await refresh().catch(() => {});
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <BrandMark />
          <span className="logo-copy">
            25小厨<span className="logo-en">CHEF25</span>
          </span>
        </div>
        <span className="nav-label">我的小厨房</span>
        <nav aria-label="桌面导航">
          {[
            { id: "tavern", label: "我的酒馆", icon: Coffee },
            { id: "data", label: "本地数据", icon: FolderHeart },
            { id: "help", label: "酒馆入门", icon: CircleHelp },
            { id: "settings", label: "设置", icon: Settings },
          ]
            .filter(({ id }) => id !== "help" || showGuide)
            .map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                className={tab === id ? "selected" : ""}
                disabled={savingSettings}
                onClick={() => {
                  setTab(id);
                  if (id === "tavern" && running) setEntered(true);
                }}
                icon={Icon}
                iconSize={18}
              >
                {label}
              </Button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="service-control">
            <div className="sidebar-status" role="status">
              <span className={`dot ${status.phase}`} />
              {status.phase === "running"
                ? "酒馆运行中"
                : status.phase === "starting"
                  ? "酒馆准备中…"
                  : "酒馆尚未启动"}
            </div>
            {running && (
              <Button
                className="service-stop"
                disabled={busy || updating || savingSettings}
                onClick={() => void action("stop_service")}
                icon={busy ? LoaderCircle : Power}
                iconSize={13}
                iconClassName={busy ? "spin" : undefined}
                aria-label={busy ? "正在停止酒馆服务" : "停止酒馆服务"}
                aria-busy={busy}
                title="停止酒馆服务，电脑和手机将暂时无法访问"
              >
                {busy ? "停止中…" : "停止"}
              </Button>
            )}
          </div>
          {running && <MobileAccess urls={status.lanUrls ?? []} />}
          <Button
            className="about-trigger"
            aria-haspopup="dialog"
            onClick={() => setAboutOpen(true)}
            icon={Info}
            iconSize={18}
          >
            关于
          </Button>
        </div>
      </aside>
      <main className={tavernVisible ? "main tavern-active" : "main"}>
        <header className="page-header">
          <div className="page-heading">
            <h1>
              {tab === "tavern"
                ? "我的酒馆"
                : tab === "data"
                  ? "本地数据"
                  : tab === "settings"
                    ? "设置"
                    : "酒馆入门"}
            </h1>
          </div>
          {tab === "tavern" && (
            <div className="tavern-brand" aria-label="基于 SillyTavern">
              <span className="tavern-brand-copy">
                <span className="tavern-brand-caption">基于</span>
                <span className="tavern-brand-name">
                  SillyTavern
                  <svg
                    viewBox="0 0 120 10"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M2 5Q56 -1 118 4M12 9Q62 3 108 8" />
                  </svg>
                </span>
              </span>
            </div>
          )}
        </header>
        {!native && (
          <div className="notice">
            浏览器界面预览 · 启停功能需要在 Tauri 桌面窗口中使用。
          </div>
        )}
        <TavernView
          key={status.url}
          visible={tavernVisible && !aboutOpen && !contactOpen}
          onError={message.error}
        />
        {tab === "tavern" &&
        entered &&
        status.phase === "running" ? null : tab === "tavern" ? (
          <section className="welcome">
            <ChefMascot />
            <div className="welcome-copy">
              <h2>故事，你来写。</h2>
              <p>开场，交给小厨。</p>
            </div>
            <Button
              className="primary"
              disabled={!native || busy || updating || savingSettings}
              onClick={() =>
                status.phase === "running"
                  ? setEntered(true)
                  : void action("start_service")
              }
            >
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              {busy
                ? "小厨正在准备…"
                : status.phase === "running"
                  ? "进入酒馆"
                  : "一键启动酒馆"}
            </Button>
          </section>
        ) : tab === "settings" ? (
          <SettingsPanel
            showGuide={showGuide}
            onShowGuideChange={changeShowGuide}
            disabled={busy || updating || status.phase === "starting"}
            running={running}
            url={status.url}
            onBusyChange={setSavingSettings}
          />
        ) : tab === "data" ? (
          <DataPanel
            dataDir={status.dataDir}
            disabled={busy || updating || status.phase === "starting"}
            running={running}
            onBusyChange={setSavingSettings}
          />
        ) : (
          <GuidePanel />
        )}
      </main>
      <ContactDialog open={contactOpen} onClose={() => setContactOpen(false)} />
      <AboutDialog
        onContact={() => setContactOpen(true)}
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        disabled={busy || savingSettings}
        onBusyChange={setUpdating}
      />
    </div>
  );
}
