import { useEffect, useRef, type ReactNode } from "react";

// Keep children mounted: updates and pending operations must survive closing.
export default function Dialog({
  open,
  onClose,
  busy = false,
  className,
  labelledBy,
  describedBy,
  focusTitle = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  className: string;
  labelledBy: string;
  describedBy?: string;
  focusTitle?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open) {
      if (!node.open) node.showModal();
      if (focusTitle)
        node
          .querySelector<HTMLElement>("[data-dialog-title]")
          ?.focus({ preventScroll: true });
    } else if (node.open) node.close();
  }, [open, focusTitle]);
  return (
    <dialog
      ref={dialog}
      className={className}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        if (open && !dialog.current?.open) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
