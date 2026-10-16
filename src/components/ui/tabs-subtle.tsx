"use client";

// Fluid Functionalism Radix TabsSubtle adaptation (MIT, public/licenses).
// Keeps controlled tabs, roving keyboard focus, independent hover/selection surfaces.
import { Tabs } from "radix-ui";
import type { ReactNode } from "react";

export function TabsSubtle({
  value,
  onValueChange,
  label,
  tabs,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  tabs: Array<{ value: string; label: string; content: ReactNode }>;
}) {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange} className="min-w-0">
      <Tabs.List
        aria-label={label}
        className="mb-4 flex w-fit max-w-full gap-1 rounded-lg bg-muted p-1"
      >
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            value={tab.value}
            className="min-h-10 rounded-md px-4 text-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            {tab.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((tab) => (
        <Tabs.Content key={tab.value} value={tab.value} className="min-w-0">
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
