import { Effect, Layer } from "effect";

import { Clipboard, type ClipboardOutcome } from "../clipboard.js";

/** A clipboard that records copies instead of touching the desktop. */
export function makeFakeClipboard(outcome: ClipboardOutcome = { _tag: "Copied" }) {
	const copies: Uint8Array[] = [];
	return {
		copies,
		layer: Layer.succeed(Clipboard, {
			copyPng: (png) =>
				Effect.sync(() => {
					copies.push(png);
					return outcome;
				}),
		}),
	};
}
