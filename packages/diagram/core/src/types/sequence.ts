import { Effect, Schema } from "effect";

import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

export const sequenceDiagramType = "sequence" as const;

/** A call ("message") or a response to an earlier call ("return"). */
export const SEQUENCE_MESSAGE_TYPES = ["message", "return"] as const;
export const SEQUENCE_MESSAGE_STYLES = ["solid", "dashed"] as const;

/** Lifelines are addressed as `<participant id>:lifeline` in rendered scenes. */
export const SEQUENCE_LIFELINE_SUFFIX = ":lifeline";

export function sequenceLifelineId(participantId: string): string {
	return `${participantId}${SEQUENCE_LIFELINE_SUFFIX}`;
}

/** Activation bars sit on their participant's lifeline, keyed by the call that opens them. */
export function sequenceActivationId(participantId: string, callMessageId: string): string {
	return `${sequenceLifelineId(participantId)}:activation:${callMessageId}`;
}

/** Wider or longer diagrams stop reading as one sequence; split them instead. */
export const SEQUENCE_MAX_PARTICIPANTS = 12;
export const SEQUENCE_MAX_MESSAGES = 40;
export const SEQUENCE_MAX_ISSUES = 20;

export const SequenceMessageTypeSchema = Schema.Literals(SEQUENCE_MESSAGE_TYPES);
export const SequenceMessageStyleSchema = Schema.Literals(SEQUENCE_MESSAGE_STYLES);
export type SequenceMessageType = typeof SequenceMessageTypeSchema.Type;
export type SequenceMessageStyle = typeof SequenceMessageStyleSchema.Type;

export class SequenceParticipant extends Schema.Class<SequenceParticipant>("SequenceParticipant")({
	id: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	kind: Schema.optionalKey(Schema.NonEmptyString),
}) {}
export const SequenceParticipantSchema = SequenceParticipant;

/** One message row. Array order is chronological order. */
export class SequenceMessage extends Schema.Class<SequenceMessage>("SequenceMessage")({
	id: Schema.NonEmptyString,
	source: Schema.NonEmptyString,
	target: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	type: Schema.optionalKey(SequenceMessageTypeSchema),
	style: Schema.optionalKey(SequenceMessageStyleSchema),
}) {}
export const SequenceMessageSchema = SequenceMessage;

/**
 * The canonical sequence diagram: ordered participants (left to right) and
 * chronologically ordered messages between their lifelines. Every surface that
 * accepts, generates, renders, or evaluates a sequence diagram uses this shape.
 */
export class SequenceDiagram extends Schema.Class<SequenceDiagram>("SequenceDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(sequenceDiagramType),
	participants: Schema.Array(SequenceParticipant).pipe(
		Schema.mutable,
		Schema.check(Schema.isMinLength(1)),
	),
	messages: Schema.Array(SequenceMessage).pipe(
		Schema.mutable,
		Schema.withDecodingDefault(Effect.succeed([])),
	),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const SequenceDiagramSchema = SequenceDiagram;

export const SequenceValidationIssueCodeSchema = Schema.Literals([
	"sequence_too_large",
	"duplicate_participant_id",
	"lifeline_id_collision",
	"duplicate_message_id",
	"missing_message_source",
	"missing_message_target",
	"self_message",
]);
export type SequenceValidationIssueCode = typeof SequenceValidationIssueCodeSchema.Type;

export class SequenceValidationIssue extends Schema.Class<SequenceValidationIssue>(
	"SequenceValidationIssue",
)({
	code: SequenceValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `participants.[1].id`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}) {}

export function getSequenceValidationIssues(diagram: SequenceDiagram): SequenceValidationIssue[] {
	const issues: SequenceValidationIssue[] = [];
	if (diagram.participants.length > SEQUENCE_MAX_PARTICIPANTS) {
		issues.push({
			code: "sequence_too_large",
			path: "participants",
			message: `Sequence diagram has ${diagram.participants.length} participants; the supported maximum is ${SEQUENCE_MAX_PARTICIPANTS}.`,
			hint: "Combine minor actors or split the interaction into several diagrams.",
		});
	}
	if (diagram.messages.length > SEQUENCE_MAX_MESSAGES) {
		issues.push({
			code: "sequence_too_large",
			path: "messages",
			message: `Sequence diagram has ${diagram.messages.length} messages; the supported maximum is ${SEQUENCE_MAX_MESSAGES}.`,
			hint: "Split the interaction into phases or drop lower-signal messages.",
		});
	}
	const participantIndexById = new Map<string, number>();
	diagram.participants.forEach((participant, index) => {
		if (participantIndexById.has(participant.id)) {
			issues.push({
				code: "duplicate_participant_id",
				path: `participants.[${index}].id`,
				message: `Participant id "${participant.id}" is duplicated.`,
				hint: "Give every participant a unique stable id and update message references.",
			});
			return;
		}
		participantIndexById.set(participant.id, index);
	});

	// Lifelines and their activation bars are addressed under `<id>:lifeline`.
	for (const participant of diagram.participants) {
		const lifelineId = sequenceLifelineId(participant.id);
		diagram.participants.forEach((candidate, collisionIndex) => {
			if (candidate.id !== lifelineId && !candidate.id.startsWith(`${lifelineId}:`)) return;
			issues.push({
				code: "lifeline_id_collision",
				path: `participants.[${collisionIndex}].id`,
				message: `Participant id "${candidate.id}" collides with the generated lifeline for "${participant.id}".`,
				hint: `Rename the participant so its id does not start with another participant id followed by ${SEQUENCE_LIFELINE_SUFFIX}.`,
			});
		});
	}

	const messageIds = new Set<string>();
	diagram.messages.forEach((message, index) => {
		if (messageIds.has(message.id)) {
			issues.push({
				code: "duplicate_message_id",
				path: `messages.[${index}].id`,
				message: `Message id "${message.id}" is duplicated.`,
				hint: "Give every message a unique id or omit message ids to generate them deterministically.",
			});
		}
		messageIds.add(message.id);
		if (!participantIndexById.has(message.source)) {
			issues.push({
				code: "missing_message_source",
				path: `messages.[${index}].source`,
				message: `Message source "${message.source}" is not a participant.`,
				hint: "Use the id of a participant declared in participants.",
			});
		}
		if (!participantIndexById.has(message.target)) {
			issues.push({
				code: "missing_message_target",
				path: `messages.[${index}].target`,
				message: `Message target "${message.target}" is not a participant.`,
				hint: "Use the id of a participant declared in participants.",
			});
		}
		if (message.source === message.target) {
			issues.push({
				code: "self_message",
				path: `messages.[${index}]`,
				message: `Message "${message.id}" is self-referential.`,
				hint: "Choose a different target participant; self messages are not supported.",
			});
		}
	});
	return issues.slice(0, SEQUENCE_MAX_ISSUES);
}

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
 */
export function sequenceActivations(diagram: SequenceDiagram): SequenceActivation[] {
	const open = new Map<string, { caller: string; index: number; messageId: string }[]>();
	const spans: Omit<SequenceActivation, "depth">[] = [];
	diagram.messages.forEach((message, index) => {
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

export class SequenceValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly SequenceValidationIssue[]) {
		super(issues[0]?.message ?? "Sequence diagram failed semantic validation.");
		this.name = "SequenceValidationError";
	}
}

export function validateSequenceDiagram(diagram: SequenceDiagram): SequenceDiagram {
	const issues = getSequenceValidationIssues(diagram);
	if (issues.length > 0) {
		throw new SequenceValidationError(issues);
	}
	return diagram;
}

export function parseSequenceDiagram(input: unknown): SequenceDiagram {
	return validateSequenceDiagram(
		Schema.decodeUnknownSync(SequenceDiagram, { errors: "all" })(input),
	);
}

export const sequenceFixture = parseSequenceDiagram({
	id: "checkout-sequence",
	title: "Checkout sequence",
	type: sequenceDiagramType,
	participants: [
		{ id: "customer", label: "Customer" },
		{ id: "store", label: "Store" },
		{ id: "payments", label: "Payments" },
	],
	messages: [
		{ id: "checkout", source: "customer", target: "store", label: "Submit checkout" },
		{ id: "charge", source: "store", target: "payments", label: "Charge card" },
		{
			id: "charged",
			source: "payments",
			target: "store",
			label: "Payment approved",
			type: "return",
		},
		{
			id: "receipt",
			source: "store",
			target: "customer",
			label: "Order receipt",
			type: "return",
		},
	],
});

/** A request path with a nested call, a fire-and-forget event, and returns. */
export const apiRequestSequence = parseSequenceDiagram({
	id: "api-request-sequence",
	title: "API request with cache miss",
	type: sequenceDiagramType,
	participants: [
		{ id: "browser", label: "Browser" },
		{ id: "api", label: "API Worker" },
		{ id: "cache", label: "Cache" },
		{ id: "database", label: "Database" },
		{ id: "analytics", label: "Analytics" },
	],
	messages: [
		{ id: "request", source: "browser", target: "api", label: "GET /orders" },
		{ id: "lookup", source: "api", target: "cache", label: "Look up orders" },
		{ id: "miss", source: "cache", target: "api", label: "Cache miss", type: "return" },
		{ id: "query", source: "api", target: "database", label: "Query orders" },
		{ id: "rows", source: "database", target: "api", label: "Order rows", type: "return" },
		{ id: "track", source: "api", target: "analytics", label: "Track request" },
		{ id: "response", source: "api", target: "browser", label: "200 OK", type: "return" },
	],
});
