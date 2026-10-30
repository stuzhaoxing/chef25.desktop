import Dialog from "./components/Dialog";
import BrandMark from "./components/BrandMark";
import Button, { IconButton } from "./components/Button";
import { X } from "lucide-react";
import { version } from "../package.json";
import { version as sillyTavernVersion } from "../runtime.lock.json";
import UpdatePanel from "./UpdatePanel";

export default function AboutDialog({
  open,
  onClose,
  onContact,
  disabled,
  onBusyChange,
}: {
  open: boolean;
  onClose: () => void;
  onContact: () => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="about-dialog"
      labelledBy="about-title"
      focusTitle
    >
      <IconButton
        className="about-close"
        label="关闭关于"
        onClick={onClose}
        icon={X}
        iconSize={19}
      />
      <div className="about-brand">
        <BrandMark />
        <div>
          <h2 id="about-title" data-dialog-title tabIndex={-1}>
            25小厨
          </h2>
          <p className="about-version">25小厨版本：{version}（开发预览）</p>
          <p className="about-version">
            内置 SillyTavern 版本：{sillyTavernVersion}
          </p>
        </div>
      </div>
      <UpdatePanel disabled={disabled} onBusyChange={onBusyChange} />
      <Button
        className="about-contact contact-trigger"
        aria-haspopup="dialog"
        onClick={onContact}
      >
        联系开发者
      </Button>
    </Dialog>
  );
}
