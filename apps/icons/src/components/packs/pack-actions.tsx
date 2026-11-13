import { Download, Upload } from "lucide-react";

import type { PackExcalidrawState, PackPullRequest } from "../../lib/excalidraw-publish.js";
import { packLibraryFileName, packLibraryPath, type PackSummary } from "../../lib/packs.js";
import { ExcalidrawGlyph, GitHubGlyph } from "./brand-glyphs.js";

const STATE_LABELS = { open: "Open", merged: "Merged", closed: "Closed" } as const;

/**
 * Adds a submitted library to the visitor's Excalidraw, in a new tab.
 * Compact, it reads "Add" beside Excalidraw's mark, so a card keeps its
 * actions on one line.
 */
export function AddToExcalidrawLink({
	className,
	compact = false,
	describedBy,
	href,
}: {
	readonly className?: string;
	readonly compact?: boolean;
	readonly describedBy?: string | undefined;
	readonly href: string;
}) {
	return (
		<a
			aria-describedby={describedBy}
			aria-label={compact ? "Add to Excalidraw" : undefined}
			className={className}
			href={href}
			rel="noopener noreferrer"
			target="_blank"
			title={compact ? "Add to Excalidraw" : undefined}
		>
			<ExcalidrawGlyph />
			<span>{compact ? "Add" : "Add to Excalidraw"}</span>
		</a>
	);
}

/**
 * The pack's pull request on GitHub, with its state once GitHub has been read.
 * Compact, it is the mark alone, named for screen readers and tooltips, with
 * a dot in the state's color.
 */
export function PullRequestLink({
	compact = false,
	describedBy,
	pullRequest,
}: {
	readonly compact?: boolean;
	readonly describedBy?: string | undefined;
	readonly pullRequest: PackPullRequest;
}) {
	const state = pullRequest.state ? STATE_LABELS[pullRequest.state] : undefined;
	const name = state ? `Pull request, ${state.toLowerCase()}` : "Pull request";
	return (
		<a
			aria-describedby={describedBy}
			aria-label={name}
			className="pack-actions__pull-request"
			data-compact={compact ? "true" : undefined}
			data-state={pullRequest.state}
			href={pullRequest.url}
			rel="noopener noreferrer"
			target="_blank"
			title={compact ? name : undefined}
		>
			<GitHubGlyph />
			{compact ? (
				state ? (
					<span aria-hidden="true" className="pack-actions__state-dot" />
				) : null
			) : (
				<>
					<span>Pull request</span>
					{state ? <span className="pack-actions__state">{state}</span> : null}
				</>
			)}
		</a>
	);
}

/**
 * Download the pack's library, plain or named; add it to Excalidraw while its
 * library is in reach, follow its pull request once it is submitted, or
 * publish it there while its current version can be.
 */
export function PackActions({
	describedBy,
	excalidraw,
	named = false,
	onPublish,
	pack,
	size = "compact",
}: {
	/** The id of the pack's name, so each action reads with the pack it acts on. */
	readonly describedBy?: string;
	readonly excalidraw?: PackExcalidrawState | undefined;
	/** Download the library with each name written under its drawing. */
	readonly named?: boolean;
	readonly onPublish?: () => void;
	readonly pack: Pick<PackSummary, "id">;
	readonly size?: "compact" | "large";
}) {
	return (
		<div className="pack-actions" data-size={size}>
			<a
				aria-describedby={describedBy}
				className="pack-actions__primary"
				download={packLibraryFileName(pack.id, { named })}
				href={packLibraryPath(pack.id, { named })}
			>
				<Download aria-hidden="true" />
				<span>{named ? "Download with names" : "Download"}</span>
			</a>
			{excalidraw?.installUrl ? (
				<AddToExcalidrawLink
					compact={size === "compact"}
					describedBy={describedBy}
					href={excalidraw.installUrl}
				/>
			) : null}
			{excalidraw?.pullRequest ? (
				<PullRequestLink
					compact={size === "compact"}
					describedBy={describedBy}
					pullRequest={excalidraw.pullRequest}
				/>
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
