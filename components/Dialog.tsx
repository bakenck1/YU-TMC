import type { MouseEvent, ReactNode } from "react";

type DialogSize = "sm" | "md" | "lg" | "xl" | "2xl";
type DialogLayer = "default" | "critical";

export interface DialogProps {
  children: ReactNode;
  labelledBy: string;
  onDismiss: () => void;
  role?: "dialog" | "alertdialog";
  size?: DialogSize;
  layer?: DialogLayer;
  scrollable?: boolean;
}

const SIZES: Record<DialogSize, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
  "2xl": "max-w-6xl",
};

export default function Dialog({
  children,
  labelledBy,
  onDismiss,
  role = "dialog",
  size = "md",
  layer = "default",
  scrollable = true,
}: DialogProps) {
  function keepDialogOpen(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 backdrop-blur-[2px] ${layer === "critical" ? "z-[60] bg-slate-950/45" : "z-50 bg-slate-950/35"}`}
      onMouseDown={onDismiss}
    >
      <section
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`w-full overflow-hidden rounded-2xl border border-black/5 bg-white shadow-2xl ${SIZES[size]} ${scrollable ? "max-h-[calc(100vh-2rem)] overflow-y-auto" : ""}`}
        onMouseDown={keepDialogOpen}
      >
        {children}
      </section>
    </div>
  );
}
