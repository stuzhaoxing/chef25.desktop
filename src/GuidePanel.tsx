import Button from "./components/Button";
import { message } from "./message";
import { useEffect, useState } from "react";
import { Coffee, RefreshCw } from "lucide-react";

type Guide = {
  title: string;
  intro: string;
  sections: { title: string; body: string }[];
};
function valid(value: unknown): value is Guide {
  if (!value || typeof value !== "object") return false;
  const g = value as Guide;
  const text = (s: unknown, max: number) =>
    typeof s === "string" && s.trim().length > 0 && s.length <= max;
  return (
    text(g.title, 120) &&
    text(g.intro, 1000) &&
    Array.isArray(g.sections) &&
    g.sections.length > 0 &&
    g.sections.length <= 30 &&
    g.sections.every((s) => s && text(s.title, 120) && text(s.body, 10000))
  );
}
export default function GuidePanel() {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [statusText, setMessage] = useState("正在加载入门内容…");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    void (async () => {
      try {
        const response = await fetch(
          import.meta.env.DEV
            ? "/api/tavern-guide"
            : "https://www.chef25.com/api/tavern-guide",
          { signal: controller.signal, cache: "no-store", credentials: "omit" },
        );
        if (!response.ok) throw new Error("unavailable");
        const raw = await response.text();
        if (raw.length > 128 * 1024) throw new Error("oversized");
        const data: unknown = JSON.parse(raw);
        if (!valid(data)) throw new Error("invalid");
        if (!active) return;
        setGuide(data);
        setMessage("");
        if (attempt > 0) message.success("已更新至最新内容");
      } catch {
        if (active) {
          setMessage("内容暂不可用，请刷新重试。");
          message.error("暂时无法获取入门内容，请检查网络后重试。");
        }
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);
  return (
    <section className={`detail guide-panel${guide ? "" : " guide-empty"}`}>
      <Coffee size={36} />
      {guide && (
        <>
          <h2>{guide.title}</h2>
          <p>{guide.intro}</p>
          <details className="guide-toc">
            <summary>章节目录 · 按需阅读</summary>
            <nav aria-label="教程章节">
              {guide.sections.map((section, index) => (
                <a key={index} href={`#guide-section-${index}`}>
                  {section.title}
                </a>
              ))}
            </nav>
          </details>
          <ol className="guide-sections">
            {guide.sections.map((section, index) => (
              <li key={index} id={`guide-section-${index}`}>
                <h3>{section.title}</h3>
                <p className="guide-body">
                  {section.body
                    .split(/(https:\/\/[^\s<>"“”]+)/g)
                    .map((part, i) =>
                      part.startsWith("https://") ? (
                        <a
                          key={i}
                          href={part}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {part}
                        </a>
                      ) : (
                        part
                      ),
                    )}
                </p>
              </li>
            ))}
          </ol>
          <a
            href="https://docs.sillytavern.app/"
            target="_blank"
            rel="noreferrer"
          >
            SillyTavern 官方文档 ↗
          </a>
        </>
      )}
      <div className="guide-status">
        <span role="status">{statusText}</span>
        <Button
          disabled={loading}
          onClick={() => {
            setGuide(null);
            setLoading(true);
            setMessage("正在加载入门内容…");
            setAttempt((n) => n + 1);
          }}
          icon={RefreshCw}
          iconSize={14}
        >
          刷新内容
        </Button>
      </div>
    </section>
  );
}
