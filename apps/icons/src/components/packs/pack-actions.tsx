import { Download, ExternalLink, Upload } from "lucide-react";

import type { PackExcalidrawState } from "../../lib/excalidraw-publish.js";
import { packLibraryFileName, packLibraryPath, type PackSummary } from "../../lib/packs.js";

/**
 * Download the pack's library; add it to Excalidraw once it has an install
 * link, or publish it there while its current version can be.
 */
export function PackActions({
	describedBy,
	excalidraw,
	onPublish,
	pack,
	size = "compact",
}: {
	/** The id of the pack's name, so each action reads with the pack it acts on. */
	readonly describedBy?: string;
	readonly excalidraw?: PackExcalidrawState | undefined;
	readonly onPublish?: () => void;
	readonly pack: Pick<PackSummary, "id">;
	readonly size?: "compact" | "large";
}) {
	return (
		<div className="pack-actions" data-size={size}>
			<a
				aria-describedby={describedBy}
				className="pack-actions__download"
				download={packLibraryFileName(pack.id)}
				href={packLibraryPath(pack.id)}
			>
				<Download aria-hidden="true" />
				<span>Download</span>
			</a>
			{excalidraw?.installUrl ? (
				<a
					aria-describedby={describedBy}
					href={excalidraw.installUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					<ExternalLink aria-hidden="true" />
					<span>Add to Excalidraw</span>
				</a>
			) : null}
			{excalidraw?.publishable && onPublish ? (
				<button aria-describedby={describedBy} onClick={onPublish} type="button">
					<Upload aria-hidden="true" />
					<span>Publish to Excalidraw</span>
				</button>
			) : null}
		</div>
	);
}
