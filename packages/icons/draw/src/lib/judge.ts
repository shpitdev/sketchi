import { fnv1a32 } from "@sketchi/diagram-core";

/**
 * The judge: a model from another family, shown only the 28 px drawing and
 * five logos, picks the one it depicts. The other four are the catalog marks
 * the source most resembles in color and shape, so a pass means the drawing
 * tells the mark apart from its neighbours, not just that it is some logo.
 */

export const JUDGE_LOOK_ALIKES = 4;

export const JUDGE_PROMPT = [
	"The first image is a small hand-drawn sketch of a logo. The five images after it are logos, numbered 1 to 5.",
	"Exactly one of them is the logo the sketch depicts. Which one?",
	'Reply with JSON only: {"logo": <number 1-5>}.',
].join("\n");

export const JUDGE_REPLY_SCHEMA = {
	type: "OBJECT",
	properties: { logo: { type: "INTEGER" } },
	required: ["logo"],
} as const;

/** One logo the judge is shown: the source, or a catalog look-alike by slug. */
export type JudgeCandidate =
	| { readonly kind: "source" }
	| { readonly kind: "catalog"; readonly slug: string };

/**
 * The source among its look-alikes, in an order fixed by the request, so the
 * source's position varies between logos but a retry shows the same lineup.
 */
export function judgeLineup(seed: string, lookAlikes: readonly string[]): JudgeCandidate[] {
	const lineup: JudgeCandidate[] = [
		{ kind: "source" },
		...lookAlikes.map((slug): JudgeCandidate => ({ kind: "catalog", slug })),
	];
	return lineup
		.map((candidate) => ({
			candidate,
			key: fnv1a32(`${seed}:${candidate.kind === "source" ? "" : candidate.slug}`, "seed"),
		}))
		.sort((left, right) => left.key - right.key)
		.map(({ candidate }) => candidate);
}

/** The logo number in a judge reply, or undefined when there is none in range. */
export function decodeJudgeReply(text: string, count: number): number | undefined {
	const fromJson = (() => {
		try {
			const value = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as unknown;
			return typeof value === "object" && value !== null && "logo" in value
				? Number(value.logo)
				: undefined;
		} catch {
			return undefined;
		}
	})();
	const picked = fromJson ?? Number(/\b([1-9])\b/u.exec(text)?.[1]);
	return Number.isInteger(picked) && picked >= 1 && picked <= count ? picked : undefined;
}

export interface IconJudgeVerdict {
	/** True when the judge picked the source out of the lineup. */
	readonly recognizable: boolean;
	/** `source`, a look-alike's catalog slug, or undefined when the judge gave no answer. */
	readonly picked?: string;
	/** The lineup as shown, `source` among catalog slugs. */
	readonly lineup: readonly string[];
	readonly model: string;
	/** How many times the drawing was judged; a second time follows one revision. */
	readonly attempts: number;
	/** Why the judge gave no verdict, when its call failed. */
	readonly error?: string;
}
