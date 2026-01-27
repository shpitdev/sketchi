"use client";
import Link from "next/link";

import { ModeToggle } from "./mode-toggle";

export default function Header() {
  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <Link
          aria-label="Home"
          className="flex h-7 w-7 items-center justify-center rounded border border-border transition-colors hover:bg-muted/50"
          href="/"
        >
          <span className="sr-only">Home</span>
        </Link>
        <div className="flex items-center gap-2">
          <ModeToggle />
        </div>
      </div>
      <hr />
    </div>
  );
}
