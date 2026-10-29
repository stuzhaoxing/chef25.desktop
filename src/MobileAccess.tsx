import AddressShare from "./components/AddressShare";
import { useState } from "react";

export default function MobileAccess({ urls }: { urls: string[] }) {
  const [selected, setSelected] = useState("");
  const url = urls.includes(selected) ? selected : (urls[0] ?? "");

  return (
    <section className="mobile-access" aria-label="手机访问酒馆">
      <h2>手机扫码聊天</h2>
      {url ? (
        <>
          <p>手机与电脑连接同一 Wi-Fi</p>
          {urls.length > 1 && (
            <select
              aria-label="选择电脑的局域网地址"
              value={url}
              onChange={(event) => {
                setSelected(event.target.value);
              }}
            >
              {urls.map((address) => (
                <option key={address} value={address}>
                  {address}
                </option>
              ))}
            </select>
          )}
          <AddressShare
            url={url}
            title="手机扫码打开酒馆聊天"
            label="手机访问地址"
            qrClassName="mobile-qr"
            level="M"
            copyLabel="复制地址"
            showCopyIcon
          />
          <p>
            同一局域网内可访问此酒馆，请在可信网络使用。无法打开时请检查电脑防火墙
            {urls.length > 1 ? "，或切换上方地址" : ""}。
          </p>
        </>
      ) : (
        <p>未检测到局域网地址，连接 Wi-Fi 后即可扫码。</p>
      )}
    </section>
  );
}
