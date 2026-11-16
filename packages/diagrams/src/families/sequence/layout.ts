import { type SequenceDiagram } from "./document";

/**
 * A participant's active period: from a call it receives to its return to the
 * caller. Spans are derived from message order, never authored, and stack when
 * the participant is called again before it returns: `depth` is the lowest
 * lane no overlapping span on the same lifeline uses, so overlapping spans
 * never share a depth and nested spans keep their nesting order.
 */
export interface SequenceActivation {
	readonly participantId: string;
	readonly callMessageId: string;
	readonly returnMessageId: string;
	/** Index of the call in `messages`. */
	readonly startIndex: number;
	/** Index of the matching return in `messages`. */
	readonly endIndex: number;
	readonly depth: number;
}

/**
 * Pair each return with the latest unanswered call from its target to its
 * source. Calls nobody answers (fire-and-forget) and returns without an open
 * call open no span; answering one call leaves every other open call open.
 * Self-messages take no part: they neither open a call nor answer one.
 */
export function sequenceActivations(diagram: SequenceDiagram): SequenceActivation[] {
	const open = new Map<string, { caller: string; index: number; messageId: string }[]>();
	const spans: Omit<SequenceActivation, "depth">[] = [];
	diagram.messages.forEach((message, index) => {
		if (message.source === message.target) return;
		if (message.type !== "return") {
			open.set(message.target, [
				...(open.get(message.target) ?? []),
				{ caller: message.source, index, messageId: message.id },
			]);
			return;
		}
		const calls = open.get(message.source) ?? [];
		const matched = calls.findLastIndex((call) => call.caller === message.target);
		const call = calls[matched];
		if (!call) return;
		// Other calls stay open, even when they interleave with this one.
		open.set(
			message.source,
			calls.filter((_, callIndex) => callIndex !== matched),
		);
		spans.push({
			participantId: message.source,
			callMessageId: call.messageId,
			returnMessageId: message.id,
			startIndex: call.index,
			endIndex: index,
		});
	});
	// Interval lane assignment. In start order, each span takes the lowest depth
	// that no still-open span on its lifeline holds and that sits above every
	// span enclosing it, so overlapping spans never share a depth and nested
	// spans always draw inside their enclosing span.
	const laid: SequenceActivation[] = [];
	for (const span of spans.toSorted((left, right) => left.startIndex - right.startIndex)) {
		const open = laid.filter(
			(other) => other.participantId === span.participantId && other.endIndex > span.startIndex,
		);
		const taken = new Set(open.map((other) => other.depth));
		let depth = Math.max(
			0,
			...open.filter((other) => other.endIndex > span.endIndex).map((other) => other.depth + 1),
		);
		while (taken.has(depth)) depth += 1;
		laid.push({ ...span, depth });
	}
	return laid;
}
