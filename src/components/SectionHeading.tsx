import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export default function SectionHeading({
  id,
  icon: Icon,
  children,
  trailing,
}: {
  id: string;
  icon: LucideIcon;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="settings-section-heading">
      <Icon size={17} aria-hidden="true" />
      <h2 id={id}>{children}</h2>
      {trailing}
    </div>
  );
}
