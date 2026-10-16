"use client";

// Fluid Functionalism Radix Dialog adaptation (MIT, public/licenses).
// Uses the installed Radix facade; no parallel primitive or animation runtime.
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";

export function FluidDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  trigger,
  drawer = false,
  className = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  trigger?: ReactNode;
  drawer?: boolean;
  className?: string;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className={`${drawer ? "fluid-drawer" : "fluid-dialog"} ${className}`}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <div className="mb-6 pr-10">
            <Dialog.Title className="text-xl">{title}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              {description}
            </Dialog.Description>
          </div>
          {children}
          <Dialog.Close
            className="absolute top-4 right-4 inline-flex size-9 items-center justify-center rounded-md hover:bg-secondary"
            aria-label="关闭弹窗"
          >
            <X aria-hidden="true" className="size-5" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
