import { publishPack } from "./publication-client.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@sketchi/ui/components/dialog";
import { useState, type ClipboardEvent, type FormEvent } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { queryError, queryRuntime } from "../../lib/query-atoms.js";

import {
	AUTHOR_NAME_MAX_LENGTH,
	parseXHandle,
	type PublishResult,
	WEBSITE_MAX_LENGTH,
} from "./publication.js";
import { findPack, packPreviewImagePath, type PackSummary } from "../../lib/packs.js";
import { AddToExcalidrawLink, PullRequestLink } from "./pack-actions.js";
import { iconCount } from "./pack-shelf.js";

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
	const [submission] = useState(() =>
		queryRuntime
			.fn(
				Effect.fn("Icons.packs.submit")(function* (form: FormData) {
					const result = yield* publishPack(pack.id, form);
					onPublished(result);
					return result;
				}),
			)
			.pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial),
	);
	const status = useAtomValue(submission);
	const submitForm = useAtomSet(submission);
	const listing = findPack(pack.id)?.excalidrawListing;
	if (!listing) return null;
	const website = `https://icons.sketchi.app/packs/${pack.id}`;

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		submitForm(new FormData(event.currentTarget));
	};

	return (
		<Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogTitle>Publish to Excalidraw</DialogTitle>
				{AsyncResult.isSuccess(status) ? (
					<div className="pack-publish">
						<DialogDescription>{listing.name} is submitted.</DialogDescription>
						<div className="pack-actions" data-size="large">
							{status.value.installUrl ? (
								<AddToExcalidrawLink
									className="pack-actions__primary"
									href={status.value.installUrl}
								/>
							) : null}
							<PullRequestLink pullRequest={{ url: status.value.pullRequestUrl, state: "open" }} />
						</div>
					</div>
				) : (
					<form className="pack-publish" onSubmit={(event) => submit(event)}>
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
						{AsyncResult.isFailure(status) ? (
							<p className="pack-publish__error" role="alert">
								{queryError(status, "Publishing failed.")}
							</p>
						) : null}
						<button className="pack-publish__submit" disabled={status.waiting} type="submit">
							{status.waiting ? "Publishing…" : "Publish"}
						</button>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
