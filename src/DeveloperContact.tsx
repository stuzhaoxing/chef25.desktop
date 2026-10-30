import { message } from "./message";
import { ChevronDown, Github, MessageCircle } from "lucide-react";
import supportQr from "./assets/support/wechat-qr.png";
import { invoke, isTauri } from "@tauri-apps/api/core";

export default function DeveloperContact() {
  return (
    <details className="about-contact">
      <summary>
        <MessageCircle size={16} aria-hidden="true" />
        联系开发者
        <ChevronDown className="contact-chevron" size={16} aria-hidden="true" />
      </summary>
      <div className="contact-content">
        <p>使用中遇到问题，或有想分享的建议，欢迎联系我们。</p>
        <img
          className="contact-qr"
          src={supportQr}
          alt="开发者客服微信二维码"
        />
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
      </div>
    </details>
  );
}
