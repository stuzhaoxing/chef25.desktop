import Dialog from "./components/Dialog";
import { IconButton } from "./components/Button";
import { message } from "./message";
import { MessageCircle, X, Github } from "lucide-react";
import supportQr from "./assets/support/wechat-qr.png";
import { invoke, isTauri } from "@tauri-apps/api/core";

export default function ContactDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="contact-dialog"
      labelledBy="contact-title"
      focusTitle
    >
      <IconButton
        className="contact-close"
        label="关闭联系开发者"
        onClick={onClose}
        icon={X}
        iconSize={19}
      />
      <MessageCircle className="contact-icon" size={28} aria-hidden="true" />
      <h2 id="contact-title" data-dialog-title tabIndex={-1}>
        联系开发者
      </h2>
      <p>使用中遇到问题，或有想分享的建议，欢迎联系我们。</p>
      <img className="contact-qr" src={supportQr} alt="开发者客服微信二维码" />
      <p className="contact-caption">
        微信扫一扫添加好友，请备注「来自 25小厨」。
      </p>
      <a
        className="contact-issues"
        href="https://github.com/stuzhaoxing/chef25.desktop/issues"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (isTauri()) {
            event.preventDefault();
            void invoke("open_developer_issues").catch(() =>
              message.error(
                "无法打开浏览器，请复制 GitHub Issues 链接后访问。",
              ),
            );
          }
        }}
      >
        <Github size={17} /> GitHub Issues · 反馈问题 ↗
      </a>
    </Dialog>
  );
}
