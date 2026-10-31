import { type JourneyDiagram, journeyStepActors, parseJourneyDiagram } from "@sketchi/diagram-core";
import {
	journeyLayoutIssues,
	readJourneyScene,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";

import type { ScenarioCheck } from "./evaluate.js";
import type { DiagramScenarioDifficulty } from "./scenarios.js";

/** A step the prompt states: its label, score, and the actor or touchpoint it names. */
export interface JourneyScenarioStep {
	readonly key: string;
	/** Every form the label may take; the first is as stated. */
	readonly labels: readonly string[];
	readonly score: number;
	readonly actor?: string;
	readonly touchpoint?: string;
}

/** A stage the prompt states, with its steps, pain points and opportunities in order. */
export interface JourneyScenarioStage {
	readonly key: string;
	readonly names: readonly string[];
	readonly steps: readonly JourneyScenarioStep[];
	readonly painPoints: readonly string[];
	readonly opportunities: readonly string[];
}

export interface JourneyScenario {
	readonly assertions: {
		/** Words the persona (or the title naming it) must hold, when the prompt states one. */
		readonly persona?: readonly string[];
		readonly stages: readonly JourneyScenarioStage[];
		/** Every actor the prompt names, when it names actors; no other may appear. */
		readonly actors?: readonly string[];
	};
	readonly description: string;
	readonly diagramType: "journey";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: JourneyDiagram;
	readonly id: string;
	readonly logos: readonly [];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

/** Labels compare without case, spaces or punctuation: "Sign up" matches "sign-up". */
const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** A label without a leading article, which neither form needs. */
const bare = (text: string) => key(text.trim().replace(/^(the|an?)\s+/iu, ""));

/**
 * Whether a drawn label states one of the accepted forms: as written, or
 * without a leading actor or persona the step's own fields carry ("Marco
 * creates an account" is "creates an account" by Marco).
 */
function labelMatches(
	found: string,
	acceptedLabels: readonly string[],
	subjects: readonly string[],
) {
	// A label and the same label after its leading subject ("Marco ", "IT team: ").
	const forms = (label: string) => {
		const lead = /^([^:]+):\s*/u.exec(label);
		const stripped = [
			...(lead ? [label.slice(lead[0].length)] : []),
			...subjects.flatMap((subject) =>
				key(subject).length > 0 && key(label).startsWith(key(subject))
					? [label.trim().slice(subject.trim().length)]
					: [],
			),
		];
		return [label, ...stripped].flatMap((form) => [bare(form), key(form)]);
	};
	const accepted = new Set(acceptedLabels.flatMap(forms));
	return forms(found).some((form) => accepted.has(form));
}

/**
 * Journey checks score what the prompt states, each on its own: the persona,
 * every stage in order, every step under its stage in order with its score
 * and its actor or touchpoint, every pain point and opportunity under its
 * stage, and no step, note or actor the prompt does not state.
 */
export function journeyScenarioChecks(
	scenario: JourneyScenario,
	diagram: JourneyDiagram,
): ScenarioCheck[] {
	const { stages, persona, actors } = scenario.assertions;
	const subjects = [...(actors ?? []), ...(persona ?? []).slice(0, 1)];
	const stageIndex = new Map(
		stages.map((expected) => [
			expected.key,
			diagram.stages.findIndex((stage) =>
				expected.names.some((name) => bare(name) === bare(stage.name)),
			),
		]),
	);
	const drawnSteps = diagram.stages.flatMap((stage, stageAt) =>
		stage.steps.map((step, index) => ({ step, stageAt, index })),
	);
	const checks: ScenarioCheck[] = [];
	if (persona) {
		const text = key(`${diagram.persona ?? ""} ${diagram.title}`);
		checks.push({
			id: "persona",
			passed: persona.every((word) => text.includes(key(word))),
			message: `Expected the persona, "${persona.join(" ")}", in the persona or title.`,
		});
	}
	for (const expected of stages)
		checks.push({
			id: `stage:${expected.key}`,
			passed: stageIndex.get(expected.key)! >= 0,
			message: `Expected a stage named "${expected.names.join('" or "')}".`,
		});
	const order = stages.map((expected) => stageIndex.get(expected.key)!);
	checks.push({
		id: "stage-order",
		passed: order.every((index, at) => index >= 0 && (at === 0 || index > order[at - 1]!)),
		message: `Expected the stages in order: ${stages.map((stage) => stage.names[0]).join(", ")}.`,
	});
	for (const expected of stages) {
		const stageAt = stageIndex.get(expected.key)!;
		const found = expected.steps.map((step) =>
			drawnSteps.find((entry) => labelMatches(entry.step.label, step.labels, subjects)),
		);
		expected.steps.forEach((step, at) => {
			const entry = found[at];
			const label = step.labels[0]!;
			checks.push({
				id: `step:${step.key}`,
				passed: entry !== undefined && entry.stageAt === stageAt && stageAt >= 0,
				message: `Expected the step "${label}" under "${expected.names[0]}"${entry && entry.stageAt !== stageAt ? `; found it under "${diagram.stages[entry.stageAt]?.name}"` : ""}.`,
			});
			checks.push({
				id: `score:${step.key}`,
				passed: entry?.step.score === step.score,
				message: `Expected "${label}" scored ${step.score}${entry ? `; found ${entry.step.score}` : ""}.`,
			});
			const named = step.actor ?? step.touchpoint;
			if (named !== undefined)
				checks.push({
					id: `${step.actor !== undefined ? "actor" : "touchpoint"}:${step.key}`,
					passed:
						(entry !== undefined &&
							[entry.step.actor, entry.step.touchpoint].some(
								(value) => value !== undefined && key(value) === key(named),
							)) ||
						(entry !== undefined && key(entry.step.label).startsWith(key(named))),
					message: `Expected "${label}" with its ${step.actor !== undefined ? "actor" : "touchpoint"}, "${named}".`,
				});
		});
		const indices = found.map((entry) =>
			entry !== undefined && entry.stageAt === stageAt ? entry.index : -1,
		);
		checks.push({
			id: `step-order:${expected.key}`,
			passed: indices.every((index, at) => index >= 0 && (at === 0 || index > indices[at - 1]!)),
			message: `Expected the steps of "${expected.names[0]}" in their stated order.`,
		});
		for (const kind of ["painPoints", "opportunities"] as const) {
			const notes = stageAt >= 0 ? (diagram.stages[stageAt]?.[kind] ?? []) : [];
			expected[kind].forEach((note, at) =>
				checks.push({
					id: `${kind === "painPoints" ? "pain-point" : "opportunity"}:${expected.key}:${at + 1}`,
					passed: notes.some((found) => bare(found) === bare(note)),
					message: `Expected the ${kind === "painPoints" ? "pain point" : "opportunity"} "${note}" under "${expected.names[0]}".`,
				}),
			);
		}
	}
	const count = (pick: (stage: JourneyScenarioStage) => number) =>
		stages.reduce((total, stage) => total + pick(stage), 0);
	const drawn = (kind: "painPoints" | "opportunities") =>
		diagram.stages.reduce((total, stage) => total + (stage[kind]?.length ?? 0), 0);
	const exact = (id: string, noun: string, expected: number, found: number) =>
		checks.push({
			id,
			passed: expected === found,
			message: `Expected exactly ${expected} ${noun}; found ${found}.`,
		});
	exact(
		"steps-exact",
		"steps",
		count((stage) => stage.steps.length),
		drawnSteps.length,
	);
	exact(
		"pain-points-exact",
		"pain points",
		count((stage) => stage.painPoints.length),
		drawn("painPoints"),
	);
	exact(
		"opportunities-exact",
		"opportunities",
		count((stage) => stage.opportunities.length),
		drawn("opportunities"),
	);
	if (actors) {
		const stated = new Set(actors.map(key));
		const used = [
			...(diagram.actors ?? []),
			...drawnSteps.flatMap((entry) =>
				entry.step.actor === undefined
					? []
					: journeyStepActors(entry.step.actor, diagram.actors ?? []),
			),
		];
		const unstated = used.filter((actor) => !stated.has(key(actor)));
		checks.push({
			id: "actors-stated",
			passed: unstated.length === 0,
			message:
				unstated.length === 0
					? "Every actor is one the prompt names."
					: `Expected no actor the prompt does not name; found "${[...new Set(unstated)].join('", "')}".`,
		});
	}
	return checks;
}

const flat = (text: string | undefined) => (text ?? "").replace(/\s+/gu, "");

/** Layout issues that misdraw the diagram rather than crowd it. */
const MISDRAWN = new Set([
	"card-off-stage",
	"note-off-stage",
	"face-off-step",
	"face-off-score",
	"face-wrong-expression",
	"score-misprinted",
	"curve-off-faces",
	"stages-out-of-order",
]);

/**
 * The drawn scene says what the diagram says: every stage's header in order,
 * each step's card under its stage with its label, a face on its score's
 * labeled level inside its step's column, with its score printed above it,
 * that smiles, sets flat or frowns as the score says, the curve through the
 * faces, and each pain point and opportunity in its stage's column.
 */
export function journeyDrawnCheck(
	diagram: JourneyDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const read = readJourneyScene(scene);
	const problems: string[] = [];
	if (
		read.stages.length !== diagram.stages.length ||
		read.stages.some((stage, index) => flat(stage.name) !== flat(diagram.stages[index]?.name))
	)
		problems.push("stage headers");
	diagram.stages.forEach((stage, stageAt) => {
		stage.steps.forEach((step, index) => {
			const drawn = read.steps.find((entry) => entry.stage === stageAt && entry.index === index);
			if (!drawn || flat(drawn.label) !== flat(step.label)) problems.push(`card ${step.label}`);
			if (drawn?.face?.score !== step.score) problems.push(`face ${step.label}`);
		});
		for (const kind of ["painPoints", "opportunities"] as const) {
			const notes = read.notes.filter(
				(note) =>
					note.stage === stageAt &&
					note.kind === (kind === "painPoints" ? "pain-point" : "opportunity"),
			);
			if (
				notes.length !== (stage[kind]?.length ?? 0) ||
				notes.some((note) => flat(note.text) !== flat(stage[kind]?.[note.index]))
			)
				problems.push(`${kind} of ${stage.name}`);
		}
	});
	problems.push(
		...journeyLayoutIssues(scene)
			.filter((issue) => MISDRAWN.has(issue.code))
			.map((issue) => issue.message),
	);
	return {
		id: "journey-drawn",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "Every stage, card, face, curve point, pain point and opportunity is drawn as the diagram states."
				: `Drawn differently from the diagram: ${problems.slice(0, 8).join(", ")}.`,
	};
}

/** Nothing overlaps, every text fits its box, and every card, note and face keeps to its stage. */
export function journeyLayoutCheck(scene: RenderedDiagramScene): ScenarioCheck {
	const issues = journeyLayoutIssues(scene);
	return {
		id: "journey-layout",
		passed: issues.length === 0,
		message:
			issues.length === 0
				? "Nothing overlaps, every card fits its text, and every row keeps to its stages."
				: issues
						.slice(0, 6)
						.map((issue) => issue.message)
						.join(" "),
	};
}

type StepDefinition = readonly [
	key: string,
	/** The label as stated, or every form it may take. */
	label: string | readonly string[],
	score: number,
	named?: { readonly actor?: string; readonly touchpoint?: string },
];

interface StageDefinition {
	readonly key: string;
	readonly name: string | readonly string[];
	readonly steps: readonly StepDefinition[];
	readonly painPoints?: readonly string[];
	readonly opportunities?: readonly string[];
}

interface JourneyScenarioDefinition {
	readonly id: string;
	readonly title: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly tags: readonly string[];
	readonly description: string;
	readonly prompt: string;
	/** The persona as the expected diagram states it, and the words a model's must hold. */
	readonly persona?: { readonly text: string; readonly words: readonly string[] };
	readonly actors?: readonly string[];
	readonly stages: readonly StageDefinition[];
}

const list = (value: string | readonly string[]): readonly string[] =>
	typeof value === "string" ? [value] : value;

function defineJourneyScenario(definition: JourneyScenarioDefinition): JourneyScenario {
	const { persona, actors, stages, ...scenario } = definition;
	return {
		...scenario,
		diagramType: "journey",
		logos: [],
		assertions: {
			...(persona ? { persona: persona.words } : {}),
			...(actors ? { actors } : {}),
			stages: stages.map((stage) => ({
				key: stage.key,
				names: list(stage.name),
				steps: stage.steps.map(([stepKey, labels, score, named]) => ({
					key: stepKey,
					labels: list(labels),
					score,
					...(named?.actor === undefined ? {} : { actor: named.actor }),
					...(named?.touchpoint === undefined ? {} : { touchpoint: named.touchpoint }),
				})),
				painPoints: stage.painPoints ?? [],
				opportunities: stage.opportunities ?? [],
			})),
		},
		expectedDiagram: parseJourneyDiagram({
			id: definition.id,
			title: definition.title,
			type: "journey",
			...(persona ? { persona: persona.text } : {}),
			...(actors ? { actors } : {}),
			stages: stages.map((stage) => ({
				name: list(stage.name)[0],
				steps: stage.steps.map(([, labels, score, named]) => ({
					label: list(labels)[0],
					score,
					...named,
				})),
				...(stage.painPoints ? { painPoints: stage.painPoints } : {}),
				...(stage.opportunities ? { opportunities: stage.opportunities } : {}),
			})),
		}),
	};
}

const onlinePurchaseStages: readonly StageDefinition[] = [
	{
		key: "discover",
		name: "Discover",
		steps: [
			["instagram-ad", "Sees an Instagram ad", 4, { touchpoint: "Instagram" }],
			["reviews", "Reads reviews on the brand site", 4, { touchpoint: "Website" }],
		],
	},
	{
		key: "choose",
		name: "Choose",
		steps: [
			["compare", "Compares three models", 3, { touchpoint: "Website" }],
			["size", "Can't find her size in stock", 1, { touchpoint: "Website" }],
		],
		painPoints: ["Sizes aren't shown until the product page"],
		opportunities: ["Show stock by size in search results"],
	},
	{
		key: "buy",
		name: "Buy",
		steps: [
			["guest-checkout", "Checks out as a guest", 3, { touchpoint: "Website" }],
			["apple-pay", "Pays with Apple Pay", 5, { touchpoint: "Website" }],
		],
	},
	{
		key: "receive",
		name: "Receive",
		steps: [
			["confirmation", "Gets a shipping confirmation", 4, { touchpoint: "Email" }],
			["late", "The package arrives a day late", 2, { touchpoint: "Courier" }],
		],
		painPoints: ["No notice of the delay"],
		opportunities: ["Text customers when a delivery slips"],
	},
];

const saasOnboardingStages: readonly StageDefinition[] = [
	{
		key: "sign-up",
		name: "Sign up",
		steps: [
			["account", "Marco creates an account with his work email", 4, { actor: "Marco" }],
			[
				"verification",
				"Marco finds the verification email in his spam folder",
				2,
				{ actor: "Marco" },
			],
		],
		painPoints: ["Verification emails land in spam"],
	},
	{
		key: "connect-data",
		name: "Connect data",
		steps: [
			[
				"warehouse",
				"Marco connects the warehouse database with a read-only user",
				3,
				{ actor: "Marco" },
			],
			[
				"allowlist",
				[
					"IT approves the firewall allowlist request after two days",
					"IT team approves the firewall allowlist request after two days",
				],
				1,
				{ actor: "IT team" },
			],
		],
		painPoints: ["The allowlist request waits on IT"],
		opportunities: ["Give IT a pre-filled allowlist request"],
	},
	{
		key: "first-dashboard",
		name: "First dashboard",
		steps: [
			[
				"template",
				"Marco builds a dashboard from the shipping delays template",
				4,
				{ actor: "Marco" },
			],
			["slow-query", "The first query takes ninety seconds to load", 2, { actor: "Beacon" }],
		],
		painPoints: ["The first query is slow"],
		opportunities: ["Cache template queries"],
	},
	{
		key: "invite-team",
		name: "Invite team",
		steps: [
			["invite", "Marco invites five dispatchers by email", 4, { actor: "Marco" }],
			["missed-invite", "Two dispatchers can't find the invitation", 2, { actor: "Dispatchers" }],
		],
		painPoints: ["Invitations are easy to miss"],
		opportunities: ["Let admins share an invite link"],
	},
	{
		key: "get-value",
		name: "Get value",
		steps: [
			[
				"late-carriers",
				"Dispatchers spot late carriers on the daily delays chart",
				5,
				{ actor: "Dispatchers" },
			],
		],
	},
	{
		key: "renew",
		name: "Renew",
		steps: [
			[
				"upgrade",
				"Marco upgrades to the annual Team plan after a call with his customer success manager",
				5,
				{ actor: "Customer success" },
			],
		],
	},
];

const supportTicketStages: readonly StageDefinition[] = [
	{
		key: "report",
		name: "Report",
		steps: [
			["double-charge", "Dana sees a double charge on her card", 1, { touchpoint: "Bank app" }],
			["ticket", "Dana opens a ticket in the help center", 2, { touchpoint: "Help center" }],
		],
		painPoints: ["The contact form is hidden behind three help articles"],
	},
	{
		key: "triage",
		name: "Triage",
		steps: [
			[
				"auto-reply",
				"An auto-reply promises an answer within 24 hours",
				2,
				{ touchpoint: "Email" },
			],
			["invoice", "An agent asks for the invoice number", 3, { touchpoint: "Email" }],
		],
		opportunities: ["Detect duplicate charges and refund them automatically"],
	},
	{
		key: "resolve",
		name: "Resolve",
		steps: [
			["call", "The agent calls to confirm the refund", 4, { touchpoint: "Phone" }],
			["refund", "The refund appears on her statement", 4, { touchpoint: "Bank app" }],
		],
	},
	{
		key: "follow-up",
		name: "Follow up",
		steps: [["survey", "Dana rates the support in a survey", 5, { touchpoint: "Email" }]],
	},
];

const journeyScenarioDefinitions: readonly JourneyScenarioDefinition[] = [
	{
		id: "online-purchase-journey-v2",
		title: "Priya buys running shoes online",
		difficulty: "smoke",
		tags: ["journey", "e-commerce", "touchpoints", "real-voice"],
		description:
			"Four stages of an online shoe purchase, two steps each with a touchpoint and score, and a pain point and an opportunity under two stages.",
		prompt: [
			"journey map from our research notes: Priya buying running shoes online, scores 1-5",
			"",
			"Discover",
			"- sees an Instagram ad (Instagram) 4",
			"- reads reviews on the brand site (Website) 4",
			"Choose",
			"- compares three models (Website) 3",
			"- can't find her size in stock (Website) 1",
			"pain point: sizes aren't shown until the product page",
			"opportunity: show stock by size in search results",
			"Buy",
			"- checks out as a guest (Website) 3",
			"- pays with Apple Pay (Website) 5",
			"Receive",
			"- gets a shipping confirmation (Email) 4",
			"- the package arrives a day late (Courier) 2",
			"pain point: no notice of the delay",
			"opportunity: text customers when a delivery slips",
		].join("\n"),
		persona: { text: "Priya", words: ["Priya"] },
		stages: onlinePurchaseStages,
	},
	{
		id: "saas-onboarding-journey-v2",
		title: "Beacon admin onboarding",
		difficulty: "challenge",
		tags: ["journey", "saas", "onboarding", "actors", "uneven-stages", "long-labels", "real-voice"],
		description:
			"Six stages of a SaaS admin's onboarding with uneven step counts, long step labels and five actors, and notes under four stages.",
		prompt: [
			"journey map of a new admin onboarding to Beacon, our analytics product. persona: Marco, operations lead at a 40-person logistics company. scores 1-5",
			"",
			"stage | step | who | score",
			"Sign up | Marco creates an account with his work email | Marco | 4",
			"Sign up | Marco finds the verification email in his spam folder | Marco | 2",
			"Connect data | Marco connects the warehouse database with a read-only user | Marco | 3",
			"Connect data | IT approves the firewall allowlist request after two days | IT team | 1",
			"First dashboard | Marco builds a dashboard from the shipping delays template | Marco | 4",
			"First dashboard | the first query takes ninety seconds to load | Beacon | 2",
			"Invite team | Marco invites five dispatchers by email | Marco | 4",
			"Invite team | two dispatchers can't find the invitation | Dispatchers | 2",
			"Get value | dispatchers spot late carriers on the daily delays chart | Dispatchers | 5",
			"Renew | Marco upgrades to the annual Team plan after a call with his customer success manager | Customer success | 5",
			"",
			"pain points",
			"Sign up: verification emails land in spam",
			"Connect data: the allowlist request waits on IT",
			"First dashboard: the first query is slow",
			"Invite team: invitations are easy to miss",
			"",
			"opportunities",
			"Connect data: give IT a pre-filled allowlist request",
			"First dashboard: cache template queries",
			"Invite team: let admins share an invite link",
		].join("\n"),
		persona: {
			text: "Marco, operations lead at a 40-person logistics company",
			words: ["Marco", "operations lead"],
		},
		actors: ["Marco", "IT team", "Beacon", "Dispatchers", "Customer success"],
		stages: saasOnboardingStages,
	},
	{
		id: "support-ticket-journey-v2",
		title: "Dana's double charge refund",
		difficulty: "standard",
		tags: ["journey", "support", "touchpoints", "refund", "real-voice"],
		description:
			"Four stages of getting a double charge refunded, seven steps with touchpoints and scores, one pain point and one opportunity.",
		prompt: [
			"journey map: Dana getting a double charge refunded (scores 1-5)",
			"",
			"stage,step,touchpoint,score",
			"Report,Dana sees a double charge on her card,Bank app,1",
			"Report,Dana opens a ticket in the help center,Help center,2",
			"Triage,an auto-reply promises an answer within 24 hours,Email,2",
			"Triage,an agent asks for the invoice number,Email,3",
			"Resolve,the agent calls to confirm the refund,Phone,4",
			"Resolve,the refund appears on her statement,Bank app,4",
			"Follow up,Dana rates the support in a survey,Email,5",
			"",
			"pain point (Report): the contact form is hidden behind three help articles",
			"opportunity (Triage): detect duplicate charges and refund them automatically",
		].join("\n"),
		persona: { text: "Dana", words: ["Dana"] },
		stages: supportTicketStages,
	},
];

export const journeyScenarios: readonly JourneyScenario[] =
	journeyScenarioDefinitions.map(defineJourneyScenario);
