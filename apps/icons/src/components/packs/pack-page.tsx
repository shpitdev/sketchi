import { TooltipProvider } from "@sketchi/ui/components/tooltip";
import { useCallback, useRef, useState } from "react";

import { copyText } from "../../lib/actions.js";
import { SKETCHI_WEB_HOME_URL } from "../../lib/home-url.js";
import type { PackExcalidrawState } from "../../lib/excalidraw-publish.js";
import type { PackIcon, PackSummary } from "../../lib/packs.js";
import { useLoadOnScroll } from "../../lib/use-load-on-scroll.js";
import { IconsChrome } from "../icon-library/icons-chrome.js";
import { PreviewToggle, type PreviewMode } from "../preview-toggle/index.js";
import { RecipePreview } from "../recipe-preview/index.js";
import { PackActions } from "./pack-actions.js";
import { PackPublishDialog } from "./pack-publish-dialog.js";
import { iconCount } from "./pack-shelf.js";
import { usePackPublishing } from "./use-pack-publishing.js";

const PAGE_SIZE = 96;

const loadExcalidrawExport = () => import("../../lib/excalidraw-export.js");
// A failed prefetch is retried by the copy that needs the code, which reports it.
const preloadExcalidrawExport = () => {
	loadExcalidrawExport().catch(() => undefined);
};

type LoadStatus = "error" | "loading" | "ready";

export interface PackPageProps {
	readonly errorMessage?: string;
	readonly excalidraw?: PackExcalidrawState;
	readonly homeHref?: string;
	/** The pack's drawn marks, once the catalog has loaded. */
	readonly icons?: readonly PackIcon[];
	readonly initialPreviewMode?: PreviewMode;
	readonly onRetry?: () => void;
	readonly pack: PackSummary;
	readonly status: LoadStatus;
}

/** One pack: every drawing in it with its product name, and the pack's actions. */
export function PackPage({
	errorMessage,
	excalidraw,
	homeHref = SKETCHI_WEB_HOME_URL,
	icons = [],
	initialPreviewMode = "light",
	onRetry,
	pack,
	status,
}: PackPageProps) {
	const [previewMode, setPreviewMode] = useState<PreviewMode>(initialPreviewMode);
	const publishing = usePackPublishing(excalidraw ? { [pack.id]: excalidraw } : {});
	const [shown, setShown] = useState(PAGE_SIZE);
	const [copiedSlug, setCopiedSlug] = useState<string>();
	const [notice, setNotice] = useState("");
	const noticeTimer = useRef<number | undefined>(undefined);
	const copiedTimer = useRef<number | undefined>(undefined);
	const showMore = useCallback(() => setShown((count) => count + PAGE_SIZE), []);
	const sentinel = useLoadOnScroll<HTMLDivElement>(
		status === "ready" && shown < icons.length ? shown : undefined,
		showMore,
	);

	const showNotice = useCallback((message: string) => {
		setNotice(message);
		window.clearTimeout(noticeTimer.current);
		noticeTimer.current = window.setTimeout(() => setNotice(""), 3200);
	}, []);

	// The clipboard write starts inside the click while the export code loads.
	const copy = useCallback(
		async (icon: PackIcon) => {
			try {
				await copyText(
					loadExcalidrawExport().then(({ excalidrawClipboard }) =>
						excalidrawClipboard(icon, "catalog"),
					),
				);
				setCopiedSlug(icon.slug);
				window.clearTimeout(copiedTimer.current);
				copiedTimer.current = window.setTimeout(() => setCopiedSlug(undefined), 1800);
				showNotice(`${icon.name} copied. Paste it into Excalidraw.`);
			} catch {
				showNotice(`Could not copy ${icon.name}. Try again.`);
			}
		},
		[showNotice],
	);

	return (
		<TooltipProvider>
			{/* The first pointer or focus on the page fetches the export code, so a copy never waits on it. */}
			<div
				className="icons-product"
				onFocus={preloadExcalidrawExport}
				onPointerOver={preloadExcalidrawExport}
			>
				<IconsChrome detailOpen={false} homeHref={homeHref} section="pack">
					<main className="icons-main">
						<div className="icons-shell">
							<div className="pack-hero">
								<h1 className="pack-hero__title" id="pack-title">
									{pack.name}
								</h1>
								<p className="pack-hero__count">
									{iconCount(status === "ready" ? icons.length : pack.count)}
								</p>
								<PackActions
									describedBy="pack-title"
									excalidraw={publishing.states[pack.id]}
									onPublish={() => publishing.open(pack.id)}
									pack={pack}
									size="large"
								/>
								<PreviewToggle onChange={setPreviewMode} value={previewMode} />
							</div>

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
									<h2>Could not load the icons</h2>
									<p>{errorMessage ?? "Check your connection and try again."}</p>
									{onRetry ? (
										<button onClick={onRetry} type="button">
											Try again
										</button>
									) : null}
								</section>
							) : null}

							{status === "ready" ? (
								<section aria-labelledby="pack-title" className="icons-grid">
									{icons.slice(0, shown).map((icon) => (
										<article className="icon-card" key={icon.slug}>
											<button
												aria-label={`Copy ${icon.name} for Excalidraw`}
												className="icon-card__copy"
												onClick={() => void copy(icon)}
												type="button"
											>
												<span className="icon-card__preview" data-preview={previewMode}>
													<RecipePreview
														className="icon-card__drawing"
														previewMode={previewMode}
														recipe={icon.recipe}
													/>
													<span className="icon-card__copy-cue">
														{copiedSlug === icon.slug ? "Copied" : "Copy"}
													</span>
												</span>
												<span className="icon-card__name">{icon.name}</span>
											</button>
										</article>
									))}
								</section>
							) : null}
							<div aria-hidden="true" className="icons-scroll-sentinel" ref={sentinel} />
						</div>
					</main>
				</IconsChrome>

				{publishing.publishing ? (
					<PackPublishDialog
						onClose={publishing.close}
						onPublished={(result) => publishing.published(pack.id, result)}
						pack={pack}
					/>
				) : null}

				<div aria-live="polite" aria-atomic="true" className="icons-toast" role="status">
					{notice}
				</div>
			</div>
		</TooltipProvider>
	);
}
