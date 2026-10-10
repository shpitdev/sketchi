import type { ReactNode } from "react";

export function IconsChrome({
	children,
	homeHref,
	detailOpen,
}: {
	children: ReactNode;
	homeHref: string;
	detailOpen: boolean;
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
						<span className="icons-brand__surface">Icons</span>
					</a>
					<nav aria-label="Sketchi links" className="icons-header__nav">
						<a href={`${homeHref}/docs`}>Docs</a>
						<a href="/llms.txt">llms.txt</a>
						<a href="https://github.com/shpitdev/sketchi">GitHub</a>
					</nav>
				</div>
			</header>
			{children}
			<footer
				aria-hidden={detailOpen ? "true" : undefined}
				className="icons-footer"
				inert={detailOpen ? true : undefined}
			>
				<div className="icons-shell icons-footer__inner">
					<div>
						<a className="icons-footer__brand" href={homeHref}>
							<img alt="" height="30" src="/icon.svg" width="30" />
							<span>Sketchi</span>
						</a>
						<p>Prompts become clear, editable diagrams, logos included.</p>
					</div>
					<nav aria-label="Footer">
						<a href={homeHref}>Home</a>
						<a href={`${homeHref}/docs`}>Docs</a>
						<a href="/llms.txt">llms.txt</a>
						<a href="https://playground.sketchi.app">Playground</a>
					</nav>
				</div>
			</footer>
		</>
	);
}
