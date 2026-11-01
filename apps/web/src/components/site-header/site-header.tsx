import { Button } from "@sketchi/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@sketchi/ui/components/tooltip";
import { BookOpen, Menu, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { CLI_NPM_URL, REPO_URL } from "../../lib/cli-package";
import { DEFAULT_WEB_SURFACE_URLS, type WebSurfaceUrls } from "../../lib/surface-urls";

export interface SiteHeaderNavItem {
	href: string;
	label: string;
}

export interface SiteHeaderProps {
	activePath?: string;
	docsHref?: string;
	/** Extra text links beside the brand. The default header has none. */
	navItems?: readonly SiteHeaderNavItem[];
	npmUrl?: string;
	repoUrl?: string;
	surfaceUrls?: WebSurfaceUrls;
}

const defaultNavItems: readonly SiteHeaderNavItem[] = [];

export function SiteHeader({
	activePath,
	docsHref = "/docs",
	navItems = defaultNavItems,
	npmUrl = CLI_NPM_URL,
	repoUrl = REPO_URL,
	surfaceUrls = DEFAULT_WEB_SURFACE_URLS,
}: SiteHeaderProps) {
	const [open, setOpen] = useState(false);

	return (
		<header className="site-header">
			<div className="sk-shell site-header__bar">
				<a aria-label="Sketchi home" className="site-header__brand" href="/">
					<img
						alt=""
						className="sk-icon site-header__brand-icon"
						height="30"
						src="/icon.svg"
						width="30"
					/>
					<span className="sk-wordmark">Sketchi</span>
				</a>

				{navItems.length > 0 ? (
					<nav aria-label="Primary" className="site-header__nav">
						{navItems.map((item) => (
							<a
								aria-current={activePath === item.href ? "page" : undefined}
								className="site-header__link"
								href={item.href}
								key={item.href}
							>
								{item.label}
							</a>
						))}
					</nav>
				) : null}

				<div className="site-header__actions">
					<a className="site-header__link" href={surfaceUrls.icons}>
						Icons
					</a>
					<TooltipProvider>
						<HeaderMark
							current={activePath === docsHref}
							href={docsHref}
							label="Docs"
							tooltip="Docs"
						>
							<BookOpen aria-hidden="true" className="site-header__glyph" />
						</HeaderMark>
						<HeaderMark external href={repoUrl} label="Sketchi on GitHub" tooltip="GitHub">
							<span aria-hidden="true" className="gh-mark" />
						</HeaderMark>
						<HeaderMark external href={npmUrl} label="sketchi on npm" tooltip="npm">
							<span aria-hidden="true" className="npm-mark" />
						</HeaderMark>
					</TooltipProvider>
					<Button asChild size="lg" variant="brand">
						<a href={surfaceUrls.playground}>Playground</a>
					</Button>
				</div>

				<Button
					aria-controls="site-menu"
					aria-expanded={open}
					aria-label="Toggle menu"
					className="nav:hidden"
					onClick={() => setOpen((value) => !value)}
					size="icon-lg"
					type="button"
					variant="outline"
				>
					{open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
				</Button>
			</div>

			{open ? (
				<div className="sk-shell site-header__sheet" id="site-menu">
					{navItems.map((item) => (
						<a
							aria-current={activePath === item.href ? "page" : undefined}
							className="site-header__link"
							href={item.href}
							key={item.href}
							onClick={() => setOpen(false)}
						>
							{item.label}
						</a>
					))}
					<div className="site-header__sheet-actions">
						<Button asChild className="w-full" size="xl" variant="outline">
							<a aria-current={activePath === docsHref ? "page" : undefined} href={docsHref}>
								<BookOpen aria-hidden="true" />
								Docs
							</a>
						</Button>
						<Button asChild className="w-full" size="xl" variant="outline">
							<a href={surfaceUrls.icons}>Icons</a>
						</Button>
						<Button asChild className="w-full" size="xl" variant="outline">
							<a href={repoUrl} rel="noreferrer" target="_blank">
								<span aria-hidden="true" className="gh-mark" />
								GitHub
							</a>
						</Button>
						<Button asChild className="w-full" size="xl" variant="outline">
							<a aria-label="sketchi on npm" href={npmUrl} rel="noreferrer" target="_blank">
								<span aria-hidden="true" className="npm-mark" />
							</a>
						</Button>
						<Button asChild className="w-full" size="xl" variant="brand">
							<a href={surfaceUrls.playground}>Playground</a>
						</Button>
					</div>
				</div>
			) : null}
		</header>
	);
}

/** A compact icon link with a hover and focus tooltip naming it. */
function HeaderMark({
	children,
	current = false,
	external = false,
	href,
	label,
	tooltip,
}: {
	children: ReactNode;
	current?: boolean;
	external?: boolean;
	href: string;
	label: string;
	tooltip: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<a
					aria-current={current ? "page" : undefined}
					aria-label={label}
					className="site-header__mark"
					href={href}
					rel={external ? "noreferrer" : undefined}
					target={external ? "_blank" : undefined}
				>
					{children}
				</a>
			</TooltipTrigger>
			<TooltipContent sideOffset={6}>{tooltip}</TooltipContent>
		</Tooltip>
	);
}
