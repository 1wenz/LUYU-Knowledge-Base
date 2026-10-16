import type { CSSProperties } from "react";

type BrandMarkProps = {
  size?: 16 | 24 | 32 | 48;
  decorative?: boolean;
  className?: string;
};

/** Uses the shared brush source as a mask so both themes inherit currentColor. */
export function BrandMark({ size = 32, decorative = true, className = "" }: BrandMarkProps) {
  const style: CSSProperties = { width: size, height: size };
  return decorative ? (
    <span aria-hidden="true" className={`brand-mark ${className}`} style={style} />
  ) : (
    <span
      role="img"
      aria-label="知屿毛笔标志"
      className={`brand-mark ${className}`}
      style={style}
    />
  );
}
