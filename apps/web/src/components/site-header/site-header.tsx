import { Button } from "@sketchi/ui/components/button";
import { Menu, X } from "lucide-react";
import { useState } from "react";

import { CLI_NPM_URL, REPO_URL } from "../../lib/cli-package";
import { DEFAULT_WEB_SURFACE_URLS, type WebSurfaceUrls } from "../../lib/surface-urls";

export interface SiteHeaderNavItem {
	href: string;
	label: string;
}

export interface SiteHeaderProps {
	activePath?: string;
	navItems?: readonly SiteHeaderNavItem[];
	npmUrl?: string;
	repoUrl?: string;
	surfaceUrls?: WebSurfaceUrls;
}

const defaultNavItems: readonly SiteHeaderNavItem[] = [
	{ href: "/#cli", label: "CLI" },
	{ href: "/agents", label: "Agents" },
	{ href: "/docs", label: "Docs" },
];

export function SiteHeader({
	activePath,
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

				<div className="site-header__actions">
					<a className="site-header__link" href={surfaceUrls.icons}>
						Icons
					</a>
					<a
						aria-label="Sketchi on GitHub"
						className="site-header__mark"
						href={repoUrl}
						rel="noreferrer"
						target="_blank"
					>
						<span aria-hidden="true" className="gh-mark" />
					</a>
					<a
						aria-label="sketchi on npm"
						className="site-header__mark"
						href={npmUrl}
						rel="noreferrer"
						target="_blank"
					>
						<span aria-hidden="true" className="npm-mark" />
					</a>
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
