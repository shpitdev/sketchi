import { QUADRANT_RULES } from "./rules";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Quadrant chart", hint: "best for 2×2 matrices of items scored on two axes" },
	summary: "quadrant charts: 2×2 matrices of items placed by two measures",
	fastPath: `spec: { title, xAxis: { title, low, high }, yAxis: same, quadrants: { topLeft, topRight, bottomLeft, bottomRight }, points: [{ label, x, y, group? }] }. ${QUADRANT_RULES.placementCompact}`,
	codeHint: "2×2 matrices",
	catalogOrder: 11,
	fastPathOrder: 13,
	studioOrder: 13,
	toolName: "build_quadrant_chart" as const,
	toolDescription:
		"Build and persist a native quadrant chart: a square plot split into four tinted, named quadrants, axis arrows carrying their end labels, and each item as a dot at its scores with its label beside it. Give xAxis and yAxis { title, low, high }, quadrants { topLeft, topRight, bottomLeft, bottomRight }, and points [{ label, x, y, group? }]. The host places every dot and label. Repair structured issues, up to three total attempts.",

	entry: (requestType: string) => ({
		id: "buildQuadrantChart",
		kind: "operation" as const,
		title: "buildQuadrantChart",
		topic: "buildQuadrantChart" as const,
		keywords: [
			"quadrant chart",
			"2x2 matrix",
			"Eisenhower matrix",
			"effort vs impact",
			"prioritization matrix",
			"positioning map",
			"magic quadrant",
		],
		snippet:
			"Create a native quadrant chart of items placed by two measures in four named quadrants.",
		content: [
			"buildQuadrantChart accepts { spec: { id?, title, xAxis: { title, low, high }, yAxis: { title, low, high }, quadrants: { topLeft, topRight, bottomLeft, bottomRight }, points: [{ label, x, y, group? }] }, options? }. The renderer draws a square plot split into four tinted quadrants with their names in their corners, axis arrows carrying the titles and end labels, and each point as a dot at its exact position with its label beside it, or on a leader line where the plot is crowded.",
			`${QUADRANT_RULES.axisEnds(PROMPT)} ${QUADRANT_RULES.names}`,
			`${QUADRANT_RULES.points} ${QUADRANT_RULES.axes(PROMPT)}`,
			`${QUADRANT_RULES.groups(PROMPT)} ${QUADRANT_RULES.limits}`,
			QUADRANT_RULES.copy(PROMPT),
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "Effort vs impact with scores out of 100",
				language: "js" as const,
				code: `async () => sketchi.buildQuadrantChart({ spec: { title: "Backlog: effort vs impact", xAxis: { title: "Effort", low: "Low effort", high: "High effort" }, yAxis: { title: "Impact", low: "Low impact", high: "High impact" }, quadrants: { topLeft: "Quick wins", topRight: "Major projects", bottomLeft: "Fill-ins", bottomRight: "Thankless tasks" }, points: [{ label: "Single sign-on", x: 0.3, y: 0.85 }, { label: "Dark mode", x: 0.2, y: 0.4 }, { label: "Usage-based billing", x: 0.8, y: 0.9 }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
