import Button from "./components/Button";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { message, useMessages, type MessageItem } from "./message";

const icons = {
  success: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
};
function Message({ item }: { item: MessageItem }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const Icon = icons[item.type];
  useEffect(() => {
    if (paused || leaving) return;
    const timer = window.setTimeout(
      () => setLeaving(true),
      item.type === "error" ? 6500 : 4000,
    );
    return () => window.clearTimeout(timer);
  }, [item.type, paused, leaving]);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => message.dismiss(item.id), 200);
    return () => window.clearTimeout(timer);
  }, [item.id, leaving]);
  return (
    <div
      className={`message message-${item.type}${leaving ? " is-leaving" : ""}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={19} aria-hidden="true" />
      <span role={item.type === "error" ? "alert" : "status"}>{item.text}</span>
      <Button
        type="button"
        aria-label="关闭提示"
        onClick={() => setLeaving(true)}
        icon={X}
        iconSize={15}
      ></Button>
    </div>
  );
}

export default function MessageViewport() {
  const items = useMessages();
  const host = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Element>(document.body);
  useEffect(() => {
    // Keep notices interactive and accessible inside the active modal's inert boundary.
    let stack: Element[] = [];
    const update = () => {
      const dialogs = [...document.querySelectorAll("dialog[open]")].filter(
        (dialog) => dialog.matches(":modal"),
      );
      stack = [
        ...stack.filter((dialog) => dialogs.includes(dialog)),
        ...dialogs.filter((dialog) => !stack.includes(dialog)),
      ];
      setTarget(stack.at(-1) ?? document.body);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    update();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (items.length) host.current?.showPopover?.();
    else host.current?.hidePopover?.();
  }, [items.length, target]);
  return createPortal(
    <div
      ref={host}
      className="message-viewport"
      popover="manual"
      hidden={!items.length}
      aria-label="操作提示"
    >
      {items.map((item) => (
        <Message key={item.id} item={item} />
      ))}
    </div>,
    target,
  );
}
