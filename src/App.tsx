import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  BookOpen,
  ChefHat,
  CircleHelp,
  Coffee,
  ExternalLink,
  FolderHeart,
  Heart,
  LoaderCircle,
  Play,
  ShieldCheck,
  Square,
  Terminal,
} from "lucide-react";

type Status = {
  phase: "stopped" | "starting" | "running";
  url: string;
  dataDir: string;
  bundled: boolean;
};
const initial: Status = {
  phase: "stopped",
  url: "http://127.0.0.1:25252",
  dataDir: "",
  bundled: false,
};

export default function App() {
  const [status, setStatus] = useState<Status>(initial);
  const [tab, setTab] = useState("tavern");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const native = isTauri();
  const refresh = useCallback(async () => {
    if (native && !inFlight.current)
      setStatus(await invoke<Status>("service_status"));
  }, [native]);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        if (alive) await refresh();
      } catch {
        if (alive) setError("暂时无法读取酒馆状态，请重新打开小厨。");
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refresh]);

  async function action(
    command: "start_service" | "stop_service" | "open_tavern",
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (command === "start_service")
        setStatus((s) => ({ ...s, phase: "starting" }));
      const result = await invoke<Status | null>(command);
      if (result) setStatus(result);
      if (command === "start_service") await invoke("open_tavern");
    } catch (reason) {
      setError(String(reason));
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
          <ChefHat size={29} />
          <span>
            25小厨<small>CHEF25 DESKTOP</small>
          </span>
        </div>
        <span className="nav-label">我的小厨房</span>
        <nav aria-label="桌面导航">
          {[
            { id: "tavern", label: "我的酒馆", icon: Coffee },
            { id: "data", label: "本地数据", icon: FolderHeart },
            { id: "help", label: "使用指南", icon: CircleHelp },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Heart size={17} />
          <p>
            为热爱故事的人，
            <br />
            做一点小事。
          </p>
          <span>v0.1.0 · 开发预览</span>
        </div>
      </aside>
      <main className="main">
        <header>
          <h1>
            {tab === "tavern"
              ? "我的酒馆"
              : tab === "data"
                ? "本地数据"
                : "使用指南"}
          </h1>
          <span className="local-badge">
            <span /> LOCAL FIRST
          </span>
        </header>
        {!native && (
          <div className="notice">
            浏览器界面预览 · 启停功能需要在 Tauri 桌面窗口中使用。
          </div>
        )}
        {tab === "tavern" ? (
          <>
            <section className="welcome">
              <div className="chef-scene">
                <span className="star s1">✦</span>
                <ChefHat size={99} strokeWidth={1.2} />
                <span className="star s2">✧</span>
                <div className="smile">• ᴗ •</div>
              </div>
              <span className="eyebrow">YOUR STORY STARTS HERE</span>
              <h2>今天，想遇见谁？</h2>
              <p>
                小厨备好开场，你负责尽兴。
                <br />
                打开熟悉的酒馆，继续没讲完的故事。
              </p>
              <button
                className="primary"
                disabled={!native || busy}
                onClick={() =>
                  void action(
                    status.phase === "running"
                      ? "open_tavern"
                      : "start_service",
                  )
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
              </button>
              <span className="service-label">
                <span className={`dot ${status.phase}`} />
                {status.phase === "running"
                  ? "酒馆已就绪，随时可以入座"
                  : status.phase === "starting"
                    ? "首次启动需要准备本地文件，请稍候"
                    : "酒馆尚未启动"}
              </span>
              {status.phase === "running" && (
                <button
                  className="stop"
                  disabled={busy}
                  onClick={() => void action("stop_service")}
                >
                  <Square size={11} /> 停止服务
                </button>
              )}
            </section>
            <div className="info-grid">
              <article>
                <ShieldCheck size={21} />
                <div>
                  <h3>故事留在本机</h3>
                  <p>角色与聊天记录保存在你的电脑里。</p>
                </div>
              </article>
              <article>
                <BookOpen size={21} />
                <div>
                  <h3>第一次来？</h3>
                  <button onClick={() => setTab("help")}>
                    看看开场指南 <ExternalLink size={12} />
                  </button>
                </div>
              </article>
            </div>
          </>
        ) : tab === "data" ? (
          <section className="detail">
            <FolderHeart size={36} />
            <h2>你的故事，有自己的位置。</h2>
            <p>
              角色、聊天和配置与应用安装目录分开保存，升级应用不会覆盖它们。卸载前请自行备份这个目录。
            </p>
            <label>本地数据目录</label>
            <code>{status.dataDir || "请在桌面应用中查看"}</code>
            <p>
              日志位于此目录的 <code>logs/sillytavern.log</code>
              ，可能包含个人内容；提交 Issue 前请检查并脱敏。
            </p>
            <p>
              本地酒馆地址：<code>{status.url}</code>
            </p>
          </section>
        ) : (
          <section className="detail">
            <Coffee size={36} />
            <h2>三步，准备好你的酒馆。</h2>
            <ol>
              <li>
                <strong>启动本地服务</strong>
                <p>
                  回到「我的酒馆」点击一键启动。准备完成后会自动打开酒馆窗口。
                </p>
              </li>
              <li>
                <strong>配置模型连接</strong>
                <p>
                  在 SillyTavern 的 API
                  连接中选择自己的模型服务，并填写服务地址与 API
                  Key。小厨当前不提供模型额度。
                </p>
              </li>
              <li>
                <strong>选择角色，开始故事</strong>
                <p>
                  使用你已有的角色卡，或在 SillyTavern
                  中创建角色。退出小厨时，本次启动的服务会一并停止。
                </p>
              </li>
            </ol>
            <a
              href="https://docs.sillytavern.app/"
              target="_blank"
              rel="noreferrer"
            >
              SillyTavern 官方文档 ↗
            </a>
            <p className="subtle">
              如果端口 25252
              已被其他程序占用，小厨会提示冲突。请先处理冲突，不会自动接管其他服务。
            </p>
          </section>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <footer>
          <span>
            <Terminal size={12} /> SillyTavern 1.19.0
          </span>
          <span>少一点折腾，多一点故事。</span>
        </footer>
      </main>
    </div>
  );
}
