import { SEQUENCE_RULES } from "./rules.js";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;
const SEQUENCE_DIAGRAM_EXAMPLE = `async () => sketchi.buildSequenceDiagram({
  spec: {
    title: "Checkout request",
    participants: [
      { id: "customer", label: "Customer" },
      { id: "store", label: "Store" },
      { id: "payments", label: "Payments" }
    ],
    messages: [
      { source: "customer", target: "store", label: "Checkout" },
      { source: "store", target: "payments", label: "Authorize payment" },
      { source: "payments", target: "store", label: "Approved", type: "return" }
    ]
  },
  options: ${DELIVERY_OPTIONS}
})`;
const SEQUENCE_LOGOS_EXAMPLE = `async () => {
  const technologies = ["github", "cloudflare", "docker"];
  const matches = await Promise.all(technologies.map(q => sketchi.searchIcons({ q })));
  const icons = technologies.map((slug, index) => matches[index].icons.find(icon => icon.slug === slug));
  if (icons.some(icon => !icon)) return { missingLogos: true };
  return sketchi.buildSequenceDiagram({
    spec: {
      title: "Deploy webhook",
      participants: [
        { id: "developer", label: "Developer" },
        ...technologies.map((id, index) => ({ id, label: ["GitHub", "Cloudflare Worker", "Docker"][index], icon: { slug: icons[index].slug } }))
      ],
      messages: [
        { source: "developer", target: "github", label: "Push commit" },
        { source: "github", target: "cloudflare", label: "Send deploy webhook" },
        { source: "cloudflare", target: "docker", label: "Build image" },
        { source: "docker", target: "cloudflare", label: "Image digest", type: "return" },
        { source: "cloudflare", target: "github", label: "202 Accepted", type: "return" }
      ]
    },
    options: ${DELIVERY_OPTIONS}
  });
}`;
export const docs = {
	choice: { label: "Sequence diagram", hint: "best for ordered participant interactions" },
	example: SEQUENCE_DIAGRAM_EXAMPLE,
	summary: "time-ordered messages between participants",
	fastPath: `spec: { title, participants: [{ id, label, icon?: { slug } }], messages: [{ source, target, label, type?: "return", style?: "dashed" }] }. Order is kept. ${SEQUENCE_RULES.replies(PROMPT)} ${SEQUENCE_RULES.selfStep}`,
	codeHint: "time-ordered messages",
	catalogOrder: 17,
	fastPathOrder: 2,
	studioOrder: 14,
	toolName: "build_sequence_diagram" as const,
	toolDescription:
		"Build and persist one canonical sequence diagram artifact. Pass { spec: SequenceDiagramSpec } with ordered participants and chronological messages; the host supplies artifact options. If rejected, repair every structured issue and retry, up to three total attempts.",

	entry: (requestType: string) => ({
		id: "buildSequenceDiagram",
		kind: "operation" as const,
		title: "buildSequenceDiagram",
		topic: "buildSequenceDiagram" as const,
		keywords: [
			"build",
			"sequence",
			"participant",
			"lifeline",
			"activation",
			"message",
			"chronology",
			"interaction",
		],
		snippet: "Create a native sequence diagram from ordered participants and messages.",
		content: [
			"buildSequenceDiagram accepts a semantic SequenceDiagramSpec with ordered participants and chronological messages. Builds use the fixed Sketchi palette.",
			"Use a sequence diagram when time-ordered interactions between actors or systems are the main idea. Use buildFlowchart for decisions and process paths; use buildMindmap for nested topic hierarchy.",
			SEQUENCE_RULES.order,
			SEQUENCE_RULES.activation,
			SEQUENCE_RULES.selfMessage,
			`A sequence diagram may have ${SEQUENCE_RULES.limits}; larger ones are rejected with sequence_too_large.`,
			"For every named technology participant (e.g. GitHub, Cloudflare Worker, Docker), call sketchi.searchIcons and set participant.icon to { slug } using a matching returned slug. Labels alone do not add logos, and omitted icons produce no warning. Leave human actors unbranded; a technology logo is drawn in the participant header and exported as an Excalidraw image. Unknown slugs are dropped with an unknown_icon warning, never a failed build.",
			"",
			requestType,
		].join("\n"),
		examples: [
			{
				title: "Deploy webhook with participant logos",
				language: "js" as const,
				code: SEQUENCE_LOGOS_EXAMPLE,
			},
			{
				title: "Checkout sequence diagram",
				language: "js" as const,
				code: SEQUENCE_DIAGRAM_EXAMPLE,
			},
		],
	}),
};
