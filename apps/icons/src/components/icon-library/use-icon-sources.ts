import { useCallback, useRef, useState } from "react";
import {
	copyText,
	createIconZip,
	downloadBlob,
	downloadSvg,
	mapWithConcurrency,
	svgDataUri,
	svgToJsxComponent,
} from "../../lib/actions.js";
import type { SketchiIcon } from "@sketchi/icon-catalog";
import { permanentSvgUrl } from "../../lib/permanent-svg-url.js";
import type { IconDetailAction } from "../icon-detail/index.js";

export type SelectionAction = "copy" | "zip";
const FETCH_CONCURRENCY = 8;

export function useIconSources(selectedIcons: readonly SketchiIcon[]) {
	const [copyingSlug, setCopyingSlug] = useState<string>();
	const [copiedSlug, setCopiedSlug] = useState<string>();
	const [busyDetailAction, setBusyDetailAction] = useState<IconDetailAction>();
	const [busySelectionAction, setBusySelectionAction] = useState<SelectionAction>();
	// Both halves are snapshotted when a bulk action starts: it runs over the
	// selection as it was then, so editing the selection mid-flight must not
	// move the denominator.
	const [selectionProgress, setSelectionProgress] = useState({
		done: 0,
		total: 0,
	});
	const [notice, setNotice] = useState("");
	const noticeTimerRef = useRef<number | undefined>(undefined);
	const copiedTimerRef = useRef<number | undefined>(undefined);
	const sourceCache = useRef(new Map<string, Promise<string>>());

	const showNotice = useCallback((message: string) => {
		setNotice(message);
		if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
		noticeTimerRef.current = window.setTimeout(() => setNotice(""), 3200);
	}, []);

	const getSvg = useCallback(async (icon: SketchiIcon): Promise<string> => {
		const cached = sourceCache.current.get(icon.slug);
		if (cached) return cached;
		const pending = fetch(icon.svgPath).then(async (response) => {
			if (!response.ok) {
				throw new Error(`SVG returned HTTP ${response.status}.`);
			}
			return response.text();
		});
		sourceCache.current.set(icon.slug, pending);
		try {
			return await pending;
		} catch (error) {
			sourceCache.current.delete(icon.slug);
			throw error;
		}
	}, []);

	const copySvg = useCallback(
		async (icon: SketchiIcon) => {
			if (copyingSlug) return;
			setCopyingSlug(icon.slug);
			try {
				await copyText(await getSvg(icon));
				setCopiedSlug(icon.slug);
				showNotice(`${icon.name} SVG copied.`);
				if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
				copiedTimerRef.current = window.setTimeout(() => setCopiedSlug(undefined), 1800);
			} catch {
				showNotice(`Could not copy ${icon.name}. Try again.`);
			} finally {
				setCopyingSlug(undefined);
			}
		},
		[copyingSlug, getSvg, showNotice],
	);

	async function runDetailAction(action: IconDetailAction, icon: SketchiIcon) {
		setBusyDetailAction(action);
		try {
			const url = permanentSvgUrl(icon.slug);
			if (action === "copy-url") {
				await copyText(url);
			} else {
				const svg = await getSvg(icon);
				if (action === "copy-svg") await copyText(svg);
				if (action === "copy-jsx") await copyText(svgToJsxComponent(svg, icon));
				if (action === "copy-data-uri") await copyText(svgDataUri(svg));
				if (action === "download") downloadSvg(svg, icon.slug);
			}
			showNotice(
				action === "download"
					? `${icon.name} downloaded.`
					: `${icon.name} ${
							action === "copy-url"
								? "URL"
								: action === "copy-jsx"
									? "JSX"
									: action === "copy-data-uri"
										? "data URI"
										: "SVG"
						} copied.`,
			);
		} catch {
			showNotice(`Could not complete that action for ${icon.name}.`);
		} finally {
			setBusyDetailAction(undefined);
		}
	}

	async function runSelectionAction(action: SelectionAction) {
		const batch = selectedIcons;
		if (!batch.length) return;
		setBusySelectionAction(action);
		setSelectionProgress({ done: 0, total: batch.length });
		try {
			const sources = await mapWithConcurrency(batch, FETCH_CONCURRENCY, async (icon) => {
				const svg = await getSvg(icon);
				setSelectionProgress((progress) => ({
					...progress,
					done: progress.done + 1,
				}));
				return { slug: icon.slug, svg };
			});
			if (action === "copy") {
				await copyText(sources.map(({ svg }) => svg).join("\n\n"));
				showNotice(`${sources.length} SVGs copied.`);
			} else {
				downloadBlob(createIconZip(sources), "sketchi-icons.zip");
				showNotice(`${sources.length} SVGs downloaded as a zip.`);
			}
		} catch {
			showNotice("Could not prepare the selected icons. Try again.");
		} finally {
			setBusySelectionAction(undefined);
			setSelectionProgress({ done: 0, total: 0 });
		}
	}

	return {
		busyDetailAction,
		busySelectionAction,
		copiedSlug,
		copyingSlug,
		copySvg,
		getSvg,
		notice,
		runDetailAction,
		runSelectionAction,
		selectionProgress,
		showNotice,
	};
}
