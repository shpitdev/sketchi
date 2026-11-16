import { GitHubMark, HeaderIconLink } from "@sketchi/ui/components/header-icon-link";
import { SketchiWordmark } from "@sketchi/ui/components/sketchi-wordmark";
import { TooltipProvider } from "@sketchi/ui/components/tooltip";
import { cn } from "@sketchi/ui/lib/utils";
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The Sketchi web home — "the true home-home". Every brand mark in the Studio
 * app links here so clicking the logo always returns to sketchi.app.
 *
 * This is the public product host, never the Worker hostname that happens to
 * serve it: a platform move must not break links we have already shipped.
 */
const SKETCHI_WEB_HOME_URL = "https://sketchi.app";

const SKETCHI_REPO_URL = "https://github.com/shpitdev/sketchi";

/**
 * The header every Studio route shares: the Sketchi lockup on the left,
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
				<SketchiWordmark />
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
