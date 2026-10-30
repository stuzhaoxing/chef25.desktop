import Dialog from "./components/Dialog";
import BrandMark from "./components/BrandMark";
import { IconButton } from "./components/Button";
import { X } from "lucide-react";
import { version } from "../package.json";
import { version as sillyTavernVersion } from "../runtime.lock.json";
import UpdatePanel from "./UpdatePanel";
import DeveloperContact from "./DeveloperContact";

export default function AboutDialog({
  open,
  onClose,
  disabled,
  onBusyChange,
  onAvailableVersionChange,
}: {
  open: boolean;
  onClose: () => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAvailableVersionChange: (version: string | null) => void;
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
        </div>
      </div>
      <div className="about-versions">
        <p className="about-version">
          <span>25小厨版本</span>
          <span>{version}</span>
        </p>
        <p className="about-version">
          <span>内置 SillyTavern</span>
          <span>{sillyTavernVersion}</span>
        </p>
      </div>
      <UpdatePanel
        disabled={disabled}
        onBusyChange={onBusyChange}
        onAvailableVersionChange={onAvailableVersionChange}
      />
      <DeveloperContact />
    </Dialog>
  );
}
