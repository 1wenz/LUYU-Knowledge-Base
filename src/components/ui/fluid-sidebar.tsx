"use client";

// Fluid Functionalism Radix Sidebar / SidebarMenu adaptation (MIT).
// Upstream d5c36065b8a351a3f248b496b03b2bdcef58d682, public/licenses/.
// Keeps the selected row separate from hover/focus and the Radix mobile sheet.
// Peek/resize/icon-collapse are intentionally excluded from this fixed-width shell.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type SidebarItem = { id: string; label: string; icon: LucideIcon; count?: number };

export function FluidSidebarMenu({
  items,
  selectedId,
  onSelect,
  label = "工作区视图",
}: {
  items: SidebarItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  label?: string;
}) {
  return (
    <nav aria-label={label}>
      <ul className="space-y-1">
        {items.map(({ id, label: itemLabel, icon: Icon, count }) => (
          <li key={id}>
            <button
              type="button"
              aria-pressed={id === selectedId}
              onClick={() => onSelect(id)}
              data-active={id === selectedId}
              className="fluid-sidebar-item"
            >
              <span className="fluid-sidebar-selection" aria-hidden="true" />
              <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0 break-words">{itemLabel}</span>
              {count !== undefined && <span className="ml-auto text-xs tabular-nums">{count}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function FluidSidebar({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <aside
      aria-label="工作区导航"
      className="hidden w-56 shrink-0 flex-col border-r bg-card p-5 min-[1180px]:flex"
    >
      <div className="min-h-0 flex-1">{children}</div>
      {footer && <div className="pt-8">{footer}</div>}
    </aside>
  );
}
