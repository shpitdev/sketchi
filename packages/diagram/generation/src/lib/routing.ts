import { DIAGRAM_TYPES, type DiagramTypeValue } from "@sketchi/diagram-core";
import { Effect } from "effect";

import type { DiagramGenerationRequest } from "./candidates.js";
import type { DiagramFamilyNarrowing, FamilyNarrowing } from "./family-narrowing.js";

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
	/** The one family whose rules the prompt carries. */
	readonly family: DiagramTypeValue;
	/**
	 * "named": the request names it; "shaped": it describes a flowchart's subject; "jev": Jev's
	 * answers decided it.
	 */
	readonly cue: "named" | "shaped" | "jev";
}

/** The families an untyped request names outright, in registry order. */
export function namedDiagramFamilies(request: string): DiagramTypeValue[] {
	return DIAGRAM_TYPES.filter((type) => FAMILY_NAMES[type].test(request));
}

/**
 * The family an untyped request's own words settle: the one family it names, or a flowchart
 * when it names none and describes a process, a pipeline or an architecture. Undefined when its
 * words name several families, or give no cue.
 */
export function routeDiagramFamily(request: string): DiagramFamilyRoute | undefined {
	const named = namedDiagramFamilies(request);
	if (named.length === 1 && named[0]) return { cue: "named", family: named[0] };
	if (named.length === 0 && FLOWCHART_SHAPED.test(request)) {
		return { cue: "shaped", family: "flowchart" };
	}
	return undefined;
}

/** A request the router may route: no type, no routed family, and no diagram to revise. */
function isRoutable(request: DiagramGenerationRequest): boolean {
	const { prompt } = request;
	return !prompt.requestedType && !prompt.routedType && !prompt.base;
}

/** The request built as `route`'s family's typed prompt, without requiring the type. */
function routed(
	request: DiagramGenerationRequest,
	route: DiagramFamilyRoute,
): { readonly request: DiagramGenerationRequest; readonly route: DiagramFamilyRoute } {
	return {
		request: { ...request, prompt: { ...request.prompt, routedType: route.family } },
		route,
	};
}

/**
 * The request built for the family its words settle, when it names no type and revises no
 * diagram: that family's typed prompt. Otherwise the request as it is, with every family's
 * rules. Repairs keep the same family.
 */
export function withFamilyRoute(request: DiagramGenerationRequest): {
	readonly request: DiagramGenerationRequest;
	readonly route?: DiagramFamilyRoute;
} {
	if (!isRoutable(request)) return { request };
	const route = routeDiagramFamily(request.prompt.request);
	return route ? routed(request, route) : { request };
}

export interface NarrowedFamilyRoute {
	readonly request: DiagramGenerationRequest;
	readonly route?: DiagramFamilyRoute;
	/** What Jev decided, when it was asked. */
	readonly narrowing?: FamilyNarrowing;
}

/**
 * As withFamilyRoute when `narrowing` is not given. With it, the family is decided in code: a
 * request that names one family gets it, and Jev's answers decide every other one's, among the
 * families it names when it names several, a flowchart-shaped one included, since Jev reads such
 * a request better than the shape words do. The generation model chooses only when Jev finds
 * that no kind fits, with every family's rules, or when Jev fails, as the words alone would
 * route it. What Jev decided comes back with it, for the request's span.
 */
export const withNarrowedFamilyRoute = Effect.fnUntraced(function* (
	request: DiagramGenerationRequest,
	narrowing: DiagramFamilyNarrowing["Service"] | undefined,
): Effect.fn.Return<NarrowedFamilyRoute> {
	if (!narrowing || !isRoutable(request)) return withFamilyRoute(request);
	const named = namedDiagramFamilies(request.prompt.request);
	if (named.length === 1 && named[0]) return routed(request, { cue: "named", family: named[0] });
	const narrowed = yield* narrowing.narrow(
		request.prompt.request,
		named.length > 1 ? named : undefined,
	);
	switch (narrowed._tag) {
		case "Decided":
			return {
				...routed(request, { cue: "jev", family: narrowed.family }),
				narrowing: narrowed,
			};
		case "Undecided":
			return { request, narrowing: narrowed };
		case "Failed":
			return { ...withFamilyRoute(request), narrowing: narrowed };
	}
});
