"use client";

import Image from "next/image";
import { useState } from "react";

interface Screenshot {
  alt: string;
  darkSrc?: string;
  src: string;
}

const screenshots: Screenshot[] = [
  {
    src: "/screenshots/icon-library-js.png",
    alt: "Icon Library code generation",
  },
  {
    src: "/screenshots/palantir-foundry-icon-set.png",
    alt: "Palantir Foundry custom icon set",
  },
  {
    src: "/screenshots/web-based-inline-generator-god-hates-js.png",
    alt: "Excalidraw diagram with icons",
  },
  {
    darkSrc: "/screenshots/opencode-preview-dark.png",
    src: "/screenshots/opencode-preview-light.png",
    alt: "OpenCode plugin preview",
  },
];

export function ScreenshotViewer() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Large Focus Image */}
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[2rem] border-2 bg-background p-1 shadow-sm sm:p-2">
        <div className="relative h-full w-full overflow-hidden rounded-2xl bg-muted/10 sm:rounded-[1.5rem]">
          <Image
            alt={screenshots[activeIndex].alt}
            className={`object-contain transition-transform duration-700 hover:scale-[1.03] ${
              screenshots[activeIndex].darkSrc ? "dark:hidden" : ""
            }`}
            fill
            priority
            sizes="(max-width: 1200px) 100vw, 1200px"
            src={screenshots[activeIndex].src}
          />
          {screenshots[activeIndex].darkSrc && (
            <Image
              alt={screenshots[activeIndex].alt}
              className="hidden object-contain transition-transform duration-700 hover:scale-[1.03] dark:block"
              fill
              priority
              sizes="(max-width: 1200px) 100vw, 1200px"
              src={screenshots[activeIndex].darkSrc}
            />
          )}
        </div>
      </div>

      {/* Thumbnails Row */}
      <div className="grid grid-cols-4 gap-3 sm:gap-4 md:gap-6">
        {screenshots.map((shot, idx) => {
          const isActive = idx === activeIndex;
          return (
            <button
              aria-label={`View ${shot.alt}`}
              className={`relative aspect-[16/9] overflow-hidden rounded-xl border-2 transition-all duration-300 sm:rounded-2xl ${
                isActive
                  ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "border-border opacity-60 hover:border-foreground/30 hover:opacity-80"
              }`}
              key={shot.src}
              onClick={() => setActiveIndex(idx)}
              type="button"
            >
              <div className="absolute inset-0 bg-muted/10">
                <Image
                  alt={shot.alt}
                  className={`object-contain p-1 sm:p-2 ${shot.darkSrc ? "dark:hidden" : ""}`}
                  fill
                  sizes="(max-width: 640px) 25vw, 300px"
                  src={shot.src}
                />
                {shot.darkSrc && (
                  <Image
                    alt={shot.alt}
                    className="hidden object-contain p-1 sm:p-2 dark:block"
                    fill
                    sizes="(max-width: 640px) 25vw, 300px"
                    src={shot.darkSrc}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
