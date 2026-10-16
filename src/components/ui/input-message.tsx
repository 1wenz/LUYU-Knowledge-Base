"use client";

// Adapted from Fluid Functionalism input-message.tsx (MIT), upstream
// d5c36065b8a351a3f248b496b03b2bdcef58d682. License in public/licenses/.
// Retains the controlled composer, auto-height, IME guard and send/stop actions.
// Attachments, queues, suggestions and remote previews are outside v1.
import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { ArrowUp, Square } from "lucide-react";
import { BorderBeam } from "@/components/border-beam";
import { FluidButton } from "./fluid-button";

type InputMessageProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSend: (value: string) => void;
  onStop?: () => void;
  status?: "idle" | "streaming";
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  sendLabel?: string;
  hint?: string;
  textareaProps?: Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "onChange" | "onKeyDown" | "disabled"
  >;
};

export function InputMessage({
  value,
  onValueChange,
  onSend,
  onStop,
  status = "idle",
  disabled = false,
  invalid = false,
  placeholder = "向知识库提一个问题…",
  sendLabel = "发送问题",
  hint = "Enter 发送 · Shift+Enter 换行",
  textareaProps,
}: InputMessageProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const sending = useRef(false);
  const [focused, setFocused] = useState(false);
  const streaming = status === "streaming";
  const {
    className = "",
    onFocus,
    onBlur,
    onCompositionStart,
    onCompositionEnd,
    ...rest
  } = textareaProps ?? {};

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(52, Math.min(el.scrollHeight, 156))}px`;
  }, [value]);

  function send() {
    const trimmed = value.trim();
    if (!trimmed || disabled || invalid || streaming || composing.current || sending.current)
      return;
    sending.current = true;
    try {
      onSend(trimmed);
    } finally {
      queueMicrotask(() => {
        sending.current = false;
      });
    }
  }

  return (
    <div
      data-slot="input-message"
      data-invalid={invalid}
      className="input-message"
      aria-busy={streaming}
    >
      <BorderBeam active={!disabled && !invalid && (focused || streaming)} />
      <textarea
        ref={textareaRef}
        {...rest}
        value={value}
        aria-label={rest["aria-label"] ?? "问题"}
        aria-invalid={invalid || undefined}
        onChange={(event) => onValueChange(event.target.value)}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onCompositionStart={(event) => {
          composing.current = true;
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          onCompositionEnd?.(event);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={4000}
        rows={2}
        className={`w-full resize-none bg-transparent text-base leading-relaxed outline-none ${className}`}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <span className="text-xs text-muted-foreground">{hint}</span>
        <FluidButton
          iconOnly
          onClick={streaming ? onStop : send}
          disabled={disabled || (!streaming && (!value.trim() || invalid))}
          aria-label={streaming ? "停止生成" : sendLabel}
        >
          {streaming ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
        </FluidButton>
      </div>
    </div>
  );
}
