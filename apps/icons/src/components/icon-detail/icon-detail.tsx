import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import { X } from "lucide-react";
import { useRef } from "react";

import { formatCollectionLabel, type SketchiIcon } from "@sketchi/icon-catalog";

import { formatBytes } from "../../lib/format-bytes.js";
import { IconMark } from "../icon-mark/index.js";
import { useDialogFocus } from "../../lib/use-dialog-focus.js";
import { PreviewToggle } from "../preview-toggle/index.js";
import { RecipePreview } from "../recipe-preview/index.js";

export type IconDetailAction =
	| "copy-data-uri"
	| "copy-excalidraw"
	| "copy-jsx"
	| "copy-svg"
	| "copy-url"
	| "download";

export interface IconDetailProps {
	readonly busyAction?: IconDetailAction;
	/** The mark's hand-drawn version, shown beside the SVG when it has one. */
	readonly drawing?: IconRecipe;
	readonly icon: SketchiIcon;
	readonly onAction?: (action: IconDetailAction, icon: SketchiIcon) => void;
	readonly onClose?: () => void;
	readonly onPreviewModeChange?: (mode: "dark" | "light") => void;
	readonly permanentUrl: string;
	readonly previewMode?: "dark" | "light";
	readonly returnFocusTo?: HTMLElement | null;
}

const actionLabels: Readonly<Record<IconDetailAction, string>> = {
	"copy-data-uri": "Copy data URI",
	"copy-excalidraw": "Copy for Excalidraw",
	"copy-jsx": "Copy JSX",
	"copy-svg": "Copy SVG",
	"copy-url": "Copy URL",
	download: "Download SVG",
};

const detailActions: readonly IconDetailAction[] = [
	"copy-svg",
	"copy-url",
	"copy-jsx",
	"copy-data-uri",
	"download",
];

export function IconDetail({
	busyAction,
	drawing,
	icon,
	onAction,
	onClose,
	onPreviewModeChange,
	permanentUrl,
	previewMode = "light",
	returnFocusTo,
}: IconDetailProps) {
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLElement>(null);

	useDialogFocus({ dialog: dialogRef, initial: closeButtonRef, onClose, returnFocusTo });

	return (
		<aside
			aria-label={`${icon.name} details`}
			aria-modal="true"
			className="icon-detail"
			ref={dialogRef}
			role="dialog"
		>
			<header className="icon-detail__head">
				<div>
					<h2>{icon.name}</h2>
					<p className="icon-detail__collection">{formatCollectionLabel(icon.collection)}</p>
				</div>
				<button
					aria-label="Close icon details"
					className="icon-detail__close"
					onClick={onClose}
					ref={closeButtonRef}
					title="Close"
					type="button"
				>
					<X aria-hidden="true" />
				</button>
			</header>

			{drawing ? (
				<div className="icon-detail__previews">
					<figure className="icon-detail__figure">
						<div className="icon-detail__preview" data-preview={previewMode}>
							<IconMark alt={`${icon.name} SVG`} icon={icon} surface={previewMode} />
						</div>
						<figcaption>SVG</figcaption>
					</figure>
					<figure className="icon-detail__figure">
						<div className="icon-detail__preview" data-preview={previewMode}>
							<RecipePreview
								className="icon-detail__drawing"
								label={`${icon.name} hand-drawn`}
								previewMode={previewMode}
								recipe={drawing}
							/>
						</div>
						<figcaption>Hand-drawn</figcaption>
					</figure>
				</div>
			) : (
				<div className="icon-detail__preview" data-preview={previewMode}>
					<IconMark alt={`${icon.name} preview`} icon={icon} surface={previewMode} />
				</div>
			)}

			<div className="icon-detail__preview-row">
				<PreviewToggle onChange={(mode) => onPreviewModeChange?.(mode)} value={previewMode} />
			</div>

			<dl className="icon-detail__meta">
				<div>
					<dt>Dimensions</dt>
					<dd>
						{icon.viewBox.width} × {icon.viewBox.height}
					</dd>
				</div>
				<div>
					<dt>File size</dt>
					<dd>{formatBytes(icon.bytes)}</dd>
				</div>
				{icon.variant ? (
					<div>
						<dt>Style</dt>
						<dd>{icon.variant === "text" ? "Wordmark" : icon.variant}</dd>
					</div>
				) : null}
			</dl>

			<div className="icon-detail__url">
				<span>Permanent SVG URL</span>
				<code>{permanentUrl}</code>
			</div>

			<div className="icon-detail__actions">
				{(drawing ? [...detailActions, "copy-excalidraw" as const] : detailActions).map(
					(action) => (
						<button
							className={action === "copy-svg" ? "is-primary" : undefined}
							disabled={busyAction !== undefined}
							key={action}
							onClick={() => onAction?.(action, icon)}
							type="button"
						>
							{busyAction === action ? "Working" : actionLabels[action]}
						</button>
					),
				)}
			</div>

			{icon.aliases.length ? (
				<p className="icon-detail__aliases">Also found by: {icon.aliases.join(", ")}</p>
			) : null}
		</aside>
	);
}
