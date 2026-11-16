import "@tanstack/react-start/server-only";
import type { OpenAiSchema } from "@effect/ai-openai";
import { Result, Schema, Stream } from "effect";

type Event = OpenAiSchema.ResponseStreamEvent;
const json = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));
function isEvent<T extends Event["type"]>(
	event: Event,
	type: T,
): event is Extract<Event, { readonly type: T }> {
	return event.type === type;
}

/**
 * Effect OpenAI 4.1.4 parses function arguments before response.incomplete arrives.
 * Hold the suffix from a malformed argument completion until the terminal event
 * establishes max_output_tokens. Partial previews and valid calls keep streaming.
 * All other finishes (and EOF) replay the malformed events to the native parser.
 * This adapter does not retry: Studio's reply policy owns the single empty-length retry.
 */
export function preserveOutputLimit<E, R>(source: Stream.Stream<Event, E, R>) {
	return Stream.suspend(() => {
		let pending: Event[] = [];
		const flush = () => {
			const events = pending;
			pending = [];
			return events;
		};
		const malformed = (event: Event) => {
			const args = isEvent(event, "response.function_call_arguments.done")
				? event.arguments
				: isEvent(event, "response.output_item.done") && event.item.type === "function_call"
					? event.item.arguments
					: undefined;
			return args !== undefined && Result.isFailure(json(args));
		};
		return source.pipe(
			Stream.map((event): Event[] => {
				if (
					isEvent(event, "response.incomplete") &&
					event.response.incomplete_details?.reason === "max_output_tokens"
				)
					return [...flush().filter((held) => !malformed(held)), event];
				if (
					isEvent(event, "response.completed") ||
					isEvent(event, "response.incomplete") ||
					isEvent(event, "response.failed")
				)
					return [...flush(), event];
				if (pending.length > 0 || malformed(event)) {
					pending.push(event);
					return [];
				}
				return [event];
			}),
			Stream.flattenIterable,
			Stream.concat(Stream.suspend(() => Stream.fromIterable(flush()))),
		);
	});
}
