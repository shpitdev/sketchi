import { TooltipProvider } from "@sketchi/ui/components/tooltip";
import { Download, Search, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { copyText, downloadBlob } from "../../lib/actions.js";
import { bareSlug, type CommunityIconEntry } from "../../lib/community-client.js";
import { SKETCHI_WEB_HOME_URL } from "../../lib/home-url.js";
import { useDrawnNames } from "../../lib/use-drawn-names.js";
import { useLoadOnScroll } from "../../lib/use-load-on-scroll.js";
import { IconsChrome } from "../icon-library/icons-chrome.js";
import { NamesToggle } from "../names-toggle/index.js";
import { PreviewToggle, type PreviewMode } from "../preview-toggle/index.js";
import { CommunityCard } from "./community-card.js";
import { CommunityDetail, type CommunityDetailAction } from "./community-detail.js";

type LoadStatus = "error" | "loading" | "ready";

export interface CommunityGalleryProps {
	readonly icons: readonly CommunityIconEntry[];
	readonly status: LoadStatus;
	readonly errorMessage?: string;
	readonly onRetry?: () => void;
	readonly query: string;
	readonly onQueryChange: (query: string) => void;
	readonly hasMore?: boolean;
	readonly loadingMore?: boolean;
	readonly onLoadMore?: () => void;
	/** The icon `/community/<slug>` opens, wherever it sits in the list. */
	readonly initialIcon?: CommunityIconEntry;
	/** A linked icon that is not published, or could not be loaded. */
	readonly linked?: { readonly slug: string; readonly status: "error" | "missing" };
	readonly onRetryLinked?: () => void;
	readonly homeHref?: string;
	readonly initialPreviewMode?: PreviewMode;
}

function plural(count: number, one: string, many: string): string {
	return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

const loadExcalidrawExport = () => import("../../lib/excalidraw-export.js");
// A failed prefetch is retried by the action that needs the code, which reports it.
const preloadExcalidrawExport = () => {
	loadExcalidrawExport().catch(() => undefined);
};

export function CommunityGallery({
	errorMessage,
	hasMore = false,
	homeHref = SKETCHI_WEB_HOME_URL,
	icons,
	initialPreviewMode = "light",
	initialIcon,
	linked,
	loadingMore = false,
	onLoadMore,
	onQueryChange,
	onRetry,
	onRetryLinked,
	query,
	status,
}: CommunityGalleryProps) {
	const [previewMode, setPreviewMode] = useState<PreviewMode>(initialPreviewMode);
	const [named, setNamed] = useDrawnNames();
	const namedSuffix = named ? "-with-names" : "";
	const [detail, setDetail] = useState<
		| {
				readonly opener: HTMLElement | null;
				readonly slug: string;
		  }
		| undefined
	>(initialIcon ? { opener: null, slug: initialIcon.slug } : undefined);
	const [copiedSlug, setCopiedSlug] = useState<string>();
	const [notice, setNotice] = useState("");
	const noticeTimer = useRef<number | undefined>(undefined);
	const copiedTimer = useRef<number | undefined>(undefined);
	const searchRef = useRef<HTMLInputElement>(null);
	const detailIcon = detail
		? (icons.find((icon) => icon.slug === detail.slug) ??
			(initialIcon?.slug === detail.slug ? initialIcon : undefined))
		: undefined;
	const closeDetail = useCallback(() => setDetail(undefined), []);
	const loadMore = useCallback(() => onLoadMore?.(), [onLoadMore]);
	const sentinel = useLoadOnScroll<HTMLDivElement>(
		status === "ready" && hasMore && !loadingMore && onLoadMore ? icons.length : undefined,
		loadMore,
	);

	const showNotice = useCallback((message: string) => {
		setNotice(message);
		window.clearTimeout(noticeTimer.current);
		noticeTimer.current = window.setTimeout(() => setNotice(""), 3200);
	}, []);

	const copy = useCallback(
		async (value: string | Promise<string>, done: string, icon: CommunityIconEntry) => {
			try {
				await copyText(value);
				setCopiedSlug(icon.slug);
				window.clearTimeout(copiedTimer.current);
				copiedTimer.current = window.setTimeout(() => setCopiedSlug(undefined), 1800);
				showNotice(done);
			} catch {
				showNotice(`Could not copy ${icon.name}. Try again.`);
			}
		},
		[showNotice],
	);

	// The clipboard write starts inside the click while the export code loads.
	const copyForExcalidraw = useCallback(
		(icon: CommunityIconEntry) =>
			copy(
				loadExcalidrawExport().then(({ excalidrawClipboard }) =>
					excalidrawClipboard(
						{ slug: bareSlug(icon.slug), name: icon.name, recipe: icon.recipe },
						"community",
						{ named },
					),
				),
				`${icon.name} copied. Paste it into Excalidraw.`,
				icon,
			),
		[copy, named],
	);

	const downloadLibrary = useCallback(
		async (picked: readonly CommunityIconEntry[], name: string) => {
			try {
				const { excalidrawLibrary } = await loadExcalidrawExport();
				downloadBlob(
					new Blob([excalidrawLibrary(picked, window.location.origin, "community", { named })], {
						type: "application/vnd.excalidrawlib+json",
					}),
					name,
				);
			} catch {
				showNotice("Could not prepare the library. Try again.");
			}
		},
		[named, showNotice],
	);

	function runDetailAction(action: CommunityDetailAction, icon: CommunityIconEntry) {
		if (action === "copy-excalidraw") void copyForExcalidraw(icon);
		else if (action === "copy-slug") void copy(icon.slug, `${icon.slug} copied.`, icon);
		else void downloadLibrary([icon], `${bareSlug(icon.slug)}${namedSuffix}.excalidrawlib`);
	}

	const searching = query.trim() !== "";
	const empty = status === "ready" && icons.length === 0;

	return (
		<TooltipProvider>
			{/* The first pointer or focus on the page fetches the export code, so a copy never waits on it. */}
			<div
				className="icons-product"
				onFocus={preloadExcalidrawExport}
				onPointerOver={preloadExcalidrawExport}
			>
				<IconsChrome detailOpen={Boolean(detailIcon)} homeHref={homeHref} section="community">
					<main
						aria-hidden={detailIcon ? "true" : undefined}
						className="icons-main"
						inert={detailIcon ? true : undefined}
					>
						<div className="icons-shell">
							<div className="icons-toolbar community-toolbar">
								<h1 className="sr-only">Community icons</h1>
								<div className="icons-search">
									<Search aria-hidden="true" className="icons-search__icon" />
									<input
										aria-controls="community-results"
										aria-label="Search community icons"
										autoComplete="off"
										enterKeyHint="search"
										onChange={(event) => onQueryChange(event.currentTarget.value)}
										placeholder="Search community icons"
										ref={searchRef}
										spellCheck={false}
										type="search"
										value={query}
									/>
									{query ? (
										<button
											aria-label="Clear search"
											className="icons-search__clear"
											onClick={() => {
												onQueryChange("");
												searchRef.current?.focus();
											}}
											title="Clear search"
											type="button"
										>
											<X aria-hidden="true" />
										</button>
									) : null}
								</div>
								<button
									className="community-download"
									disabled={icons.length === 0}
									onClick={() =>
										void downloadLibrary(icons, `sketchi-community${namedSuffix}.excalidrawlib`)
									}
									type="button"
								>
									<Download aria-hidden="true" />
									{/* A phone keeps the verb; Names beside it says which. */}
									<span>
										{"Download "}
										<span className="community-download__scope">
											{named ? "with names" : "library"}
										</span>
									</span>
								</button>
								<div className="community-toolbar__view">
									<NamesToggle onChange={setNamed} value={named} />
									<PreviewToggle onChange={setPreviewMode} value={previewMode} />
								</div>
							</div>

							{/* An empty gallery's state says what a zero count would. */}
							<div className="icons-results-bar" data-empty={empty ? "true" : undefined}>
								<p
									aria-live="polite"
									className={empty ? "sr-only" : "icons-results-bar__count"}
									role="status"
								>
									{status !== "ready"
										? ""
										: empty
											? searching
												? "No icons found"
												: "No community icons yet"
											: hasMore
												? `${icons.length.toLocaleString()}+ icons`
												: plural(icons.length, "icon", "icons")}
								</p>
							</div>

							{linked ? (
								<section className="icons-state community-linked" role="alert">
									<h2>
										{linked.status === "missing"
											? `${linked.slug} is not published`
											: `Could not load ${linked.slug}`}
									</h2>
									{linked.status === "error" && onRetryLinked ? (
										<button onClick={onRetryLinked} type="button">
											Try again
										</button>
									) : null}
								</section>
							) : null}

							{status === "loading" ? (
								<section className="icons-loading" aria-label="Loading icons" role="status">
									{Array.from({ length: 12 }, (_, index) => (
										<span className="icons-loading__tile" key={index} />
									))}
									<span className="sr-only">Loading icons</span>
								</section>
							) : null}

							{status === "error" ? (
								<section className="icons-state" role="alert">
									<h2>Could not load community icons</h2>
									<p>{errorMessage ?? "Check your connection and try again."}</p>
									{onRetry ? (
										<button onClick={onRetry} type="button">
											Try again
										</button>
									) : null}
								</section>
							) : null}

							{empty ? (
								<section className="icons-state">
									<h2>{searching ? "No icons found" : "No community icons yet"}</h2>
									{searching ? (
										<div className="icons-state__actions">
											<button onClick={() => onQueryChange("")} type="button">
												Clear search
											</button>
										</div>
									) : (
										<p>
											Draw one with <code>sketchi icon draw --publish</code>.
										</p>
									)}
								</section>
							) : null}

							{status === "ready" && icons.length > 0 ? (
								<section aria-label="Community icons" className="icons-grid" id="community-results">
									{icons.map((icon) => (
										<CommunityCard
											copied={copiedSlug === icon.slug}
											icon={icon}
											key={icon.slug}
											named={named}
											onCopy={(icon) => void copyForExcalidraw(icon)}
											onDetails={(picked) =>
												setDetail({
													opener:
														document.activeElement instanceof HTMLElement
															? document.activeElement
															: null,
													slug: picked.slug,
												})
											}
											previewMode={previewMode}
										/>
									))}
								</section>
							) : null}
							<div aria-hidden="true" className="icons-scroll-sentinel" ref={sentinel} />
						</div>
					</main>
				</IconsChrome>

				{detailIcon ? (
					<div className="icon-detail-layer">
						<button
							aria-label="Close icon details"
							className="icon-detail-layer__scrim"
							onClick={closeDetail}
							tabIndex={-1}
							type="button"
						/>
						<CommunityDetail
							icon={detailIcon}
							named={named}
							onAction={runDetailAction}
							onClose={closeDetail}
							onNamedChange={setNamed}
							onPreviewModeChange={setPreviewMode}
							previewMode={previewMode}
							returnFocusTo={detail?.opener ?? null}
						/>
					</div>
				) : null}

				<div aria-live="polite" aria-atomic="true" className="icons-toast" role="status">
					{notice}
				</div>
			</div>
		</TooltipProvider>
	);
}
