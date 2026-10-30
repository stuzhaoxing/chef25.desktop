import { useEffect, useRef, useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import Button from "./components/Button";

const origin = import.meta.env.DEV
  ? "http://127.0.0.1:25250"
  : "https://www.chef25.com";
const guideUrl = `${origin}/guides/sillytavern/`;
export default function GuidePanel() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    const timeout = window.setTimeout(() => setStatus("error"), 20000);
    function ready(event: MessageEvent) {
      if (
        event.origin !== origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "chef25:usage-docs-ready"
      )
        return;
      window.clearTimeout(timeout);
      setStatus("ready");
    }
    window.addEventListener("message", ready);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", ready);
    };
  }, [attempt]);
  return (
    <section className="usage-docs-panel" aria-label="酒馆使用文档">
      <div className="usage-docs-toolbar">
        <span role="status">
          {status === "loading"
            ? "正在加载使用文档…"
            : status === "error"
              ? "文档暂未加载完成，请检查网络或重试。"
              : "SillyTavern 中文使用文档"}
        </span>
        <a href={guideUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={13} />
          网页阅读
        </a>
        <Button
          icon={RefreshCw}
          iconSize={13}
          onClick={() => {
            setStatus("loading");
            setAttempt((n) => n + 1);
          }}
        >
          刷新
        </Button>
      </div>
      <iframe
        key={attempt}
        ref={frame}
        src={guideUrl}
        title="SillyTavern 中文使用文档"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onError={() => setStatus("error")}
      />
    </section>
  );
}
