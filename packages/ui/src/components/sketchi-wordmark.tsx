import * as React from "react"

import { cn } from "../lib/utils.js"
import {
  WORDMARK_HEIGHT,
  WORDMARK_PATH,
  WORDMARK_WIDTH,
} from "./sketchi-wordmark-ink.js"

/**
 * The Sketchi wordmark, written by hand with a marker and inked as one path in
 * `currentColor`, so it follows the text colour of wherever it sits. Its
 * height is `--sketchi-wordmark-height` (30px unless a parent sets it) and the
 * width follows. Every header and footer that shows the brand renders this
 * component, so the path has one source: `packages/ui/wordmark` writes it from
 * the pen strokes.
 *
 * Inside a link that already has a name, such as "Sketchi home", leave `title`
 * off and the mark is hidden from assistive technology. Where the mark is the
 * only text, pass `title="Sketchi"` and it is announced as an image.
 */
function SketchiWordmark({
  className,
  title,
  ...props
}: Omit<React.ComponentProps<"svg">, "children"> & {
  /** Accessible name. Omit it when the surrounding link names the mark. */
  title?: string
}) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={cn(
        "block h-[var(--sketchi-wordmark-height,30px)] w-auto shrink-0",
        className
      )}
      data-slot="sketchi-wordmark"
      fill="currentColor"
      height={30}
      role={title ? "img" : undefined}
      viewBox={`0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`}
      width={Math.round((30 * WORDMARK_WIDTH) / WORDMARK_HEIGHT)}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d={WORDMARK_PATH} />
    </svg>
  )
}

export { SketchiWordmark }
