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

	for (const participant of diagram.participants) {
		const lifelineId = sequenceLifelineId(participant.id);
		const collisionIndex = participantIndexById.get(lifelineId);
		if (collisionIndex !== undefined) {
			issues.push({
				code: "lifeline_id_collision",
				path: `participants.[${collisionIndex}].id`,
				message: `Participant id "${lifelineId}" collides with the generated lifeline for "${participant.id}".`,
				hint: `Rename the participant so its id does not equal another participant id followed by ${SEQUENCE_LIFELINE_SUFFIX}.`,
			});
		}
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
	return issues;
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
