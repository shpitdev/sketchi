import { DIAGRAM_TYPES, type DiagramTypeValue } from "@sketchi/diagram-core";
import { Effect } from "effect";

import type { DiagramGenerationRequest } from "./candidates.js";
import type { DiagramFamilyNarrowing, FamilyNarrowing } from "./family-narrowing.js";
import { FAMILY_THRESHOLDS } from "./family-questions.js";

/**
 * Words that name a family outright. Bare "chart" and "diagram" name none: an
 * org chart, a Gantt chart and a flowchart are all charts.
 */
export const FAMILY_NAMES: Readonly<Record<DiagramTypeValue, RegExp>> = {
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
	/**
	 * "named": the request names these families; "shaped": it describes a flowchart's subject;
	 * "jev": Jev narrowed the request to them.
	 */
	readonly cue: "named" | "shaped" | "jev";
}

/**
 * The families an untyped request is about, read from its own words, or
 * undefined when it gives no cue. A request that names several families gets
 * all of them, so the model still chooses between them.
 */
export function routeDiagramFamilies(request: string): DiagramFamilyRoute | undefined {
	const named = DIAGRAM_TYPES.filter((type) => FAMILY_NAMES[type].test(request));
	if (named.length > 0) return { cue: "named", families: named };
	if (FLOWCHART_SHAPED.test(request)) {
		return { cue: "shaped", families: ["flowchart"] };
	}
	return undefined;
}

/** A request the router may narrow: no type, no routed family, and no diagram to revise. */
function isRoutable(request: DiagramGenerationRequest): boolean {
	const { prompt } = request;
	return !prompt.requestedType && !prompt.routedType && !prompt.routedTypes && !prompt.base;
}

/**
 * The request built for `route`: one family's typed prompt, without requiring the type, or a
 * prompt with only a few families' rules. More families than that leave it whole.
 */
function routed(
	request: DiagramGenerationRequest,
	route: DiagramFamilyRoute,
): { readonly request: DiagramGenerationRequest; readonly route?: DiagramFamilyRoute } {
	const [only, ...others] = route.families;
	if (!only || route.families.length > FAMILY_THRESHOLDS.maxFamilies) return { request };
	const prompt =
		others.length === 0
			? { ...request.prompt, routedType: only }
			: { ...request.prompt, routedTypes: route.families };
	return { request: { ...request, prompt }, route };
}

/**
 * The request built for the families its words name, when it names no type and revises no
 * diagram: one family's typed prompt, or a prompt with only the two or three it names. Repairs
 * keep the same families.
 */
export function withFamilyRoute(request: DiagramGenerationRequest): {
	readonly request: DiagramGenerationRequest;
	readonly route?: DiagramFamilyRoute;
} {
	if (!isRoutable(request)) return { request };
	const route = routeDiagramFamilies(request.prompt.request);
	return route ? routed(request, route) : { request };
}

export interface NarrowedFamilyRoute {
	readonly request: DiagramGenerationRequest;
	readonly route?: DiagramFamilyRoute;
	/** What Jev decided, when it was asked. */
	readonly narrowing?: FamilyNarrowing;
}

/**
 * As withFamilyRoute when `narrowing` is not given. With it, a request that names no family is
 * narrowed by Jev, a flowchart-shaped one included: Jev reads such a request better than the
 * shape words do. When Jev leaves it unnarrowed, the prompt carries every family's rules; when
 * Jev fails, the words route it as they would without Jev. What Jev decided comes back with
 * it, for the request's span.
 */
export const withNarrowedFamilyRoute = Effect.fnUntraced(function* (
	request: DiagramGenerationRequest,
	narrowing: DiagramFamilyNarrowing["Service"] | undefined,
): Effect.fn.Return<NarrowedFamilyRoute> {
	if (!narrowing || !isRoutable(request)) return withFamilyRoute(request);
	const byWords = routeDiagramFamilies(request.prompt.request);
	if (byWords?.cue === "named") return routed(request, byWords);
	const narrowed = yield* narrowing.narrow(request.prompt.request);
	switch (narrowed._tag) {
		case "Narrowed":
			return {
				...routed(request, { cue: "jev", families: narrowed.families }),
				narrowing: narrowed,
			};
		case "Unnarrowed":
			return { request, narrowing: narrowed };
		case "Failed":
			return { ...withFamilyRoute(request), narrowing: narrowed };
	}
});
