import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@sketchi/ui/components/dialog";
import { useState, type ClipboardEvent, type FormEvent } from "react";

import {
	AUTHOR_NAME_MAX_LENGTH,
	packPublishPath,
	parseXHandle,
	type PublishResult,
	WEBSITE_MAX_LENGTH,
} from "../../lib/excalidraw-publish.js";
import { findPack, packPreviewImagePath, type PackSummary } from "../../lib/packs.js";
import { AddToExcalidrawLink, PullRequestLink } from "./pack-actions.js";
import { iconCount } from "./pack-shelf.js";

type Status =
	| { readonly kind: "editing"; readonly error?: string }
	| { readonly kind: "sending" }
	| { readonly kind: "sent"; readonly result: PublishResult };

async function publish(packId: string, form: FormData): Promise<PublishResult> {
	const typed = form.get("xHandle");
	const xHandle = parseXHandle(typeof typed === "string" ? typed : "");
	if (!xHandle.ok) throw new Error(xHandle.message);
	const response = await fetch(packPublishPath(packId), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			authorName: form.get("authorName"),
			xHandle: xHandle.handle,
			website: form.get("website"),
		}),
	});
	const body = (await response.json().catch(() => ({}))) as Partial<PublishResult> & {
		error?: { message?: string };
	};
	if (!response.ok || !body.pullRequestUrl) {
		throw new Error(body.error?.message ?? `Publishing failed with HTTP ${response.status}.`);
	}
	return {
		pullRequestUrl: body.pullRequestUrl,
		...(body.installUrl ? { installUrl: body.installUrl } : {}),
	};
}

/** Shows a pasted or typed profile link as the handle it names. */
function showHandle(input: HTMLInputElement, value: string): boolean {
	const parsed = parseXHandle(value);
	if (!parsed.ok || parsed.handle === input.value) return false;
	input.value = parsed.handle;
	return true;
}

function pasteHandle(event: ClipboardEvent<HTMLInputElement>) {
	const input = event.currentTarget;
	const replacesAll = input.selectionStart === 0 && input.selectionEnd === input.value.length;
	if (replacesAll && showHandle(input, event.clipboardData.getData("text"))) {
		event.preventDefault();
	}
}

/**
 * The pack's submission to Excalidraw's library collection, filled in but for
 * its author: the visitor names themselves, and the Worker sends the rest.
 */
export function PackPublishDialog({
	onClose,
	onPublished,
	pack,
}: {
	readonly onClose: () => void;
	readonly onPublished: (result: PublishResult) => void;
	readonly pack: PackSummary;
}) {
	const [status, setStatus] = useState<Status>({ kind: "editing" });
	const listing = findPack(pack.id)?.excalidrawListing;
	if (!listing) return null;
	const website = `https://icons.sketchi.app/packs/${pack.id}`;

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setStatus({ kind: "sending" });
		try {
			const result = await publish(pack.id, new FormData(event.currentTarget));
			setStatus({ kind: "sent", result });
			onPublished(result);
		} catch (error) {
			setStatus({
				kind: "editing",
				error: error instanceof Error ? error.message : "Publishing failed.",
			});
		}
	};

	return (
		<Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogTitle>Publish to Excalidraw</DialogTitle>
				{status.kind === "sent" ? (
					<div className="pack-publish">
						<DialogDescription>{listing.name} is submitted.</DialogDescription>
						<div className="pack-actions" data-size="large">
							{status.result.installUrl ? (
								<AddToExcalidrawLink
									className="pack-actions__primary"
									href={status.result.installUrl}
								/>
							) : null}
							<PullRequestLink pullRequest={{ url: status.result.pullRequestUrl, state: "open" }} />
						</div>
					</div>
				) : (
					<form className="pack-publish" onSubmit={(event) => void submit(event)}>
						<DialogDescription className="pack-publish__note">
							Excalidraw opens a public pull request on GitHub with you as the author.
						</DialogDescription>
						<img
							alt={`${listing.name} preview`}
							className="pack-publish__preview"
							src={packPreviewImagePath(pack.id)}
						/>
						<dl className="pack-publish__listing">
							<dt>Library</dt>
							<dd>
								{listing.name} · {iconCount(pack.count)}
							</dd>
							<dt>Description</dt>
							<dd>{listing.description}</dd>
						</dl>
						<label className="pack-publish__field">
							Your name
							<input
								autoComplete="name"
								maxLength={AUTHOR_NAME_MAX_LENGTH}
								name="authorName"
								required
							/>
						</label>
						<label className="pack-publish__field">
							X handle (optional)
							<input
								name="xHandle"
								onBlur={(event) => showHandle(event.currentTarget, event.currentTarget.value)}
								onPaste={pasteHandle}
								spellCheck={false}
							/>
						</label>
						<label className="pack-publish__field">
							Website (optional)
							<input
								defaultValue={website}
								maxLength={WEBSITE_MAX_LENGTH}
								name="website"
								type="url"
							/>
						</label>
						{status.kind === "editing" && status.error ? (
							<p className="pack-publish__error" role="alert">
								{status.error}
							</p>
						) : null}
						<button
							className="pack-publish__submit"
							disabled={status.kind === "sending"}
							type="submit"
						>
							{status.kind === "sending" ? "Publishing…" : "Publish"}
						</button>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
