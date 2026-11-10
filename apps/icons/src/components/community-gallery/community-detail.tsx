import { X } from "lucide-react";
import { useRef } from "react";

import type { CommunityIconEntry } from "../../lib/community-client.js";
import { useDialogFocus } from "../../lib/use-dialog-focus.js";
import { PreviewToggle, type PreviewMode } from "../preview-toggle/index.js";
import { RecipePreview } from "../recipe-preview/index.js";

export type CommunityDetailAction = "copy-excalidraw" | "copy-slug" | "download";

const actions: readonly { readonly action: CommunityDetailAction; readonly label: string }[] = [
	{ action: "copy-excalidraw", label: "Copy for Excalidraw" },
	{ action: "copy-slug", label: "Copy slug" },
	{ action: "download", label: "Download .excalidrawlib" },
];

export function CommunityDetail({
	icon,
	onAction,
	onClose,
	onPreviewModeChange,
	previewMode,
	returnFocusTo,
}: {
	readonly icon: CommunityIconEntry;
	readonly onAction: (action: CommunityDetailAction, icon: CommunityIconEntry) => void;
	readonly onClose: () => void;
	readonly onPreviewModeChange: (mode: PreviewMode) => void;
	readonly previewMode: PreviewMode;
	readonly returnFocusTo: HTMLElement | null;
}) {
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLElement>(null);
	useDialogFocus({ dialog: dialogRef, initial: closeButtonRef, onClose, returnFocusTo });
	const published = new Date(icon.createdAt);

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
					{Number.isNaN(published.getTime()) ? null : (
						<p className="icon-detail__collection">
							<time dateTime={icon.createdAt}>
								{published.toLocaleDateString(undefined, { dateStyle: "medium" })}
							</time>
						</p>
					)}
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

			<div className="icon-detail__preview" data-preview={previewMode}>
				<RecipePreview
					className="community-detail__drawing"
					label={`${icon.name} preview`}
					previewMode={previewMode}
					recipe={icon.recipe}
				/>
			</div>

			<div className="icon-detail__preview-row">
				<PreviewToggle onChange={onPreviewModeChange} value={previewMode} />
			</div>

			<div className="icon-detail__url">
				<span>Diagram icon slug</span>
				<code>{icon.slug}</code>
			</div>

			<div className="icon-detail__actions">
				{actions.map(({ action, label }) => (
					<button
						className={action === "copy-excalidraw" ? "is-primary" : undefined}
						key={action}
						onClick={() => onAction(action, icon)}
						type="button"
					>
						{label}
					</button>
				))}
			</div>
		</aside>
	);
}
