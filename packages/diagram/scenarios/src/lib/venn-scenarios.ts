import { parseVennDiagram, type VennDiagram, vennRegionKey } from "@sketchi/diagram-core";
import {
	insideClearance,
	outsideClearance,
	readVennScene,
	type RenderedDiagramScene,
	vennLayoutIssues,
	vennTextLineBoxes,
} from "@sketchi/diagram-renderer";

import type { ScenarioCheck } from "./evaluate.js";
import type { DiagramScenarioDifficulty } from "./scenarios.js";

/** A set the prompt names: the labels it may go by. */
export interface VennScenarioSet {
	readonly labels: readonly string[];
}

/** An item the prompt places: the forms it may take and the sets, by key, it lies in. */
export interface VennScenarioItem {
	readonly names: readonly string[];
	readonly sets: readonly string[];
}

export interface VennScenario {
	readonly assertions: {
		readonly sets: Readonly<Record<string, VennScenarioSet>>;
		readonly items: Readonly<Record<string, VennScenarioItem>>;
		/** Set-key combinations the prompt states are empty. */
		readonly emptyRegions: readonly (readonly string[])[];
	};
	readonly description: string;
	readonly diagramType: "venn";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: VennDiagram;
	readonly id: string;
	readonly logos: readonly [];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

/** Labels compare without case, spaces, punctuation or a leading bullet: "Two-step verification" matches "two step verification". */
const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const matchesAny = (found: string | undefined, accepted: readonly string[]) =>
	found !== undefined && accepted.some((value) => key(value) === key(found));
const sameSets = (a: readonly string[], b: readonly (string | undefined)[]) =>
	a.length === b.length && a.every((entry) => b.includes(entry));

/**
 * Venn checks score what the prompt states, each on its own: every set by
 * label, every item present and in exactly its stated combination of sets
 * (in any key order), no unstated set or item and no item in two regions,
 * and every region the prompt states empty holding nothing.
 */
export function vennScenarioChecks(scenario: VennScenario, diagram: VennDiagram): ScenarioCheck[] {
	const { sets, items, emptyRegions } = scenario.assertions;
	// Each stated set, by key, as the diagram's set id that carries its label.
	const setIds = new Map(
		Object.entries(sets).map(([setKey, expected]) => [
			setKey,
			diagram.sets.find((set) => matchesAny(set.label, expected.labels))?.id,
		]),
	);
	const setKeyOf = new Map([...setIds].flatMap(([setKey, id]) => (id ? [[id, setKey]] : [])));
	// Every drawn item with the stated set keys of its region; an unmatched set keeps its id.
	const placed = diagram.regions.flatMap((region) =>
		(region.items ?? []).map((item) => ({
			item,
			sets: region.sets.map((id) => setKeyOf.get(id) ?? `?${id}`),
		})),
	);
	const label = (setKeys: readonly string[]) =>
		setKeys.map((setKey) => sets[setKey]!.labels[0]!).join(" and ");
	const setChecks = Object.entries(sets).map(([setKey, expected]): ScenarioCheck => ({
		id: `set:${setKey}`,
		passed: setIds.get(setKey) !== undefined,
		message: `Expected a set labeled "${expected.labels.join('" or "')}".`,
	}));
	const itemChecks = Object.entries(items).flatMap(([itemKey, expected]): ScenarioCheck[] => {
		const found = placed.filter((entry) => matchesAny(entry.item, expected.names));
		const name = expected.names[0]!;
		return [
			{
				id: `item:${itemKey}`,
				passed: found.length > 0,
				message: `Expected an item "${expected.names.join('" or "')}".`,
			},
			{
				id: `region:${itemKey}`,
				passed: found.length === 1 && sameSets(found[0]!.sets, expected.sets),
				message: `Expected "${name}" once, in ${label(expected.sets)} only${found.length ? `; found in ${found.map((entry) => entry.sets.join("+")).join(", ")}` : ""}.`,
			},
		];
	});
	const stated = Object.values(items);
	const unstated = placed.filter(
		(entry) => !stated.some((expected) => matchesAny(entry.item, expected.names)),
	);
	const emptyChecks = emptyRegions.map((setKeys): ScenarioCheck => {
		const ids = setKeys.map((setKey) => setIds.get(setKey));
		const holding = diagram.regions.filter(
			(region) =>
				ids.every((id) => id !== undefined) &&
				sameSets(region.sets, ids) &&
				((region.items?.length ?? 0) > 0 || (region.count ?? 0) > 0 || region.label !== undefined),
		);
		return {
			id: `empty-region:${setKeys.join("+")}`,
			passed: ids.every((id) => id !== undefined) && holding.length === 0,
			message: `Expected nothing in ${label(setKeys)} only, which the prompt states is empty.`,
		};
	});
	const setCount = Object.keys(sets).length;
	return [
		...setChecks,
		{
			id: "sets-exact",
			passed: diagram.sets.length === setCount,
			message: `Expected exactly ${setCount} sets; found ${diagram.sets.length}.`,
		},
		...itemChecks,
		{
			id: "items-exact",
			passed: unstated.length === 0 && placed.length === stated.length,
			message: `Expected exactly the ${stated.length} stated items, each once; found ${placed.length}${unstated.length ? `, including unstated "${unstated.map((entry) => entry.item).join('", "')}"` : ""}.`,
		},
		...emptyChecks,
	];
}

const flat = (text: string | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();
/** A set label sits no farther than this from its own outline. */
const LABEL_REACH = 40;

/**
 * The drawn scene says what the diagram says: an outline for every set with
 * its label outside it and nearer its own outline than any other, and every
 * item, region label and count drawn once, wholly inside each of its sets and
 * outside every other set.
 */
export function vennDrawnCheck(diagram: VennDiagram, scene: RenderedDiagramScene): ScenarioCheck {
	const problems: string[] = [];
	const readout = readVennScene(scene);
	const circles = readout.sets.map((set) => set.circle);
	diagram.sets.forEach((set, index) => {
		const drawn = readout.sets.find((entry) => entry.index === index);
		if (!drawn) {
			problems.push(`${set.id} outline`);
			return;
		}
		if (flat(drawn.label) !== flat(set.label)) problems.push(`${set.id} label`);
		const label = scene.elements.find((element) => element.id === `venn:set:${index}:label`);
		if (label?.type !== "text") return;
		const reach = circles.map((circle) =>
			Math.min(...vennTextLineBoxes(label).map((box) => outsideClearance(box, circle))),
		);
		const own = reach[index]!;
		if (own < 0 || own > LABEL_REACH || reach.some((other, at) => at !== index && other <= own))
			problems.push(`${set.id} label beside its outline`);
	});
	for (const region of diagram.regions) {
		const key = vennRegionKey(diagram, region);
		const drawn = readout.regions.find((entry) => entry.key.join("+") === key.join("+"));
		const items = region.items ?? [];
		if (
			items.some((item, at) => flat(drawn?.items[at]) !== flat(item)) ||
			(drawn?.items.length ?? 0) !== items.length
		)
			problems.push(`${key.join("+")} items`);
		if (region.label !== undefined && flat(drawn?.label) !== flat(region.label))
			problems.push(`${key.join("+")} label`);
		if ((region.count ?? 0) > 0 && drawn?.count !== region.count!.toLocaleString("en-US"))
			problems.push(`${key.join("+")} count`);
	}
	for (const element of scene.elements) {
		const match = element.type === "text" ? /^venn:region:([\d+]+):/u.exec(element.id) : null;
		if (element.type !== "text" || !match) continue;
		const key = match[1]!.split("+").map(Number);
		const inside = vennTextLineBoxes(element).every((box) =>
			circles.every((circle, index) =>
				key.includes(index) ? insideClearance(box, circle) > 0 : outsideClearance(box, circle) > 0,
			),
		);
		if (!inside) problems.push(`"${flat(element.text)}" outside its region`);
	}
	return {
		id: "venn-drawn",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "Every set outline and label, and every item, is drawn as the diagram states, each item wholly inside exactly its region."
				: `Drawn differently from the diagram: ${problems.slice(0, 8).join(", ")}.`,
	};
}

/** No text overlapping, items clear of every outline by a margin, set labels clear of every circle. */
export function vennLayoutCheck(scene: RenderedDiagramScene): ScenarioCheck {
	const issues = vennLayoutIssues(scene);
	return {
		id: "venn-layout",
		passed: issues.length === 0,
		message:
			issues.length === 0
				? "No text overlaps, every item stands clear of the outlines, and set labels sit clear of every circle."
				: issues
						.slice(0, 6)
						.map((issue) => issue.message)
						.join(" "),
	};
}

type ItemDefinition = readonly [
	/** The item as stated, or every form it may take. */
	names: string | readonly string[],
	/** The set keys it lies in. */
	sets: readonly string[],
];

interface VennScenarioDefinition {
	readonly id: string;
	readonly title: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly tags: readonly string[];
	readonly description: string;
	readonly prompt: string;
	readonly sets: readonly (readonly [key: string, labels: string | readonly string[]])[];
	readonly items: readonly ItemDefinition[];
	readonly emptyRegions?: readonly (readonly string[])[];
}

const list = (value: string | readonly string[]): readonly string[] =>
	typeof value === "string" ? [value] : value;

function defineVennScenario(definition: VennScenarioDefinition): VennScenario {
	const { sets, items, emptyRegions = [], ...scenario } = definition;
	const regions = new Map<string, { sets: string[]; items: string[] }>();
	for (const [names, within] of items) {
		const ordered = sets.map(([setKey]) => setKey).filter((setKey) => within.includes(setKey));
		const region = regions.get(ordered.join("+")) ?? { sets: ordered, items: [] };
		region.items.push(list(names)[0]!);
		regions.set(ordered.join("+"), region);
	}
	return {
		...scenario,
		diagramType: "venn",
		logos: [],
		assertions: {
			sets: Object.fromEntries(sets.map(([setKey, labels]) => [setKey, { labels: list(labels) }])),
			items: Object.fromEntries(
				items.map(([names, within]) => [
					key(list(names)[0]!),
					{ names: list(names), sets: within },
				]),
			),
			emptyRegions,
		},
		expectedDiagram: parseVennDiagram({
			id: definition.id,
			title: definition.title,
			type: "venn",
			sets: sets.map(([id, labels]) => ({ id, label: list(labels)[0] })),
			regions: [...regions.values()],
		}),
	};
}

const vennScenarioDefinitions: readonly VennScenarioDefinition[] = [
	{
		id: "team-skills-venn",
		title: "Team skills",
		difficulty: "standard",
		tags: ["venn", "three-sets", "all-regions"],
		description:
			"The skills Design, Engineering and Product share: three sets with all seven regions filled, 13 items.",
		prompt:
			"Draw a Venn diagram of the skills our Design, Engineering and Product teams share. Design only: Visual design, Illustration. Engineering only: System architecture, Code review. Product only: Pricing, Roadmapping. Design and Engineering only: Prototyping, Accessibility. Design and Product only: User research. Engineering and Product only: Analytics, Technical specs. All three: Problem framing, Stakeholder communication.",
		sets: [
			["design", "Design"],
			["engineering", "Engineering"],
			["product", "Product"],
		],
		items: [
			["Visual design", ["design"]],
			["Illustration", ["design"]],
			["System architecture", ["engineering"]],
			["Code review", ["engineering"]],
			["Pricing", ["product"]],
			["Roadmapping", ["product"]],
			["Prototyping", ["design", "engineering"]],
			["Accessibility", ["design", "engineering"]],
			["User research", ["design", "product"]],
			["Analytics", ["engineering", "product"]],
			[
				["Technical specs", "Technical specifications"],
				["engineering", "product"],
			],
			["Problem framing", ["design", "engineering", "product"]],
			["Stakeholder communication", ["design", "engineering", "product"]],
		],
	},
	{
		id: "plan-features-venn",
		title: "Plan features",
		difficulty: "challenge",
		tags: ["venn", "three-sets", "dense-center", "long-items", "empty-region"],
		description:
			"Features across Personal, Business and Education plans: 20 items, seven in the central region, long items, and one region stated empty.",
		prompt:
			"Draw a Venn diagram of the features in our three plans: Personal, Business and Education. Personal only: Family sharing for up to six people, Personal vault. Business only: SAML single sign-on, Audit logs with 1-year retention, Admin console, Data residency in the EU or US, 99.9% uptime SLA. Education only: Classroom rosters, Student privacy controls. Personal and Business only: Priority email support. Business and Education only: Domain verification, Shared drives, Device management. All three plans: Unlimited documents, Real-time collaboration, Version history, Offline mode, Two-step verification, Comment threads, Mobile apps. No feature is in Personal and Education only.",
		sets: [
			["personal", "Personal"],
			["business", "Business"],
			["education", "Education"],
		],
		items: [
			["Family sharing for up to six people", ["personal"]],
			["Personal vault", ["personal"]],
			[["SAML single sign-on", "SAML SSO"], ["business"]],
			["Audit logs with 1-year retention", ["business"]],
			["Admin console", ["business"]],
			["Data residency in the EU or US", ["business"]],
			["99.9% uptime SLA", ["business"]],
			["Classroom rosters", ["education"]],
			["Student privacy controls", ["education"]],
			["Priority email support", ["personal", "business"]],
			["Domain verification", ["business", "education"]],
			["Shared drives", ["business", "education"]],
			["Device management", ["business", "education"]],
			["Unlimited documents", ["personal", "business", "education"]],
			[
				["Real-time collaboration", "Realtime collaboration"],
				["personal", "business", "education"],
			],
			["Version history", ["personal", "business", "education"]],
			["Offline mode", ["personal", "business", "education"]],
			[
				["Two-step verification", "2-step verification"],
				["personal", "business", "education"],
			],
			["Comment threads", ["personal", "business", "education"]],
			["Mobile apps", ["personal", "business", "education"]],
		],
		emptyRegions: [["personal", "education"]],
	},
	{
		id: "ios-android-venn",
		title: "Mobile app platform support",
		difficulty: "smoke",
		tags: ["venn", "two-sets"],
		description: "What a mobile app supports on iOS, on Android and on both: two sets, 10 items.",
		prompt:
			"Draw a two-set Venn diagram of what our mobile app supports on iOS and Android. iOS only: Live Activities, Apple Pay, Siri Shortcuts. Android only: Google Pay, Home screen widgets, Sideloaded beta builds. Both: Push notifications, Offline mode, Biometric sign-in, Dark mode.",
		sets: [
			["ios", "iOS"],
			["android", "Android"],
		],
		items: [
			["Live Activities", ["ios"]],
			["Apple Pay", ["ios"]],
			["Siri Shortcuts", ["ios"]],
			["Google Pay", ["android"]],
			["Home screen widgets", ["android"]],
			["Sideloaded beta builds", ["android"]],
			["Push notifications", ["ios", "android"]],
			["Offline mode", ["ios", "android"]],
			["Biometric sign-in", ["ios", "android"]],
			["Dark mode", ["ios", "android"]],
		],
	},
];

export const vennScenarios: readonly VennScenario[] =
	vennScenarioDefinitions.map(defineVennScenario);
