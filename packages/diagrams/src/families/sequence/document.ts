import { cleanToolString, slug } from "../../clean-text";
import {
	Effect,
	Schema,
	Array as Arr,
	String as Str,
	MutableHashSet as Set,
	Option,
	Result,
} from "effect";

import {
	DiagramIconRef,
	DiagramStyle,
	DrawnIconSchema,
	SKETCHI_DIAGRAM_STYLE,
} from "@sketchi/drawing";

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
// Forty request-and-reply exchanges; 80 messages draw in one readable column.
export const SEQUENCE_MAX_MESSAGES = 80;
export const SEQUENCE_MAX_ISSUES = 20;

export const SequenceMessageTypeSchema = Schema.Literals(SEQUENCE_MESSAGE_TYPES);
export const SequenceMessageStyleSchema = Schema.Literals(SEQUENCE_MESSAGE_STYLES);
export type SequenceMessageType = typeof SequenceMessageTypeSchema.Type;
export type SequenceMessageStyle = typeof SequenceMessageStyleSchema.Type;

const ParticipantDocument = Schema.Struct({
	id: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	kind: Schema.optionalKey(Schema.NonEmptyString),
	/** The participant's logo, drawn in its header; shared with flowchart nodes. */
	icon: Schema.optionalKey(
		Schema.Struct({
			slug: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(128))),
			...DrawnIconSchema.fields,
		}),
	),
}).annotate({ identifier: "SequenceParticipant" });

export const SequenceParticipant = ParticipantDocument.mapFields((fields) => ({
	...fields,
	icon: Schema.optionalKey(DiagramIconRef),
}));

export interface SequenceParticipant extends Schema.Schema.Type<typeof SequenceParticipant> {}

/**
 * One message row. Array order is chronological order. A message whose source
 * is its target is a self-message: the participant acting on itself.
 */
const MessageDocument = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	source: Schema.NonEmptyString,
	target: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	type: Schema.optionalKey(SequenceMessageTypeSchema),
	style: Schema.optionalKey(SequenceMessageStyleSchema),
}).annotate({ identifier: "SequenceMessage" });

export const SequenceMessage = MessageDocument.mapFields((fields) => ({
	...fields,
	id: Schema.NonEmptyString,
}));

export interface SequenceMessage extends Schema.Schema.Type<typeof SequenceMessage> {}

/**
 * The canonical sequence diagram: ordered participants (left to right) and
 * chronologically ordered messages between their lifelines. Every surface that
 * accepts, generates, renders, or evaluates a sequence diagram uses this shape.
 */
export const SequenceDocument = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	title: Schema.NonEmptyString,
	participants: Schema.Array(ParticipantDocument).pipe(Schema.mutable).check(Schema.isMinLength(1)),
	messages: Schema.Array(MessageDocument).pipe(
		Schema.mutable,
		Schema.withDecodingDefaultKey(Effect.succeed([])),
	),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
});
export interface SequenceDocument extends Schema.Schema.Type<typeof SequenceDocument> {}
export const SequenceDiagram = SequenceDocument.mapFields((fields) => ({
	...fields,
	id: Schema.NonEmptyString,
	type: Schema.Literal(sequenceDiagramType),
	participants: Schema.Array(SequenceParticipant).pipe(Schema.mutable).check(Schema.isMinLength(1)),
	messages: Schema.Array(SequenceMessage).pipe(
		Schema.mutable,
		Schema.withDecodingDefaultKey(Effect.succeed([])),
	),
})).annotate({ identifier: "SequenceDiagram" });

/** Normalize authoring once; catalog resolution belongs to the build's icon capability. */
export function normalizeSequence(document: SequenceDocument) {
	const optional = (value: string | undefined) =>
		value === undefined ? undefined : cleanToolString(value) || undefined;
	const title = cleanToolString(document.title);
	return {
		id: optional(document.id) ?? (slug(title) || "sketchi-sequence"),
		title,
		type: sequenceDiagramType,
		participants: Arr.map(document.participants, (participant) => ({
			id: cleanToolString(participant.id),
			label: cleanToolString(participant.label),
			...(participant.kind ? { kind: cleanToolString(participant.kind) } : {}),
			...(participant.icon?.slug ? { icon: { slug: participant.icon.slug } } : {}),
		})),
		messages: Arr.map(document.messages, (message, index) => ({
			...message,
			id:
				optional(message.id) ??
				`message-${index + 1}-${slug(message.source)}-${slug(message.target)}`,
			source: cleanToolString(message.source),
			target: cleanToolString(message.target),
			label: cleanToolString(message.label),
		})),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

export interface SequenceDiagram extends Schema.Schema.Type<typeof SequenceDiagram> {}

export const SequenceValidationIssueCodeSchema = Schema.Literals([
	"sequence_too_large",
	"duplicate_participant_id",
	"lifeline_id_collision",
	"duplicate_message_id",
	"missing_message_source",
	"missing_message_target",
]);
export type SequenceValidationIssueCode = typeof SequenceValidationIssueCodeSchema.Type;

export const SequenceValidationIssue = Schema.Struct({
	code: SequenceValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `participants.[1].id`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}).annotate({ identifier: "SequenceValidationIssue" });

export interface SequenceValidationIssue extends Schema.Schema.Type<
	typeof SequenceValidationIssue
> {}

export function getSequenceValidationIssues(
	diagram: Pick<SequenceDiagram, "participants" | "messages">,
): SequenceValidationIssue[] {
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
	const participants = Set.empty<string>();
	Arr.forEach(diagram.participants, (participant, index) => {
		if (Set.has(participants, participant.id)) {
			issues.push({
				code: "duplicate_participant_id",
				path: `participants.[${index}].id`,
				message: `Participant id "${participant.id}" is duplicated.`,
				hint: "Give every participant a unique stable id and update message references.",
			});
			return;
		}
		Set.add(participants, participant.id);
	});

	// Lifelines and their activation bars are addressed under `<id>:lifeline`.
	for (const participant of diagram.participants) {
		const lifelineId = sequenceLifelineId(participant.id);
		Arr.forEach(diagram.participants, (candidate, collisionIndex) => {
			if (candidate.id !== lifelineId && !Str.startsWith(`${lifelineId}:`)(candidate.id)) return;
			issues.push({
				code: "lifeline_id_collision",
				path: `participants.[${collisionIndex}].id`,
				message: `Participant id "${candidate.id}" collides with the generated lifeline for "${participant.id}".`,
				hint: `Rename the participant so its id does not start with another participant id followed by ${SEQUENCE_LIFELINE_SUFFIX}.`,
			});
		});
	}

	const messageIds = Set.empty<string>();
	Arr.forEach(diagram.messages, (message, index) => {
		if (Set.has(messageIds, message.id)) {
			issues.push({
				code: "duplicate_message_id",
				path: `messages.[${index}].id`,
				message: `Message id "${message.id}" is duplicated.`,
				hint: "Give every message a unique id or omit message ids to generate them deterministically.",
			});
		}
		Set.add(messageIds, message.id);
		if (!Set.has(participants, message.source)) {
			issues.push({
				code: "missing_message_source",
				path: `messages.[${index}].source`,
				message: `Message source "${message.source}" is not a participant.`,
				hint: "Use the id of a participant declared in participants.",
			});
		}
		if (!Set.has(participants, message.target)) {
			issues.push({
				code: "missing_message_target",
				path: `messages.[${index}].target`,
				message: `Message target "${message.target}" is not a participant.`,
				hint: "Use the id of a participant declared in participants.",
			});
		}
	});
	return Arr.take(issues, SEQUENCE_MAX_ISSUES);
}

export class SequenceValidationError extends Schema.TaggedError<
	SequenceValidationError,
	{ readonly brand: unique symbol }
>()("SequenceValidationError", {
	message: Schema.String,
	issues: Schema.Array(SequenceValidationIssue),
}) {
	static fromIssues(issues: readonly SequenceValidationIssue[]): SequenceValidationError {
		return SequenceValidationError.make({
			issues,
			message: Option.match(Arr.head(issues), {
				onNone: () => "Sequence diagram failed semantic validation.",
				onSome: (issue) => issue.message,
			}),
		});
	}
}

export function validateSequenceDiagram(
	diagram: SequenceDiagram,
): Result.Result<SequenceDiagram, SequenceValidationError> {
	const issues = getSequenceValidationIssues(diagram);
	return issues.length > 0
		? Result.fail(SequenceValidationError.fromIssues(issues))
		: Result.succeed(diagram);
}

export function parseSequenceDiagram(
	input: unknown,
): Result.Result<SequenceDiagram, Schema.SchemaError | SequenceValidationError> {
	return Result.flatMap(
		Schema.decodeUnknownResult(SequenceDiagram, { errors: "all" })(input),
		validateSequenceDiagram,
	);
}

/** Counts and domain nouns shown by generation consumers. */
export function counts(diagram: SequenceDiagram) {
	return {
		nodeCount: diagram.participants.length,
		nodeNoun: "participants",
		edgeCount: diagram.messages.length,
		edgeNoun: "messages",
	};
}
