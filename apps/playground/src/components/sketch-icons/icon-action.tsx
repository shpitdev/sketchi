import type { ComponentProps, ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { SketchIcon, type SketchIconName } from "./sketch-icons";

/**
 * A row of always-visible, hand-drawn action buttons. Wraps its own
 * TooltipProvider so it works on any route (nesting an existing provider is
 * safe), and each action carries an accessible label plus a hover tooltip.
 */
export function IconActionBar({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("studio__icon-bar", className)} {...props}>
        {children}
      </div>
    </TooltipProvider>
  );
}

interface IconActionShared {
  icon: SketchIconName;
  label: string;
  showLabel?: boolean;
  tone?: "default" | "primary";
}

function actionClass(
  tone: IconActionShared["tone"],
  showLabel: boolean,
  className?: string,
) {
  return cn(
    "studio__icon-action",
    tone === "primary" && "studio__icon-action--primary",
    showLabel && "studio__icon-action--labelled",
    className,
  );
}

export type IconLinkProps = IconActionShared &
  Omit<ComponentProps<"a">, "aria-label" | "children">;

export function IconLink({
  icon,
  label,
  showLabel = false,
  tone = "default",
  className,
  ...props
}: IconLinkProps) {
  return (
    <IconTooltip label={label}>
      <a
        aria-label={label}
        className={actionClass(tone, showLabel, className)}
        {...props}
      >
        <SketchIcon name={icon} />
        {showLabel ? (
          <span className="studio__icon-action-label">{label}</span>
        ) : null}
      </a>
    </IconTooltip>
  );
}

export type IconButtonProps = IconActionShared &
  Omit<ComponentProps<"button">, "aria-label" | "children">;

export function IconButton({
  icon,
  label,
  showLabel = false,
  tone = "default",
  className,
  type,
  ...props
}: IconButtonProps) {
  return (
    <IconTooltip label={label}>
      <button
        aria-label={label}
        className={actionClass(tone, showLabel, className)}
        type={type ?? "button"}
        {...props}
      >
        <SketchIcon name={icon} />
        {showLabel ? (
          <span className="studio__icon-action-label">{label}</span>
        ) : null}
      </button>
    </IconTooltip>
  );
}

function IconTooltip({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
