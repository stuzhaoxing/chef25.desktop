import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

// Serialize layout/hide operations, including React StrictMode cleanup, so an
// older resize cannot reveal a webview after the user has switched tabs.
let pending: Promise<unknown> = Promise.resolve();
function sync(
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    viewport_height: number;
  } | null,
) {
  const next = pending
    .catch(() => {})
    .then(() => invoke("sync_tavern", { bounds }));
  pending = next;
  return next;
}

export default function TavernView({
  visible,
  onError,
}: {
  visible: boolean;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const report = (reason: unknown) => {
      if (!disposed) onError(String(reason));
    };
    const element = host.current;
    if (!visible || !element) {
      void sync(null).catch(report);
      return;
    }
    let frame = 0;
    const layout = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { x, y, width, height } = element.getBoundingClientRect();
        void sync(
          width > 0 && height > 0
            ? { x, y, width, height, viewport_height: window.innerHeight }
            : null,
        ).catch(report);
      });
    };
    const observer = new ResizeObserver(layout);
    observer.observe(element);
    window.addEventListener("resize", layout);
    window.addEventListener("scroll", layout, true);
    layout();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", layout);
      window.removeEventListener("scroll", layout, true);
      void sync(null).catch(() => {});
    };
  }, [visible, onError]);

  return (
    <div
      ref={host}
      className="tavern-host"
      hidden={!visible}
      aria-label="酒馆内容"
    />
  );
}
