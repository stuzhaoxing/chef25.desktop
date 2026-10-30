import { ChevronRight, Smartphone, X } from "lucide-react";
import Button, { IconButton } from "./components/Button";
import Dialog from "./components/Dialog";
import RemoteAccessPanel from "./RemoteAccessPanel";

export default function MobileAccess({
  open,
  onOpen,
  onClose,
  ...props
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  urls: string[];
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  return (
    <>
      <Button
        className="mobile-access-trigger"
        icon={Smartphone}
        iconSize={18}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="mobile-access-dialog"
        onClick={onOpen}
      >
        <span>手机访问</span>
        <ChevronRight size={15} aria-hidden="true" />
      </Button>
      <Dialog
        id="mobile-access-dialog"
        open={open}
        onClose={onClose}
        className="mobile-access-dialog"
        labelledBy="mobile-access-title"
        describedBy="mobile-access-description"
        focusTitle
      >
        <header className="mobile-access-header">
          <div className="mobile-access-title-icon">
            <Smartphone size={23} aria-hidden="true" />
          </div>
          <div>
            <h2 id="mobile-access-title" data-dialog-title tabIndex={-1}>
              手机访问
            </h2>
            <p id="mobile-access-description">
              用手机继续聊天，电脑和酒馆需保持运行。
            </p>
          </div>
          <IconButton
            className="mobile-access-close"
            icon={X}
            label="关闭手机访问"
            onClick={onClose}
          />
        </header>
        <RemoteAccessPanel {...props} open={open} />
      </Dialog>
    </>
  );
}
