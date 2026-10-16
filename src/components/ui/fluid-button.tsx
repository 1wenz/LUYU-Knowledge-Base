"use client";

// Adapted from Fluid Functionalism registry/radix/button.tsx (MIT).
// Upstream d5c36065b8a351a3f248b496b03b2bdcef58d682.
// License: public/licenses/fluid-functionalism-MIT.txt.
// Preserve the inset surface + press-ring behavior; use project tokens and sizes.
import { forwardRef, type ButtonHTMLAttributes } from "react";

type FluidButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "tertiary" | "ghost";
  iconOnly?: boolean;
};

const surfaceVariants = {
  primary:
    "[--btn-bg:var(--primary)] group-hover:[--btn-bg:color-mix(in_oklab,var(--primary)_90%,var(--foreground))] group-active:[--btn-bg:color-mix(in_oklab,var(--primary)_80%,var(--foreground))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  secondary:
    "[--btn-bg:var(--secondary)] group-hover:[--btn-bg:var(--muted)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  tertiary:
    "bg-transparent shadow-[0_0_0_1px_var(--input),inset_0_0_0_0px_var(--input)] group-hover:bg-secondary group-active:bg-muted group-active:shadow-[0_0_0_0px_var(--input),inset_0_0_0_1px_var(--input)]",
  ghost: "bg-transparent group-hover:bg-secondary group-active:bg-muted",
};

export const FluidButton = forwardRef<HTMLButtonElement, FluidButtonProps>(function FluidButton(
  { variant = "primary", iconOnly = false, className = "", children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-slot="fluid-button"
      data-variant={variant}
      className={[
        "group relative isolate inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
        iconOnly ? "size-9" : "min-h-10 px-4 py-2",
        variant === "primary" ? "text-primary-foreground" : "text-foreground",
        className,
      ].join(" ")}
      {...props}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-px -z-10 rounded-[calc(var(--radius)-1px)] transition-[background-color,box-shadow] duration-150 ${surfaceVariants[variant]}`}
      />
      {children}
    </button>
  );
});
