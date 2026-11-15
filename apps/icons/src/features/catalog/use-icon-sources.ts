import { RegistryContext, useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react";
import { type IconRecipe } from "@sketchi/drawing";
import { type SketchiIcon } from "@sketchi/icon-catalog";
import { Array, Cache, Duration, Effect, Exit } from "effect";
import { HttpClient } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";
import { useCallback, useContext, useState } from "react";

import { queryRuntime, IconQueryError } from "../../lib/query-atoms.js";
import { permanentSvgUrl } from "../../lib/permanent-svg-url.js";
import { useExportFeedback } from "../browser/feedback.js";
import {
	copyText,
	createIconZip,
	downloadBlob,
	downloadSvg,
	svgDataUri,
	svgToJsxComponent,
} from "../export/actions.js";
import { type IconDetailAction } from "./icon-detail/icon-detail.js";

export type SelectionAction = "copy" | "zip";
const loadExcalidrawExport = () => import("../export/excalidraw-export.js");
// ClipboardItem requires a native Promise supplied during the user's click.
const drawingClipboard = (icon: SketchiIcon, drawing: IconRecipe, named: boolean) =>
	loadExcalidrawExport().then(({ excalidrawClipboard }) =>
		excalidrawClipboard({ ...icon, recipe: drawing }, "catalog", { named }),
	);
const clipboard = (text: string | Promise<string>) => Effect.tryPromise(() => copyText(text));

/** Each mounted library owns its cache, actions, interruption and progress. */
export function useIconSources(
	selectedIcons: () => readonly SketchiIcon[],
	{ named }: { readonly named: boolean },
) {
	const registry = useContext(RegistryContext);
	const feedback = useExportFeedback();
	const { showNotice, showCopied } = feedback;
	const [actions] = useState(() => {
		const sources = queryRuntime
			.atom(
				Effect.gen(function* () {
					const client = yield* HttpClient.HttpClient;
					return yield* Cache.makeWith(
						Effect.fn("Icons.svg.load")(function* (path: string) {
							const response = yield* client.get(new URL(path, window.location.origin).href);
							if (response.status < 200 || response.status >= 300)
								return yield* Effect.fail(
									new IconQueryError({ message: `SVG returned HTTP ${response.status}.` }),
								);
							return yield* response.text;
						}),
						{
							capacity: 300,
							timeToLive: (exit) => (Exit.isFailure(exit) ? Duration.zero : Duration.infinity),
						},
					);
				}),
			)
			.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);
		const getSvg = Effect.fn("Icons.svg.source")(function* (
			icon: SketchiIcon,
			get: Atom.FnContext,
		) {
			return yield* Cache.get(yield* get.result(sources), icon.svgPath);
		});
		const copy = queryRuntime
			.fn(
				Effect.fn("Icons.catalog.copy")(function* (
					{
						icon,
						drawing,
						named,
					}: { readonly icon: SketchiIcon; readonly drawing?: IconRecipe; readonly named: boolean },
					get: Atom.FnContext,
				) {
					get.setSelf(AsyncResult.success(icon.slug, { waiting: true }));
					yield* (
						drawing
							? clipboard(drawingClipboard(icon, drawing, named))
							: getSvg(icon, get).pipe(Effect.flatMap(clipboard))
					).pipe(
						Effect.match({
							onFailure: () => showNotice(`Could not copy ${icon.name}. Try again.`),
							onSuccess: () => {
								showCopied(icon.slug);
								showNotice(
									drawing
										? `${icon.name} copied. Paste it into Excalidraw.`
										: `${icon.name} SVG copied.`,
								);
							},
						}),
					);
					return icon.slug;
				}),
			)
			.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);
		const detail = queryRuntime
			.fn(
				Effect.fn("Icons.catalog.detailExport")(function* (
					{
						action,
						icon,
						drawing,
						named,
					}: {
						readonly action: IconDetailAction;
						readonly icon: SketchiIcon;
						readonly drawing?: IconRecipe;
						readonly named: boolean;
					},
					get: Atom.FnContext,
				) {
					get.setSelf(AsyncResult.success(action, { waiting: true }));
					yield* Effect.gen(function* () {
						if (action === "copy-excalidraw") {
							if (!drawing)
								return yield* Effect.fail(
									new IconQueryError({ message: `${icon.slug} has no drawing.` }),
								);
							yield* clipboard(drawingClipboard(icon, drawing, named));
							showNotice(`${icon.name} copied. Paste it into Excalidraw.`);
							return;
						}
						if (action === "copy-url") yield* clipboard(permanentSvgUrl(icon.slug));
						else {
							const svg = yield* getSvg(icon, get);
							if (action === "copy-svg") yield* clipboard(svg);
							if (action === "copy-jsx")
								yield* Effect.try(() => svgToJsxComponent(svg, icon)).pipe(
									Effect.flatMap(clipboard),
								);
							if (action === "copy-data-uri")
								yield* Effect.try(() => svgDataUri(svg)).pipe(Effect.flatMap(clipboard));
							if (action === "download") yield* Effect.try(() => downloadSvg(svg, icon.slug));
						}
						showNotice(
							action === "download"
								? `${icon.name} downloaded.`
								: `${icon.name} ${action === "copy-url" ? "URL" : action === "copy-jsx" ? "JSX" : action === "copy-data-uri" ? "data URI" : "SVG"} copied.`,
						);
					}).pipe(
						Effect.catch(() =>
							Effect.sync(() => showNotice(`Could not complete that action for ${icon.name}.`)),
						),
					);
					return action;
				}),
			)
			.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);
		const progress = Atom.make({ done: 0, total: 0 }).pipe(Atom.setIdleTTL(0));
		const selection = queryRuntime
			.fn(
				Effect.fn("Icons.catalog.selectionExport")(function* (
					{
						action,
						batch,
					}: { readonly action: SelectionAction; readonly batch: readonly SketchiIcon[] },
					get: Atom.FnContext,
				) {
					get.setSelf(AsyncResult.success(action, { waiting: true }));
					get.set(progress, { done: 0, total: batch.length });
					yield* Effect.gen(function* () {
						const sources = yield* Effect.forEach(
							batch,
							Effect.fn("Icons.catalog.selectedSource")(function* (icon) {
								const svg = yield* getSvg(icon, get);
								const current = get.registry.get(progress);
								get.set(progress, { ...current, done: current.done + 1 });
								return { slug: icon.slug, svg };
							}),
							{ concurrency: 8 },
						);
						if (action === "copy") {
							yield* clipboard(
								Array.join(
									Array.map(sources, ({ svg }) => svg),
									"\n\n",
								),
							);
							showNotice(`Copied ${sources.length} ${sources.length === 1 ? "SVG" : "SVGs"}.`);
						} else {
							yield* Effect.try(() => downloadBlob(createIconZip(sources), "sketchi-icons.zip"));
							showNotice(
								`Downloaded ${sources.length} ${sources.length === 1 ? "SVG" : "SVGs"} as a zip.`,
							);
						}
					}).pipe(
						Effect.catch(() =>
							Effect.sync(() => showNotice("Could not prepare the selected icons. Try again.")),
						),
						Effect.ensuring(Effect.sync(() => get.set(progress, { done: 0, total: 0 }))),
					);
					return action;
				}),
			)
			.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);
		return { sources, copy, detail, selection, progress };
	});
	useAtomMount(actions.sources);
	const copyState = useAtomValue(actions.copy);
	const detailState = useAtomValue(actions.detail);
	const selectionState = useAtomValue(actions.selection);
	const copy = useAtomSet(actions.copy);
	const detail = useAtomSet(actions.detail);
	const selection = useAtomSet(actions.selection);
	return {
		...feedback,
		copyingSlug: copyState.waiting ? AsyncResult.getOrElse(copyState, () => undefined) : undefined,
		busyDetailAction: detailState.waiting
			? AsyncResult.getOrElse(detailState, () => undefined)
			: undefined,
		busySelectionAction: selectionState.waiting
			? AsyncResult.getOrElse(selectionState, () => undefined)
			: undefined,
		selectionProgress: useAtomValue(actions.progress),
		copySvg: useCallback(
			(icon: SketchiIcon, drawing?: IconRecipe) => {
				if (!registry.get(actions.copy).waiting)
					copy({ icon, ...(drawing ? { drawing } : {}), named });
			},
			[actions.copy, copy, named, registry],
		),
		runDetailAction: (action: IconDetailAction, icon: SketchiIcon, drawing?: IconRecipe) =>
			detail({ action, icon, ...(drawing ? { drawing } : {}), named }),
		runSelectionAction: (action: SelectionAction) => {
			const batch = selectedIcons();
			if (batch.length && !registry.get(actions.selection).waiting) selection({ action, batch });
		},
	};
}
