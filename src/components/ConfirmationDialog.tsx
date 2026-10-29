import type { ReactNode, FormEvent } from "react";
import Dialog from "./Dialog";
import Button from "./Button";

export default function ConfirmationDialog({
  open,
  onClose,
  onSubmit,
  busy,
  blocked,
  phrase,
  value,
  onChange,
  titleId,
  warningId,
  inputId,
  className,
  actionsClassName,
  header,
  warning,
  warningClassName,
  actionLabel,
  actionClassName = "danger-button",
  placeholder,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
  blocked: boolean;
  phrase: string;
  value: string;
  onChange: (value: string) => void;
  titleId: string;
  warningId: string;
  inputId: string;
  className: string;
  actionsClassName: string;
  header: ReactNode;
  warning: ReactNode;
  warningClassName?: string;
  actionLabel: string;
  actionClassName?: string;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      className={className}
      labelledBy={titleId}
      describedBy={warningId}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !blocked && value === phrase) onSubmit(event);
        }}
      >
        {header}
        <p id={warningId} className={warningClassName}>
          {warning}
        </p>
        <label htmlFor={inputId}>请输入“{phrase}”以继续</label>
        <input
          id={inputId}
          type="text"
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
        />
        {children}
        <div className={actionsClassName}>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            className={actionClassName}
            disabled={busy || blocked || value !== phrase}
          >
            {actionLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
