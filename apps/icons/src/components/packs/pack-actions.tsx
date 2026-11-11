import { Download, ExternalLink } from "lucide-react";

import {
	openInExcalidrawUrl,
	packLibraryFileName,
	packLibraryPath,
	type PackSummary,
} from "../../lib/packs.js";

/** Download the pack's library, or open the pack on excalidraw.com in a new tab. */
export function PackActions({
	describedBy,
	origin,
	pack,
	size = "compact",
}: {
	/** The id of the pack's name, so each action reads with the pack it acts on. */
	readonly describedBy?: string;
	readonly origin: string;
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
			<a
				aria-describedby={describedBy}
				href={openInExcalidrawUrl(pack.id, origin)}
				rel="noopener noreferrer"
				target="_blank"
			>
				<ExternalLink aria-hidden="true" />
				<span>Open in Excalidraw</span>
			</a>
		</div>
	);
}
