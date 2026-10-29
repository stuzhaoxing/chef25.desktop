import { QRCodeSVG } from "qrcode.react";
import { Copy } from "lucide-react";
import Button from "./Button";
import { message } from "../message";

export default function AddressShare({
  url,
  title,
  label,
  qrClassName,
  level = "L",
  copyLabel = "复制访问地址",
  showCopyIcon = false,
}: {
  url: string;
  title: string;
  label: string;
  qrClassName?: string;
  level?: "L" | "M";
  copyLabel?: string;
  showCopyIcon?: boolean;
}) {
  return (
    <>
      <QRCodeSVG
        className={qrClassName}
        value={url}
        size={160}
        marginSize={4}
        level={level}
        title={title}
      />
      <input
        aria-label={label}
        value={url}
        readOnly
        onFocus={(event) => event.target.select()}
      />
      <Button
        icon={showCopyIcon ? Copy : undefined}
        iconSize={13}
        onClick={() => {
          void navigator.clipboard
            .writeText(url)
            .then(() => message.success("地址已复制"))
            .catch(() => message.error("复制失败，请选中上方地址手动复制。"));
        }}
      >
        {copyLabel}
      </Button>
    </>
  );
}
