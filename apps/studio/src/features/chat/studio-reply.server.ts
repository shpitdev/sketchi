import "@tanstack/react-start/server-only";
import type { BuildIssue } from "@sketchi/diagrams/build/contract";
import { Effect, Stream } from "effect";
import { Response } from "effect/ai";
import type { StudioTurnOutcome } from "./studio-build-tool.server";

export const STUDIO_RAN_OUT_REPLY =
	"I ran out of room before I could finish this diagram. Try again, or ask for a smaller diagram.";

/** The reply when every build this turn was rejected: what the last rejection says. */
export function studioRejectedReply(issues: readonly BuildIssue[]): string {
	const reasons = [...new Set(issues.map((issue) => issue.message.trim()).filter(Boolean))];
	const shown = reasons.slice(0, 3).join(" ");
	return `I couldn't save a diagram for this request.${shown ? ` The last attempt was rejected: ${shown}` : ""}${reasons.length > 3 ? ` (${reasons.length - 3} more issues.)` : ""} Try simplifying or rephrasing the request.`;
}

function textParts(text: string): Response.AnyPart[] {
	// @effect-diagnostics-next-line cryptoRandomUUID:off -- The synchronous AG-UI reply boundary supplies a unique message id.
	const id = crypto.randomUUID();
	return [
		Response.makePart("text-start", { id }),
		Response.makePart("text-delta", { id, delta: text }),
		Response.makePart("text-end", { id }),
	];
}
/** Studio policy over the native Chat loop. Chat alone owns history and tool rounds. */
export function studioReplyStream<E, R>(options: {
	readonly run: () => Stream.Stream<Response.AnyPart, E, R>;
	readonly outcome: Effect.Effect<StudioTurnOutcome>;
}): Stream.Stream<Response.AnyPart, E, R> {
	return Stream.suspend(() => {
		let told = false;
		let ranOut = false;
		const relay = () =>
			Stream.suspend(() => {
				let held: Response.AnyPart[] = [];
				let text = "";
				let calledTool = false;
				return options.run().pipe(
					Stream.mapEffect((part) =>
						Effect.gen(function* () {
							if (
								part.type === "text-start" ||
								part.type === "text-delta" ||
								part.type === "text-end"
							) {
								held.push(part);
								if (part.type === "text-delta") text += part.delta;
								return [];
							}
							if (part.type === "tool-call") calledTool = true;
							if (part.type !== "finish") return [part];
							ranOut = part.reason === "length" && !calledTool && text.trim() === "";
							const turn = yield* options.outcome;
							const reject = !calledTool && held.length > 0 && turn.attempts > 0 && !turn.saved;
							const incomplete =
								part.reason === "length" && !calledTool && !turn.saved && text.trim() !== "";
							const reply = reject
								? studioRejectedReply(turn.rejected)
								: incomplete
									? STUDIO_RAN_OUT_REPLY
									: undefined;
							const released = reply ? textParts(reply) : held;
							told ||= reply !== undefined;
							held = [];
							text = "";
							calledTool = false;
							return [...released, part];
						}),
					),
					Stream.flattenIterable,
				);
			});
		return relay().pipe(
			Stream.concat(Stream.suspend(() => (ranOut ? relay() : Stream.empty))),
			Stream.concat(
				Stream.unwrap(
					Effect.map(options.outcome, (turn) => {
						const closing =
							turn.attempts > 0 && !turn.saved && !told
								? studioRejectedReply(turn.rejected)
								: ranOut && !turn.saved
									? STUDIO_RAN_OUT_REPLY
									: undefined;
						return closing ? Stream.fromIterable(textParts(closing)) : Stream.empty;
					}),
				),
			),
		);
	});
}
