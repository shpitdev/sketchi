import { GitHubMark, HeaderIconLink } from "@sketchi/ui/components/header-icon-link";
import { TooltipProvider } from "@sketchi/ui/components/tooltip";
import { cn } from "@sketchi/ui/lib/utils";
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";

import { SKETCHI_REPO_URL, SKETCHI_WEB_HOME_URL } from "@/features/playground/home-url";

/**
 * The header every Playground route shares: the Sketchi lockup on the left,
 * then the route's own links and actions, then Docs and GitHub as the same
 * icon links the site and Icons headers use. On phones a route with actions
 * moves them to a second row so the lockup and Docs/GitHub share the first.
 */
export function StudioHeader({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	return (
		<header className={cn("studio-header", className)}>
			<a aria-label="Sketchi home" className="studio-brand" href={SKETCHI_WEB_HOME_URL}>
				<span className="studio-brand__tile" aria-hidden="true">
					<img alt="" height="30" src="/icon.svg" width="30" />
				</span>
				<span className="studio-brand__wordmark">Sketchi</span>
			</a>
			{children ? <div className="studio-header__route">{children}</div> : null}
			<TooltipProvider delayDuration={200}>
				<span className="studio-header__site">
					<HeaderIconLink href={`${SKETCHI_WEB_HOME_URL}/docs`} label="Docs">
						<BookOpen aria-hidden="true" />
					</HeaderIconLink>
					<HeaderIconLink
						external
						href={SKETCHI_REPO_URL}
						label="Sketchi on GitHub"
						tooltip="GitHub"
					>
						<GitHubMark />
					</HeaderIconLink>
				</span>
			</TooltipProvider>
		</header>
	);
}
