import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
export default function EmptyState({
  icon: Icon,
  children,
  action,
  role,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div className="browser-empty" role={role}>
      {Icon && <Icon size={28} strokeWidth={1.4} aria-hidden="true" />}
      <p>{children}</p>
      {action}
    </div>
  );
}
