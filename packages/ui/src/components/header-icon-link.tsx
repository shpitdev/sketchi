import * as React from "react"

import { cn } from "../lib/utils.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js"

/**
 * An icon-only header link with an accessible name and a hover/focus tooltip.
 * The site header and the Icons header share it so their Docs and GitHub
 * marks keep the same size, hit target, and current-page state. Render it
 * inside a `TooltipProvider`.
 */
function HeaderIconLink({
  children,
  className,
  current = false,
  external = false,
  label,
  tooltip,
  ...props
}: Omit<React.ComponentProps<"a">, "aria-label"> & {
  current?: boolean
  external?: boolean
  /** Accessible name, e.g. "Sketchi on GitHub". */
  label: string
  /** Short visible tooltip, e.g. "GitHub". Defaults to the label. */
  tooltip?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          aria-current={current ? "page" : undefined}
          aria-label={label}
          className={cn(
            "inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-sm px-2 text-foreground/75 transition-colors hover:bg-card/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground pointer-coarse:h-11 pointer-coarse:min-w-11 [&_svg]:size-5 [&_svg]:shrink-0",
            className
          )}
          data-slot="header-icon-link"
          rel={external ? "noreferrer" : undefined}
          target={external ? "_blank" : undefined}
          {...props}
        >
          {children}
        </a>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  )
}

/** GitHub's mark, drawn from the same asset as /brand/github.svg. */
function GitHubMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-5", className)}
      data-slot="github-mark"
      fill="currentColor"
      viewBox="0 0 512 512"
      {...props}
    >
      <g transform="translate(30.72 31.6) scale(4.506)">
        <path d="M50 1C22.39 1 0 23.386 0 51c0 22.092 14.327 40.834 34.193 47.446 2.499.462 3.417-1.085 3.417-2.406 0-1.192-.047-5.131-.068-9.309-13.91 3.025-16.846-5.9-16.846-5.9-2.274-5.779-5.551-7.315-5.551-7.315-4.537-3.104.341-3.04.341-3.04 5.022.353 7.665 5.153 7.665 5.153 4.46 7.644 11.697 5.434 14.55 4.156.449-3.232 1.745-5.437 3.175-6.686-11.106-1.264-22.78-5.552-22.78-24.71 0-5.459 1.953-9.92 5.151-13.42-.519-1.26-2.23-6.346.485-13.233 0 0 4.198-1.344 13.753 5.125 3.988-1.108 8.266-1.663 12.515-1.682 4.25.019 8.53.574 12.526 1.682 9.544-6.469 13.736-5.125 13.736-5.125 2.722 6.887 1.01 11.973.49 13.232 3.206 3.502 5.146 7.962 5.146 13.42 0 19.205-11.697 23.434-22.83 24.671 1.793 1.552 3.391 4.595 3.391 9.26 0 6.69-.058 12.074-.058 13.721 0 1.33.9 2.89 3.435 2.399C85.692 91.819 100 73.085 100 51c0-27.614-22.386-50-50-50" />
      </g>
    </svg>
  )
}

export { GitHubMark, HeaderIconLink }
