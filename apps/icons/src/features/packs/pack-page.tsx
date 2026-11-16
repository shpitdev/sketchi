import { Array as Arr, Effect } from "effect";
import { TooltipProvider } from "@sketchi/ui/components/tooltip";
import { useCallback, useState } from "react";

import { copyText } from "../export/actions";
import { SKETCHI_WEB_HOME_URL } from "../../lib/home-url";
import type { PackExcalidrawState } from "./publication";
import { iconCount, type PackIcon, type PackSummary } from "../../lib/packs";
import { useAtom, useAtomSet } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useExportFeedback } from "../browser/feedback";
import { drawnNames } from "../browser/drawn-names";
import { useLoadOnScroll } from "../browser/use-load-on-scroll";
import { DrawnIcon } from "../../components/drawn-icon/drawn-icon";
import { IconsChrome } from "../../components/icons-chrome";
import { NamesToggle } from "../../components/names-toggle/names-toggle";
import { PreviewToggle, type PreviewMode } from "../../components/preview-toggle/preview-toggle";
import { PackActions } from "./pack-actions";
import { PackPublishDialog } from "./pack-publish-dialog";
import { usePackPublishing } from "./use-pack-publishing";

const PAGE_SIZE = 96;

const loadExcalidrawExport = () => import("../export/excalidraw-export");
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

/**
 * One pack: every drawing in it with its product name, and the pack's actions.
 * "Names" writes each name under its drawing in the tiles, the copies and the
 * download; Excalidraw's collection only has the plain library.
 */
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
	const [preview] = useState(() => Atom.make<PreviewMode>(initialPreviewMode));
	const [previewMode, setPreviewMode] = useAtom(preview);
	const [named, setNamed] = useAtom(drawnNames);
	const publishing = usePackPublishing(excalidraw ? { [pack.id]: excalidraw } : {});
	const [pages] = useState(() => Atom.make(PAGE_SIZE));
	const [shown, setShown] = useAtom(pages);
	const { copiedSlug, notice, showNotice, showCopied } = useExportFeedback();
	const showMore = useCallback(() => setShown((count) => count + PAGE_SIZE), [setShown]);
	const sentinel = useLoadOnScroll<HTMLDivElement>(
		status === "ready" && shown < icons.length ? shown : undefined,
		showMore,
	);

	const [copyAction] = useState(() =>
		Atom.fn(
			Effect.fn("Icons.packs.copy")(function* ({
				pending,
				icon,
			}: {
				readonly pending: Promise<string>;
				readonly icon: PackIcon;
			}) {
				yield* Effect.tryPromise(() => copyText(pending)).pipe(
					Effect.match({
						onFailure: () => showNotice(`Could not copy ${icon.name}. Try again.`),
						onSuccess: () => {
							showCopied(icon.slug);
							showNotice(`${icon.name} copied. Paste it into Excalidraw.`);
						},
					}),
				);
			}),
		).pipe(Atom.setIdleTTL(0)),
	);
	const startCopy = useAtomSet(copyAction);
	const copy = (icon: PackIcon) =>
		startCopy({
			icon,
			pending: loadExcalidrawExport().then(({ excalidrawClipboard }) =>
				excalidrawClipboard(icon, "catalog", { named }),
			),
		});

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
								<div className="pack-hero__heading">
									<h1 className="pack-hero__title" id="pack-title">
										{pack.name}
									</h1>
									<p className="pack-hero__count">
										{iconCount(status === "ready" ? icons.length : pack.count)}
									</p>
								</div>
								<PackActions
									describedBy="pack-title"
									excalidraw={named ? undefined : publishing.states[pack.id]}
									named={named}
									onPublish={() => publishing.open(pack.id)}
									pack={pack}
									size="large"
								/>
								<div className="pack-hero__view">
									<NamesToggle onChange={setNamed} value={named} />
									<PreviewToggle onChange={setPreviewMode} value={previewMode} />
								</div>
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
									{Arr.map(icons.slice(0, shown), (icon) => (
										<article className="icon-card" key={icon.slug}>
											<button
												aria-label={`Copy ${icon.name} for Excalidraw`}
												className="icon-card__copy"
												onClick={() => copy(icon)}
												type="button"
											>
												<span className="icon-card__preview" data-preview={previewMode}>
													<DrawnIcon
														className="icon-card__drawing"
														name={named ? icon.name : undefined}
														previewMode={previewMode}
														recipe={icon.recipe}
													/>
													<span className="icon-card__copy-cue">
														{copiedSlug === icon.slug ? "Copied" : "Copy"}
													</span>
												</span>
												{/* Named, the tile already writes the name. */}
												{named ? null : <span className="icon-card__name">{icon.name}</span>}
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
