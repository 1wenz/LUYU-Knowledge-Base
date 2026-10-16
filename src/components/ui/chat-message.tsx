import type { ReactNode } from "react";

// Fluid Functionalism chat-message.tsx, adapted from upstream
// d5c36065b8a351a3f248b496b03b2bdcef58d682 (MIT, public/licenses).
// Preserve plain assistant text, user bubble, stable wrapping and focusable actions.
export function ChatMessage({
  from,
  children,
  actions,
}: {
  from: "user" | "assistant";
  children: ReactNode;
  actions?: ReactNode;
}) {
  const isUser = from === "user";
  return (
    <article
      aria-label={isUser ? "你的问题" : "助手回复"}
      className={`group flex min-w-0 max-w-full flex-col gap-2 ${isUser ? "items-end self-end" : "items-start self-start"}`}
    >
      <p className="text-xs text-muted-foreground">{isUser ? "你" : "知屿助手"}</p>
      <div
        className={`max-w-full whitespace-pre-wrap break-words text-base leading-relaxed [overflow-wrap:anywhere] ${isUser ? "rounded-xl bg-secondary px-4 py-3" : "text-foreground"}`}
      >
        {children}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
