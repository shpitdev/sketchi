"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import {
  BookOpenText,
  ChevronDown,
  LogOut,
  PenTool,
  Sparkles,
  UserRound,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { getUserDisplayName, getUserInitials } from "@/lib/auth-user";

import { ModeToggle } from "./mode-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface HeaderUser {
  email?: string | null;
  firstName?: string | null;
  id?: string | null;
  lastName?: string | null;
}

export default function Header() {
  const router = useRouter();
  const { user, loading } = useAuth();

  let authControls: ReactNode = null;
  if (user) {
    const identity = user as HeaderUser;
    const displayName = getUserDisplayName(identity);
    const initials = getUserInitials(identity);

    authControls = (
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-border/80 bg-background px-2.5 pr-2 font-medium text-foreground text-sm shadow-xs transition-colors hover:bg-muted/50">
          <span className="font-(family-name:--font-caveat) inline-flex size-6 items-center justify-center rounded-full bg-primary text-base text-primary-foreground leading-none">
            {initials}
          </span>
          <span className="hidden max-w-28 truncate text-muted-foreground text-xs sm:inline-block">
            {displayName}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="w-56 min-w-[14rem] rounded-xl p-1"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-3 py-2">
              <div className="truncate font-medium text-foreground text-xs">
                {displayName}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {identity.email ?? "Signed in"}
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => router.push("/profile" as never)}>
            <UserRound className="size-3.5" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/library-generator")}>
            <Sparkles className="size-3.5" />
            Icon Libraries
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/diagrams")}>
            <PenTool className="size-3.5" />
            Diagram Studio
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              window.open("/api/docs", "_blank", "noopener,noreferrer");
            }}
          >
            <BookOpenText className="size-3.5" />
            API Docs
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => router.push("/sign-out")}
            variant="destructive"
          >
            <LogOut className="size-3.5" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  } else if (loading) {
    authControls = (
      <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
    );
  } else if (!loading) {
    authControls = (
      <Link
        className="inline-flex h-9 items-center rounded-full border-2 border-primary/25 bg-primary px-4 py-1.5 font-medium text-primary-foreground text-sm shadow-xs transition-all hover:bg-primary/90"
        href="/sign-in"
      >
        Sign in
      </Link>
    );
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Link
          aria-label="Home"
          className="group flex items-center gap-2.5 rounded-lg p-1 transition-colors hover:opacity-80"
          href="/"
        >
          <Image
            alt="Sketchi"
            className="h-7 w-7 object-contain transition-transform group-hover:-rotate-6"
            height={28}
            src="/icons/logo.svg"
            width={28}
          />
          <span className="hidden font-[family-name:var(--font-caveat)] font-bold text-2xl text-foreground/90 tracking-tight sm:inline-block">
            sketchi
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          {authControls}
          <Link
            className="hidden rounded-full border-2 border-transparent px-3 py-1.5 font-medium text-muted-foreground text-xs transition-all hover:border-foreground/10 hover:bg-muted/40 hover:text-foreground sm:inline-flex"
            href="/api/docs"
            rel="noreferrer"
            target="_blank"
          >
            API Docs
          </Link>
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
