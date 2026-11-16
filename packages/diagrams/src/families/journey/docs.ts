import { JOURNEY_RULES } from "./rules";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Journey map", hint: "best for stages, steps and how each one feels" },
	summary: "user journey maps: stages of steps scored for sentiment",
	fastPath: `spec: { title, persona?, stages: [{ name, steps: [{ label, score, actor?, touchpoint? }], painPoints?, opportunities? }] }. ${JOURNEY_RULES.score}`,
	codeHint: undefined,
	catalogOrder: 14,
	fastPathOrder: 10,
	studioOrder: 10,
	toolName: "build_journey_map" as const,
	toolDescription:
		"Build and persist a native user journey map: stages as columns across the top, each step's card under its stage, an emotion curve through a face per step at its score, and each stage's pain points and opportunities beneath it. Give stages in order, each { name, steps: [{ label, score, actor?, touchpoint? }], painPoints?, opportunities? }, and persona. The host lays out the map. Repair structured issues, up to three total attempts.",

	entry: (requestType: string) => ({
		id: "buildJourneyMap",
		kind: "operation" as const,
		title: "buildJourneyMap",
		topic: "buildJourneyMap" as const,
		keywords: [
			"journey map",
			"user journey",
			"customer journey",
			"experience map",
			"touchpoint",
			"pain point",
			"sentiment",
			"emotion curve",
		],
		snippet: "Create a native user journey map from stages of steps, each scored for sentiment.",
		content: [
			"buildJourneyMap accepts { spec: { id?, title, persona?, actors?, stages: [{ name, steps: [{ label, score, actor?, touchpoint? }], painPoints?, opportunities? }] }, options? }. The renderer draws the stages as headers across the top, each step's card under its stage, a face per step on an emotion curve over a neutral baseline, and each stage's pain points and opportunities beneath it.",
			[
				JOURNEY_RULES.stages(PROMPT),
				JOURNEY_RULES.score,
				JOURNEY_RULES.actors(PROMPT),
				JOURNEY_RULES.notes(PROMPT),
			].join(" "),
			JOURNEY_RULES.copy(PROMPT),
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "An online purchase with a pain point and an opportunity",
				language: "js" as const,
				code: `async () => sketchi.buildJourneyMap({ spec: { title: "Online purchase", persona: "Maya, a first-time buyer", stages: [{ name: "Discover", steps: [{ label: "Sees an ad", score: 4, touchpoint: "Instagram" }] }, { name: "Buy", steps: [{ label: "Creates an account", score: 2, touchpoint: "Website" }, { label: "Pays by card", score: 3, touchpoint: "Website" }], painPoints: ["Forced account creation"], opportunities: ["Offer guest checkout"] }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
