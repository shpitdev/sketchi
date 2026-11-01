import { GitHubMark, HeaderIconLink } from "@sketchi/ui/components/header-icon-link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@sketchi/ui/components/tooltip";
import { BookOpen, Command } from "lucide-react";
import type { ReactNode } from "react";

import { PLAYGROUND_URL, REPO_URL } from "../../lib/home-url.js";

export function IconsChrome({
	children,
	commandShortcut,
	detailOpen,
	homeHref,
	onOpenCommands,
}: {
	children: ReactNode;
	/** Platform label for the palette shortcut, e.g. "⌘K" or "Ctrl K". */
	commandShortcut: string;
	detailOpen: boolean;
	homeHref: string;
	onOpenCommands: () => void;
}) {
	return (
		<>
			<header
				aria-hidden={detailOpen ? "true" : undefined}
				className="icons-header"
				inert={detailOpen ? true : undefined}
			>
				<div className="icons-shell icons-header__inner">
					<a aria-label="Sketchi home" className="icons-brand" href={homeHref}>
						<span className="icons-brand__tile">
							<img alt="" height="30" src="/icon.svg" width="30" />
						</span>
						<span className="sk-wordmark">Sketchi</span>
					</a>
					<div className="icons-header__actions">
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									aria-haspopup="dialog"
									aria-keyshortcuts="Control+K Meta+K"
									aria-label="Commands"
									className="icons-command-trigger"
									onClick={onOpenCommands}
									type="button"
								>
									<kbd className="icons-command-trigger__keys">{commandShortcut}</kbd>
									<Command aria-hidden="true" className="icons-command-trigger__icon" />
								</button>
							</TooltipTrigger>
							<TooltipContent sideOffset={6}>Commands and shortcuts</TooltipContent>
						</Tooltip>
						<HeaderIconLink href={`${homeHref}/docs`} label="Docs">
							<BookOpen aria-hidden="true" />
						</HeaderIconLink>
						<HeaderIconLink external href={REPO_URL} label="Sketchi on GitHub" tooltip="GitHub">
							<GitHubMark />
						</HeaderIconLink>
					</div>
				</div>
			</header>
			{children}
			<footer
				aria-hidden={detailOpen ? "true" : undefined}
				className="icons-footer"
				inert={detailOpen ? true : undefined}
			>
				<div className="icons-shell icons-footer__inner">
					<a className="icons-footer__brand" href={homeHref}>
						<img alt="" height="24" src="/icon.svg" width="24" />
						<span>Sketchi</span>
					</a>
					<nav aria-label="Footer">
						<a href={`${homeHref}/docs`}>Docs</a>
						<a href={PLAYGROUND_URL}>Playground</a>
						<a href="/llms.txt">llms.txt</a>
					</nav>
				</div>
			</footer>
		</>
	);
}
