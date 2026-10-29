import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  iconSize?: number;
  iconClassName?: string;
};

export default function Button({
  type = "button",
  icon: Icon,
  iconSize = 16,
  iconClassName,
  children,
  ...props
}: Props) {
  return (
    <button type={type} {...props}>
      {Icon && (
        <Icon size={iconSize} className={iconClassName} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  ...props
}: Omit<Props, "children" | "aria-label"> & {
  label: string;
  icon: LucideIcon;
}) {
  return <Button {...props} aria-label={label} />;
}
