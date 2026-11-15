import { Array as Arr, String as Str, Option as Opt, Effect } from "effect";
import { TooltipProvider } from "@sketchi/ui/components/tooltip";
import { Download, Search, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { copyText, downloadBlob } from "../export/actions.js";
import { bareSlug, type CommunityIconEntry } from "../../lib/community-client.js";
import { SKETCHI_WEB_HOME_URL } from "../../lib/home-url.js";
import { useAtom, useAtomSet } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useExportFeedback } from "../browser/feedback.js";
import { drawnNames } from "../browser/drawn-names.js";
import { useLoadOnScroll } from "../browser/use-load-on-scroll.js";
import { IconsChrome } from "../../components/icons-chrome.js";
import { NamesToggle } from "../../components/names-toggle/names-toggle.js";
import { PreviewToggle, type PreviewMode } from "../../components/preview-toggle/preview-toggle.js";
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

const loadExcalidrawExport = () => import("../export/excalidraw-export.js");
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
	const [preview] = useState(() => Atom.make<PreviewMode>(initialPreviewMode));
	const [previewMode, setPreviewMode] = useAtom(preview);
	const [named, setNamed] = useAtom(drawnNames);
	const namedSuffix = named ? "-with-names" : "";
	const [details] = useState(() =>
		Atom.make<{ readonly opener: HTMLElement | null; readonly slug: string } | undefined>(
			initialIcon ? { opener: null, slug: initialIcon.slug } : undefined,
		),
	);
	const [detail, setDetail] = useAtom(details);
	const { notice, copiedSlug, showNotice, showCopied } = useExportFeedback();
	const searchRef = useRef<HTMLInputElement>(null);
	const detailIcon = detail
		? (Opt.getOrElse(
				Arr.findFirst(icons, (icon) => icon.slug === detail.slug),
				() => undefined,
			) ?? (initialIcon?.slug === detail.slug ? initialIcon : undefined))
		: undefined;
	const closeDetail = useCallback(() => setDetail(undefined), [setDetail]);
	const loadMore = useCallback(() => onLoadMore?.(), [onLoadMore]);
	const sentinel = useLoadOnScroll<HTMLDivElement>(
		status === "ready" && hasMore && !loadingMore && onLoadMore ? icons.length : undefined,
		loadMore,
	);

	const [copyAction] = useState(() =>
		Atom.fn(
			Effect.fn("Icons.community.copy")(function* ({
				value,
				done,
				icon,
			}: {
				readonly value: string | Promise<string>;
				readonly done: string;
				readonly icon: CommunityIconEntry;
			}) {
				yield* Effect.tryPromise(() => copyText(value)).pipe(
					Effect.match({
						onFailure: () => showNotice(`Could not copy ${icon.name}. Try again.`),
						onSuccess: () => {
							showCopied(icon.slug);
							showNotice(done);
						},
					}),
				);
			}),
		).pipe(Atom.setIdleTTL(0)),
	);
	const startCopy = useAtomSet(copyAction);
	const copy = useCallback(
		(value: string | Promise<string>, done: string, icon: CommunityIconEntry) =>
			startCopy({ value, done, icon }),
		[startCopy],
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

	const [downloadAction] = useState(() =>
		Atom.fn(
			Effect.fn("Icons.community.download")(function* ({
				picked,
				name,
				named,
			}: {
				readonly picked: readonly CommunityIconEntry[];
				readonly name: string;
				readonly named: boolean;
			}) {
				yield* Effect.gen(function* () {
					const { excalidrawLibrary } = yield* Effect.tryPromise(loadExcalidrawExport);
					yield* Effect.try(() =>
						downloadBlob(
							new Blob(
								[excalidrawLibrary(picked, window.location.origin, "community", { named })],
								{
									type: "application/vnd.excalidrawlib+json",
								},
							),
							name,
						),
					);
				}).pipe(
					Effect.catch(() =>
						Effect.sync(() => showNotice("Could not prepare the library. Try again.")),
					),
				);
			}),
		).pipe(Atom.setIdleTTL(0)),
	);
	const startDownload = useAtomSet(downloadAction);
	const downloadLibrary = (picked: readonly CommunityIconEntry[], name: string) =>
		startDownload({ picked, name, named });

	function runDetailAction(action: CommunityDetailAction, icon: CommunityIconEntry) {
		if (action === "copy-excalidraw") copyForExcalidraw(icon);
		else if (action === "copy-slug") copy(icon.slug, `${icon.slug} copied.`, icon);
		else downloadLibrary([icon], `${bareSlug(icon.slug)}${namedSuffix}.excalidrawlib`);
	}

	const searching = Str.trim(query) !== "";
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
										downloadLibrary(icons, `sketchi-community${namedSuffix}.excalidrawlib`)
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
									{Arr.map(icons, (icon) => (
										<CommunityCard
											copied={copiedSlug === icon.slug}
											icon={icon}
											key={icon.slug}
											named={named}
											onCopy={(icon) => copyForExcalidraw(icon)}
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
