"use client";

import type { SVGProps } from "react";

export function AnimatedSketchiLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <>
      <style>{`
        @keyframes writeText {
          0% {
            stroke-dashoffset: 2000;
            fill: transparent;
          }
          70% {
            stroke-dashoffset: 0;
            fill: transparent;
          }
          100% {
            stroke-dashoffset: 0;
            fill: currentColor;
          }
        }
        .animate-handwriting {
          font-family: var(--font-caveat);
          font-size: 160px;
          font-weight: 700;
          stroke: currentColor;
          stroke-width: 2px;
          stroke-dasharray: 2000;
          stroke-dashoffset: 2000;
          fill: transparent;
          animation: writeText 2.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          transform-origin: center bottom;
        }
      `}</style>
      <svg
        aria-label="Sketchi Logo"
        className="h-auto w-full overflow-visible"
        role="img"
        viewBox="0 0 800 200"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <title>Sketchi Logo</title>
        <text
          className="animate-handwriting text-foreground/90 tracking-tight"
          dominantBaseline="middle"
          textAnchor="middle"
          x="50%"
          y="65%"
        >
          sketchi
        </text>
      </svg>
    </>
  );
}
