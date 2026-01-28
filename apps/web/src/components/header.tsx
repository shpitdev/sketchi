"use client";
import Image from "next/image";
import Link from "next/link";

import { ModeToggle } from "./mode-toggle";

export default function Header() {
  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <Link
          aria-label="Home"
          className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-muted/50"
          href="/"
        >
          <Image alt="Sketchi" height={24} src="/icons/logo.svg" width={24} />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            className="rounded-md border border-transparent px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
            href="/api/docs"
            rel="noreferrer"
            target="_blank"
          >
            API Docs
          </Link>
          <ModeToggle />
        </div>
      </div>
      <hr />
    </div>
  );
}
