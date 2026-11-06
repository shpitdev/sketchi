import { DIAGRAM_TYPES, type DiagramTypeValue } from "@sketchi/diagram-core";

import type { DiagramGenerationRequest } from "./candidates.js";

/**
 * Words that name a family outright. Bare "chart" and "diagram" name none: an
 * org chart, a Gantt chart and a flowchart are all charts.
 */
const FAMILY_NAMES: Readonly<Record<DiagramTypeValue, RegExp>> = {
	flowchart:
		/\bflow[- ]?charts?\b|\bswim[- ]?lanes?\b|\b(?:process|work[- ]?flow|decision)[- ](?:flow|diagram|map|tree)s?\b|\b(?:architecture|infrastructure|network|deployment|system)[- ]diagrams?\b/iu,
	mindmap: /\bmind[- ]?map/iu,
	sequence: /\bsequence[- ]?(?:diagram|chart)s?\b|\bmessage sequence\b/iu,
	timeline: /\btime[- ]?lines?\b/iu,
	chart:
		/\b(?:bar|column|line|pie|donut|doughnut|area)[- ](?:chart|graph|plot)s?\b|\bhistograms?\b/iu,
	"state-machine":
		/\bstate[- ]?(?:machine|diagram|chart)s?\b|\bfinite[- ]state\b|\bFSMs?\b|\bstatecharts?\b/iu,
	gantt: /\bgantt\b/iu,
	er: /\bERDs?\b|\bE-?R[- ]diagrams?\b|\bentity[- ]relationship\b/iu,
	class: /\bclass[- ]?diagrams?\b|\bUML class/iu,
	"org-chart":
		/\borg(?:ani[sz]ation(?:al)?)?[- ]?charts?\b|\borgan[io]grams?\b|\breporting (?:structure|lines?|chain)\b/iu,
	venn: /\bvenn\b/iu,
	journey: /\bjourney[- ]?maps?\b|\b(?:user|customer|buyer|patient|employee)[- ]journeys?\b/iu,
	sankey: /\bsankey\b/iu,
	wireframe: /\bwire[- ]?fram(?:e|es|ed|ing)\b|\bmock[- ]?ups?\b/iu,
	quadrant: /\bquadrants?\b|\b2\s?[x×]\s?2\b|\beisenhower\b/iu,
};

/**
 * A request that names no family but describes a process, a pipeline or an
 * architecture: the prompt draws those as a flowchart, with lanes or zone groups.
 */
const FLOWCHART_SHAPED =
	/\b(?:flows?|pipelines?|process(?:es)?|workflows?|architecture|infrastructure|setup|topology|zones?|subnets?|VPCs?|clusters?|data ?centers?)\b/iu;

export interface DiagramFamilyRoute {
	/** The families whose rules the prompt carries, in registry order. */
	readonly families: readonly DiagramTypeValue[];
	/** "named": the request names these families; "shaped": it describes a flowchart's subject. */
	readonly cue: "named" | "shaped";
}

/**
 * The families an untyped request is about, read from its own words, or
 * undefined when it gives no cue and the prompt should carry every family.
 * A request that names several families gets all of them, so the model still
 * chooses between them.
 */
export function routeDiagramFamilies(request: string): DiagramFamilyRoute | undefined {
	const named = DIAGRAM_TYPES.filter((type) => FAMILY_NAMES[type].test(request));
	if (named.length > 0) return { cue: "named", families: named };
	if (FLOWCHART_SHAPED.test(request)) {
		return { cue: "shaped", families: ["flowchart"] };
	}
	return undefined;
}

/**
 * The request built as for the one family its words name, when it names no type, revises no
 * diagram, and names exactly one family. Repairs keep the same family.
 */
export function withFamilyRoute(request: DiagramGenerationRequest): {
	readonly request: DiagramGenerationRequest;
	readonly route?: DiagramFamilyRoute;
} {
	const { prompt } = request;
	if (prompt.requestedType || prompt.routedType || prompt.base) return { request };
	const route = routeDiagramFamilies(prompt.request);
	const [only, ...others] = route?.families ?? [];
	return route && only && others.length === 0
		? { request: { ...request, prompt: { ...prompt, routedType: only } }, route }
		: { request };
}
