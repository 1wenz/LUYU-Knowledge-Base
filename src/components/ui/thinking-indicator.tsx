import { LoaderCircle } from "lucide-react";

// Fluid ThinkingIndicator adaptation (MIT, see public/licenses).
// No timed word cycling: the caller supplies only an observed operation stage.
export function ThinkingIndicator({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" />
      {label}
    </p>
  );
}
