import type { CSSProperties } from "react";

export interface BrandIconProps {
  /** Path to the brand SVG in /public, e.g. "/brand/github.svg". */
  src: string;
  /** Accessible name for the logo. */
  label: string;
  /** Rendered icon size in pixels. */
  size?: number;
  /** Wrap the logo in a themed, paper-card tile. */
  tile?: boolean;
  /** Image loading strategy. Use "eager" for off-screen marquees. */
  loading?: "eager" | "lazy";
  className?: string;
}

/**
 * Renders one of Sketchi's own brand icons — the same library that drops
 * straight into generated diagrams.
 */
export function BrandIcon({
  src,
  label,
  size = 40,
  tile = false,
  loading = "lazy",
  className,
}: BrandIconProps) {
  const image = (
    <img
      alt={label}
      className="brand-icon__img"
      decoding="async"
      height={size}
      loading={loading}
      src={src}
      width={size}
    />
  );

  if (!tile) {
    return image;
  }

  return (
    <span
      className={`brand-tile${className ? ` ${className}` : ""}`}
      style={{ "--brand-size": `${size}px` } as CSSProperties}
    >
      {image}
    </span>
  );
}
