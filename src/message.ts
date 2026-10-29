import { useSyncExternalStore } from "react";

export type MessageType = "success" | "error" | "warning" | "info";
export type MessageItem = { id: number; type: MessageType; text: string };
let items: MessageItem[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((listener) => listener());
}
function show(type: MessageType, text: string) {
  if (!text.trim()) return;
  // Polling and double clicks must not fill the screen with identical messages.
  if (items.some((item) => item.type === type && item.text === text)) return;
  items = [...items.slice(-2), { id: ++sequence, type, text }];
  emit();
}
export const message = {
  success: (text: string) => show("success", text),
  error: (text: string) => show("error", text),
  warning: (text: string) => show("warning", text),
  info: (text: string) => show("info", text),
  dismiss: (id: number) => {
    items = items.filter((item) => item.id !== id);
    emit();
  },
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useMessages() {
  return useSyncExternalStore(subscribe, () => items);
}
