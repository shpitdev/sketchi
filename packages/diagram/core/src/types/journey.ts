import { Effect, Schema } from "effect";

import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

export const journeyDiagramType = "journey" as const;

/** Sentiment is a whole number from 1 (very negative) to 5 (very positive); 3 is neutral. */
export const JOURNEY_MIN_SCORE = 1;
export const JOURNEY_MAX_SCORE = 5;
export const JOURNEY_NEUTRAL_SCORE = 3;
/** Longer journeys stop reading as one map; split them into journeys of their own. */
export const JOURNEY_MAX_STAGES = 10;
export const JOURNEY_MAX_STEPS = 40;
export const JOURNEY_MAX_STAGE_STEPS = 8;
/** Pain points, and opportunities, per stage. */
export const JOURNEY_MAX_NOTES = 4;
export const JOURNEY_MAX_ACTORS = 8;
export const JOURNEY_MAX_LABEL_LENGTH = 90;
export const JOURNEY_MAX_STAGE_LENGTH = 40;
export const JOURNEY_MAX_NOTE_LENGTH = 100;
/** An actor's or touchpoint's name. */
export const JOURNEY_MAX_NAME_LENGTH = 32;
export const JOURNEY_MAX_PERSONA_LENGTH = 80;
export const JOURNEY_MAX_ISSUES = 20;

const SENTIMENTS = ["Very negative", "Negative", "Neutral", "Positive", "Very positive"] as const;

/** What a score means: 1 very negative, 3 neutral, 5 very positive. */
export function journeySentiment(score: number): (typeof SENTIMENTS)[number] {
	const index = Math.round(score) - JOURNEY_MIN_SCORE;
	return SENTIMENTS[Math.min(SENTIMENTS.length - 1, Math.max(0, index))]!;
}

/**
 * One thing the persona does or experiences, drawn as a card under its stage,
 * with a face on the experience curve at its score. Never coordinates.
 */
export class JourneyStep extends Schema.Class<JourneyStep>("JourneyStep")({
	label: Schema.NonEmptyString,
	/** A whole number from 1 (very negative) to 5 (very positive); 3 is neutral. */
	score: Schema.Finite,
	/** Who acts, when the journey has more than its persona. */
	actor: Schema.optionalKey(Schema.NonEmptyString),
	/** Where it happens: the channel or touchpoint, such as Website, Email or Phone. */
	touchpoint: Schema.optionalKey(Schema.NonEmptyString),
}) {}
export const JourneyStepSchema = JourneyStep;

/** A column of the map: its steps in order, and the pain points and opportunities found there. */
export class JourneyStage extends Schema.Class<JourneyStage>("JourneyStage")({
	name: Schema.NonEmptyString,
	steps: Schema.Array(JourneyStep).pipe(Schema.mutable),
	painPoints: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable)),
	opportunities: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable)),
}) {}
export const JourneyStageSchema = JourneyStage;

/**
 * The canonical user journey map: ordered stages of ordered steps, each scored
 * for sentiment, with optional pain points and opportunities per stage. The
 * renderer owns every coordinate. Every surface that accepts, generates,
 * renders or evaluates a journey map uses this shape.
 */
export class JourneyDiagram extends Schema.Class<JourneyDiagram>("JourneyDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(journeyDiagramType),
	/** Whose journey it is, such as "Maya, a first-time buyer". */
	persona: Schema.optionalKey(Schema.NonEmptyString),
	/** The people and systems that act, in the order a legend lists them. */
	actors: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable)),
	stages: Schema.Array(JourneyStage).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const JourneyDiagramSchema = JourneyDiagram;

export const JourneyValidationIssueCodeSchema = Schema.Literals([
	"journey_too_large",
	"empty_journey_stage",
	"duplicate_journey_stage",
	"invalid_journey_score",
	"unknown_journey_actor",
	"duplicate_journey_actor",
	"journey_text_too_long",
	"unplaced_journey_entry",
]);
export type JourneyValidationIssueCode = typeof JourneyValidationIssueCodeSchema.Type;

export class JourneyValidationIssue extends Schema.Class<JourneyValidationIssue>(
	"JourneyValidationIssue",
)({
	code: JourneyValidationIssueCodeSchema,
	/** Dotted path into the diagram, for example `stages.[1].steps.[0].score`. */
	path: Schema.NonEmptyString,
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}) {}

const sameName = (name: string) => name.trim().toLocaleLowerCase();

/** The actors a journey names: its declared list, or every step's actor in first-use order. */
/**
 * The actors of one step: a step several actors share names them all,
 * "Customer, Agent". A declared actor whose own name holds a comma stays whole.
 */
export function journeyStepActors(actor: string, declared: readonly string[] = []): string[] {
	const parts = actor.split(",");
	const actors: string[] = [];
	// Each actor is the longest run of comma-separated parts that names a declared actor
	// ("Smith, Jane"), or a single part when none does.
	for (let start = 0; start < parts.length;) {
		let end = parts.length;
		while (
			end > start + 1 &&
			!declared.some((known) => sameName(known) === sameName(parts.slice(start, end).join(",")))
		)
			end -= 1;
		const name = parts.slice(start, end).join(",").trim();
		if (name.length > 0) actors.push(name);
		start = end;
	}
	return actors;
}

/** The actors a journey names: its declared list, or every step's actors in first-use order. */
export function journeyActors(diagram: Pick<JourneyDiagram, "actors" | "stages">): string[] {
	if (diagram.actors !== undefined) return diagram.actors.map((actor) => actor.trim());
	const actors: string[] = [];
	for (const stage of diagram.stages)
		for (const step of stage.steps)
			for (const actor of journeyStepActors(step.actor ?? ""))
				if (!actors.some((known) => sameName(known) === sameName(actor))) actors.push(actor);
	return actors;
}

/** The stage a pain point or opportunity written apart from every stage, and naming none, lands in. */
export const JOURNEY_UNPLACED_STAGE = "(no stage)";

export function getJourneyValidationIssues(diagram: JourneyDiagram): JourneyValidationIssue[] {
	const issues: JourneyValidationIssue[] = [];
	const push = (code: JourneyValidationIssueCode, path: string, message: string, hint: string) =>
		issues.push({ code, path, message, hint });
	const long = (path: string, what: string, value: string | undefined, limit: number) => {
		if (value !== undefined && value.trim().length > limit)
			push(
				"journey_text_too_long",
				path,
				`${what} is longer than ${limit} characters.`,
				`Shorten it to at most ${limit} characters; keep the words the source uses.`,
			);
	};
	const { stages } = diagram;
	if (stages.length > JOURNEY_MAX_STAGES)
		push(
			"journey_too_large",
			"stages",
			`A journey map holds at most ${JOURNEY_MAX_STAGES} stages; this one has ${stages.length}.`,
			"Merge neighboring stages, or split the journey into maps of their own.",
		);
	const steps = stages.reduce((total, stage) => total + stage.steps.length, 0);
	if (steps > JOURNEY_MAX_STEPS)
		push(
			"journey_too_large",
			"stages",
			`A journey map holds at most ${JOURNEY_MAX_STEPS} steps; this one has ${steps}.`,
			"Keep the steps the source states, or split the journey into maps of their own.",
		);
	long("persona", "The persona", diagram.persona, JOURNEY_MAX_PERSONA_LENGTH);
	const actors = diagram.actors;
	if (actors !== undefined) {
		if (actors.length > JOURNEY_MAX_ACTORS)
			push(
				"journey_too_large",
				"actors",
				`A journey map names at most ${JOURNEY_MAX_ACTORS} actors; this one has ${actors.length}.`,
				"Keep the actors the source names.",
			);
		const seen = new Set<string>();
		actors.forEach((actor, index) => {
			if (seen.has(sameName(actor)))
				push(
					"duplicate_journey_actor",
					`actors.[${index}]`,
					`Actor "${actor.trim()}" is listed more than once.`,
					"List each actor once.",
				);
			seen.add(sameName(actor));
			long(`actors.[${index}]`, `Actor "${actor.trim()}"`, actor, JOURNEY_MAX_NAME_LENGTH);
		});
	}
	const known = new Set((actors ?? []).map(sameName));
	const names = new Set<string>();
	stages.forEach((stage, stageIndex) => {
		const path = `stages.[${stageIndex}]`;
		const name = stage.name.trim();
		if (names.has(sameName(name)))
			push(
				"duplicate_journey_stage",
				`${path}.name`,
				`Stage "${name}" appears more than once.`,
				"Give each stage one entry and put all its steps there, in order.",
			);
		names.add(sameName(name));
		long(`${path}.name`, `Stage "${name}"`, stage.name, JOURNEY_MAX_STAGE_LENGTH);
		const notes = (stage.painPoints?.length ?? 0) + (stage.opportunities?.length ?? 0);
		const placed = stages
			.filter((other) => other.steps.length > 0 && other.name !== JOURNEY_UNPLACED_STAGE)
			.map((other) => `"${other.name.trim()}"`)
			.join(", ");
		if (name === JOURNEY_UNPLACED_STAGE)
			// Steps or notes written apart from the stages that name none.
			push(
				"unplaced_journey_entry",
				path,
				stage.steps.length + notes === 1
					? "A step or note names no stage."
					: `${stage.steps.length + notes} steps or notes name no stage.`,
				placed.length > 0
					? `Give each its stage, one of ${placed}, or list it under that stage.`
					: "Give each step its stage, or list the steps under stages: [{ name, steps }].",
			);
		else if (stage.steps.length === 0)
			push(
				"empty_journey_stage",
				`${path}.steps`,
				notes > 0
					? `Stage "${name}" has pain points or opportunities but no steps.`
					: `Stage "${name}" has no steps.`,
				notes > 0 && placed.length > 0
					? `Put each note under the stage it belongs to: ${placed}; or give "${name}" its steps.`
					: "Give every stage at least one step, or drop the stage.",
			);
		if (stage.steps.length > JOURNEY_MAX_STAGE_STEPS)
			push(
				"journey_too_large",
				`${path}.steps`,
				`Stage "${name}" has ${stage.steps.length} steps; a stage holds at most ${JOURNEY_MAX_STAGE_STEPS}.`,
				"Split the stage in two, or keep the steps the source states.",
			);
		stage.steps.forEach((step, stepIndex) => {
			const stepPath = `${path}.steps.[${stepIndex}]`;
			const label = step.label.trim();
			if (
				!Number.isInteger(step.score) ||
				step.score < JOURNEY_MIN_SCORE ||
				step.score > JOURNEY_MAX_SCORE
			)
				push(
					"invalid_journey_score",
					`${stepPath}.score`,
					`Step "${label}" has score ${step.score}.`,
					"Use a whole number from 1 (very negative) to 5 (very positive); 3 is neutral.",
				);
			long(
				`${stepPath}.label`,
				`Step "${label.slice(0, 24)}…"`,
				step.label,
				JOURNEY_MAX_LABEL_LENGTH,
			);
			const stepActors =
				step.actor === undefined ? [] : journeyStepActors(step.actor, actors ?? []);
			for (const actor of stepActors)
				long(`${stepPath}.actor`, `Actor "${actor}" of "${label}"`, actor, JOURNEY_MAX_NAME_LENGTH);
			long(
				`${stepPath}.touchpoint`,
				`The touchpoint of "${label}"`,
				step.touchpoint,
				JOURNEY_MAX_NAME_LENGTH,
			);
			const unknown = stepActors.filter((actor) => !known.has(sameName(actor)));
			if (actors !== undefined && unknown.length > 0)
				push(
					"unknown_journey_actor",
					`${stepPath}.actor`,
					`Actor "${unknown[0]}" of step "${label}" is not one of the journey's actors.`,
					`Use one of ${actors.map((actor) => `"${actor.trim()}"`).join(", ")}, or add the actor to actors; a step several actors share names them all, "A, B".`,
				);
		});
		for (const kind of ["painPoints", "opportunities"] as const) {
			const notes = stage[kind] ?? [];
			const noun = kind === "painPoints" ? "pain points" : "opportunities";
			if (notes.length > JOURNEY_MAX_NOTES)
				push(
					"journey_too_large",
					`${path}.${kind}`,
					`Stage "${name}" has ${notes.length} ${noun}; a stage holds at most ${JOURNEY_MAX_NOTES}.`,
					`Keep the ${noun} the source states, merging the closest ones.`,
				);
			notes.forEach((note, index) =>
				long(
					`${path}.${kind}.[${index}]`,
					`A ${noun.replace(/s$/u, "")} of "${name}"`,
					note,
					JOURNEY_MAX_NOTE_LENGTH,
				),
			);
		}
	});
	return issues.slice(0, JOURNEY_MAX_ISSUES);
}

export class JourneyValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly JourneyValidationIssue[]) {
		super(issues[0]?.message ?? "Journey map failed semantic validation.");
		this.name = "JourneyValidationError";
	}
}

export function validateJourneyDiagram(diagram: JourneyDiagram): JourneyDiagram {
	const issues = getJourneyValidationIssues(diagram);
	if (issues.length > 0) throw new JourneyValidationError(issues);
	return diagram;
}

export function parseJourneyDiagram(input: unknown): JourneyDiagram {
	return validateJourneyDiagram(Schema.decodeUnknownSync(JourneyDiagram, { errors: "all" })(input));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The first of `keys` a record sets, removed from `rest`. */
function take(rest: Record<string, unknown>, keys: readonly string[]): unknown {
	let found: unknown;
	for (const key of keys) {
		if (found === undefined && rest[key] !== undefined) found = rest[key];
		delete rest[key];
	}
	return found;
}

const STAGE_LIST_KEYS = ["stages", "sections", "phases"];
const STAGE_NAME_KEYS = ["name", "title", "label", "stage", "section", "phase"];
const STEP_LIST_KEYS = ["steps", "tasks", "actions"];
const STEP_LABEL_KEYS = ["label", "task", "name", "title", "action", "step"];
const SCORE_KEYS = ["score", "sentiment", "emotion", "rating", "feeling", "mood", "satisfaction"];
const TOUCHPOINT_KEYS = ["touchpoint", "channel", "touchPoint", "via"];
const PAIN_KEYS = ["painPoints", "pain_points", "painpoints", "pains", "pain"];
const OPPORTUNITY_KEYS = ["opportunities", "opportunity", "ideas", "improvements"];
const NOTE_TEXT_KEYS = ["text", "label", "name", "title", "description"];

/** A name written as text or as `{ name }`. */
function nameOf(value: unknown): unknown {
	if (!isRecord(value)) return value;
	return value["name"] ?? value["label"] ?? value["title"] ?? value;
}

/** A score written as a numeric string reads as its number. */
function scoreOf(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const number = Number(value.trim());
	return value.trim() !== "" && Number.isFinite(number) ? number : value;
}

/** Notes written as one string, a list of strings, or `{ text }` entries. */
function notesOf(value: unknown): unknown {
	const list = typeof value === "string" ? [value] : value;
	if (!Array.isArray(list)) return list;
	return list.map((note) => {
		if (!isRecord(note)) return note;
		for (const key of NOTE_TEXT_KEYS) if (typeof note[key] === "string") return note[key];
		return note;
	});
}

/** Mermaid's `Task: 5: Actor` written as one string. */
function stepFromText(text: string): unknown {
	const match = /^(.+?):\s*(-?\d+(?:\.\d+)?)\s*(?::\s*(.+))?$/u.exec(text.trim());
	if (!match) return text;
	const actors =
		match[3]
			?.split(",")
			.map((actor) => actor.trim())
			.filter(Boolean) ?? [];
	return {
		label: match[1]!.trim(),
		score: Number(match[2]),
		// Actors who share a step stay together, "Customer, Agent".
		...(actors.length > 0 ? { actor: actors.join(", ") } : {}),
	};
}

function resolveStep(step: unknown): unknown {
	if (typeof step === "string") return stepFromText(step);
	if (!isRecord(step)) return step;
	const rest: Record<string, unknown> = { ...step };
	delete rest["stage"];
	const label = take(rest, STEP_LABEL_KEYS);
	const score = take(rest, SCORE_KEYS);
	const touchpoint = take(rest, TOUCHPOINT_KEYS);
	const listed = rest["actors"];
	// A list of actors is the step's actor, or the several who share it: "Customer, Agent".
	if (Array.isArray(listed)) {
		const names = listed.map(nameOf);
		if (rest["actor"] === undefined && names.length > 0)
			rest["actor"] = names.every((name) => typeof name === "string") ? names.join(", ") : names;
		delete rest["actors"];
	}
	if (isRecord(rest["actor"])) rest["actor"] = nameOf(rest["actor"]);
	return {
		...rest,
		...(label === undefined ? {} : { label }),
		...(score === undefined ? {} : { score: scoreOf(score) }),
		...(touchpoint === undefined || touchpoint === "" ? {} : { touchpoint }),
	};
}

function resolveStage(stage: unknown): unknown {
	if (!isRecord(stage)) return stage;
	const rest: Record<string, unknown> = { ...stage };
	const name = take(rest, STAGE_NAME_KEYS);
	const steps = take(rest, STEP_LIST_KEYS);
	const pains = take(rest, PAIN_KEYS);
	const opportunities = take(rest, OPPORTUNITY_KEYS);
	return {
		...rest,
		...(name === undefined ? {} : { name }),
		...(steps === undefined
			? {}
			: { steps: Array.isArray(steps) ? steps.map(resolveStep) : steps }),
		...(pains === undefined ? {} : { painPoints: notesOf(pains) }),
		...(opportunities === undefined ? {} : { opportunities: notesOf(opportunities) }),
	};
}

/**
 * Read the ways people write a journey into the canonical shape: Mermaid's
 * `sections` of `tasks` (also `Task: 5: Actor` strings), `title` for a stage's
 * name, `task` for a step's label, `sentiment` or `emotion` for its score
 * (numeric strings too), `channel` for its touchpoint, a list of one actor,
 * `pains` and `ideas` for a stage's notes, a persona written as `{ name,
 * description }`, actors written as `{ name }`, and flat `steps` (and notes)
 * that each name their `stage`, grouped in first-use order.
 */
export function resolveJourneyShorthand(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const rest: Record<string, unknown> = { ...input };
	const listed = take(rest, STAGE_LIST_KEYS);
	const flatSteps = take(rest, STEP_LIST_KEYS);
	const flatPains = take(rest, PAIN_KEYS);
	const flatOpportunities = take(rest, OPPORTUNITY_KEYS);
	let stages: unknown = Array.isArray(listed) ? listed.map(resolveStage) : listed;
	// Steps written flat group under the stages they name, in first-use order. One naming
	// no stage lands in a stage of its own, which validation rejects naming the stages it
	// may use; a step is never dropped.
	const flat =
		flatSteps === undefined || flatSteps === null
			? undefined
			: Array.isArray(flatSteps)
				? flatSteps
				: [flatSteps];
	if (flat && (stages === undefined || Array.isArray(stages))) {
		const groups =
			(stages as Record<string, unknown>[] | undefined)?.map((stage) => ({ ...stage })) ?? [];
		for (const step of flat) {
			const named = isRecord(step) ? nameOf(step["stage"]) : undefined;
			const stageName =
				typeof named === "string" && named.trim().length > 0 ? named : JOURNEY_UNPLACED_STAGE;
			let group = groups.find((entry) => isRecord(entry) && entry["name"] === stageName);
			if (!group) {
				group = { name: stageName, steps: [] };
				groups.push(group);
			}
			group["steps"] = [...((group["steps"] as unknown[] | undefined) ?? []), resolveStep(step)];
		}
		stages = groups;
	}
	// Notes written apart from the stages go under the stage each names. One naming a stage
	// the journey lacks, or none, lands in a stage of its own with no steps, which
	// validation rejects naming the stages it may use; a note is never dropped.
	for (const [kind, entries] of [
		["painPoints", flatPains],
		["opportunities", flatOpportunities],
	] as const) {
		if (entries === undefined || entries === null || !Array.isArray(stages)) continue;
		for (const note of Array.isArray(entries) ? entries : [entries]) {
			const named = isRecord(note) ? nameOf(note["stage"]) : undefined;
			const stageName =
				typeof named === "string" && named.trim().length > 0 ? named : JOURNEY_UNPLACED_STAGE;
			let stage = (stages as unknown[]).find(
				(entry) => isRecord(entry) && entry["name"] === stageName,
			) as Record<string, unknown> | undefined;
			if (!stage) {
				stage = { name: stageName, steps: [] };
				(stages as unknown[]).push(stage);
			}
			const text = isRecord(note)
				? (({ stage: _stage, ...rest }) => notesOf([rest]) as unknown[])(note)
				: [note];
			stage[kind] = [...((stage[kind] as unknown[] | undefined) ?? []), ...text];
		}
	}
	const persona = rest["persona"];
	if (isRecord(persona)) {
		const name = persona["name"];
		const about = persona["description"] ?? persona["role"] ?? persona["summary"];
		rest["persona"] =
			typeof name === "string" && typeof about === "string" ? `${name}, ${about}` : (name ?? about);
	}
	if (Array.isArray(rest["actors"])) rest["actors"] = rest["actors"].map(nameOf);
	return { ...rest, ...(stages === undefined ? {} : { stages }) };
}

export const journeyFixture = parseJourneyDiagram({
	id: "online-purchase-journey",
	title: "Online purchase journey",
	type: journeyDiagramType,
	persona: "Maya, a first-time buyer",
	stages: [
		{
			name: "Discover",
			steps: [
				{ label: "Sees an ad for running shoes", score: 4, touchpoint: "Instagram" },
				{ label: "Reads reviews", score: 3, touchpoint: "Website" },
			],
			painPoints: ["Reviews are hard to filter"],
			opportunities: ["Highlight reviews by runners"],
		},
		{
			name: "Purchase",
			steps: [
				{ label: "Adds shoes to cart", score: 4, touchpoint: "Website" },
				{ label: "Creates an account to pay", score: 2, touchpoint: "Website" },
				{ label: "Pays by card", score: 3, touchpoint: "Website" },
			],
			painPoints: ["Forced account creation", "Shipping cost shown late"],
			opportunities: ["Offer guest checkout"],
		},
		{
			name: "Delivery",
			steps: [
				{ label: "Waits for the parcel", score: 2, touchpoint: "Email" },
				{ label: "Unboxes the shoes", score: 5 },
			],
			opportunities: ["Send live tracking updates"],
		},
	],
});
