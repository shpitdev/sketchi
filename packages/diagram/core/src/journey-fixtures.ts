import {
	JOURNEY_MAX_STAGE_STEPS,
	JOURNEY_MAX_STAGES,
	JOURNEY_MAX_STEPS,
	type JourneyDiagram,
	journeyDiagramType,
	parseJourneyDiagram,
} from "./types/journey.js";

const VERBS = [
	"Compares",
	"Searches",
	"Opens",
	"Reads",
	"Asks about",
	"Checks",
	"Updates",
	"Confirms",
	"Shares",
	"Returns",
];
const OBJECTS = [
	"the pricing page",
	"delivery options",
	"a confirmation email",
	"the mobile app",
	"account settings",
	"the help center",
	"a discount code",
	"the order status",
];
const SCORES = [3, 4, 2, 5, 1, 3, 4, 2];

const stageName = (index: number) => `Stage ${index + 1}`;
const stepLabel = (stage: number, step: number) =>
	`${VERBS[(stage + step) % VERBS.length]} ${OBJECTS[(stage * 3 + step) % OBJECTS.length]}`;

/** A journey of `stages` stages of `steps` steps each, scored in a fixed wave. */
function evenJourney(id: string, stages: number, steps: number): JourneyDiagram {
	return parseJourneyDiagram({
		id,
		title: `${stages * steps}-step journey`,
		type: journeyDiagramType,
		stages: Array.from({ length: stages }, (_, stage) => ({
			name: stageName(stage),
			steps: Array.from({ length: steps }, (_, step) => ({
				label: stepLabel(stage, step),
				score: SCORES[(stage + step) % SCORES.length],
			})),
			painPoints: stage % 2 === 0 ? [`Slow ${OBJECTS[stage % OBJECTS.length]}`] : [],
			opportunities: stage % 3 === 0 ? [`Simplify ${OBJECTS[(stage + 2) % OBJECTS.length]}`] : [],
		})),
	});
}

/** Journeys at the contract's bounds: the renderer and fuzz hold each to the same rules. */
export const journeyStressFixtures = {
	/** The most steps a journey holds: five full stages of eight. */
	longest: evenJourney("longest-journey", JOURNEY_MAX_STEPS / JOURNEY_MAX_STAGE_STEPS, 8),
	/** The most stages, with four steps each. */
	widest: evenJourney("widest-journey", JOURNEY_MAX_STAGES, 4),
	/** One stage of eight steps: too long for one band, it runs on into a second. */
	longStage: evenJourney("long-stage-journey", 1, JOURNEY_MAX_STAGE_STEPS),
	/** One stage of a single step. */
	single: parseJourneyDiagram({
		id: "single-step-journey",
		title: "Sign in",
		type: journeyDiagramType,
		stages: [{ name: "Sign in", steps: [{ label: "Enters a password", score: 3 }] }],
	}),
	/** Every text at its longest, with actors, touchpoints and full note stacks. */
	wordy: parseJourneyDiagram({
		id: "wordy-journey",
		title: "Enterprise procurement journey for a multi-region analytics platform",
		type: journeyDiagramType,
		persona: "Priya Raman, head of procurement at a regulated healthcare company",
		actors: ["Procurement lead", "Vendor account executive", "Security reviewer"],
		stages: [
			{
				name: "Evaluate vendors and shortlist the best",
				steps: [
					{
						label: "Collects requirements from finance and compliance teams",
						score: 3,
						actor: "Procurement lead",
						touchpoint: "Internal workshop",
					},
					{
						label:
							"Requests a tailored demo with production-scale sample data and a named solutions engineer",
						score: 4,
						actor: "Vendor account executive",
						touchpoint: "Video call",
					},
				],
				painPoints: [
					"Pricing pages hide the per-seat costs behind a sales conversation",
					"Every vendor uses different names for the same capabilities",
					"Security questionnaires arrive as unstructured spreadsheets",
					"Reference customers in healthcare are hard to find",
				],
				opportunities: [
					"Publish transparent pricing tiers with worked examples",
					"Offer a standard security package with SOC 2 and HIPAA evidence",
				],
			},
			{
				name: "Negotiate",
				steps: [
					{
						label: "Waits three weeks for the security review",
						score: 1,
						actor: "Security reviewer",
						touchpoint: "Email",
					},
				],
				painPoints: ["No status updates while the review is pending"],
			},
		],
	}),
	/** Labels in Japanese, which wrap between ideographs. */
	cjk: parseJourneyDiagram({
		id: "cjk-journey",
		title: "オンライン購入",
		type: journeyDiagramType,
		stages: [
			{
				name: "発見",
				steps: [
					{ label: "広告を見る", score: 4, touchpoint: "インスタグラム" },
					{ label: "レビューを読んで比較検討する", score: 3 },
				],
			},
			{
				name: "購入",
				steps: [{ label: "カートに追加して支払う", score: 2 }],
				painPoints: ["送料が最後に表示される"],
			},
		],
	}),
} satisfies Record<string, JourneyDiagram>;
