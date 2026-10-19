import {
	type MindmapDiagram,
	type MindmapTopicTree,
	mindmapDiagramFromTree,
} from "@sketchi/diagram-core";
import { mindmapLayoutIssues, type RenderedDiagramScene } from "@sketchi/diagram-renderer";

import type { ScenarioCheck } from "./evaluate.js";
import type { DiagramScenarioDifficulty } from "./scenarios.js";

/**
 * A topic the prompt states, with any-of label alternatives made of its words,
 * and the key of the topic it sits under (none for the central topic).
 */
export interface MindmapScenarioTopic {
	readonly labels: readonly string[];
	readonly parent?: string;
}

export interface MindmapScenario {
	readonly assertions: {
		/** The key of the central topic. */
		readonly root: string;
		/** Every stated topic, parents before their children. */
		readonly topics: Readonly<Record<string, MindmapScenarioTopic>>;
	};
	readonly description: string;
	readonly diagramType: "mindmap";
	readonly difficulty: DiagramScenarioDifficulty;
	readonly expectedDiagram: MindmapDiagram;
	readonly id: string;
	readonly logos: readonly [];
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly title: string;
}

function tokens(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/**
 * A stated word appears as a word, or as its start when it has four letters or
 * more; a shorter one also takes a plural `-s`/`-es` ("ant" matches "Ants",
 * "CNN" matches "CNNs", but "ant" never matches "antelope").
 */
function wordMatches(expected: string, word: string): boolean {
	return (
		word === expected ||
		word === `${expected}s` ||
		word === `${expected}es` ||
		(expected.length >= 4 && word.startsWith(expected))
	);
}

/** How closely a label matches an alternative, by the share of its words the alternative covers; 0 when it doesn't. */
function matchScore(label: string, alternative: string): number {
	const words = tokens(label);
	const expected = tokens(alternative);
	if (expected.length === 0) return 0;
	return expected.every((token) => words.some((word) => wordMatches(token, word)))
		? expected.length / Math.max(words.length, 1)
		: 0;
}

function bestScore(label: string, alternatives: readonly string[]): number {
	return Math.max(0, ...alternatives.map((alternative) => matchScore(label, alternative)));
}

/** True when every word of every alternative appears in `text`, so checks stay grounded in the prompt. */
export function mindmapAlternativesGrounded(
	text: string,
	alternatives: readonly string[],
): boolean {
	const words = tokens(text);
	return alternatives.every((alternative) =>
		tokens(alternative).every((token) => words.some((word) => wordMatches(token, word))),
	);
}

/**
 * Match the drawn topics to the stated ones, top down: the central topic takes
 * the root, then each stated topic, in order, takes the unclaimed drawn topic
 * that best matches its words, preferring one under the topic its parent took,
 * then the tightest match, then the first drawn.
 */
function assignTopics(
	scenario: MindmapScenario,
	diagram: MindmapDiagram,
): ReadonlyMap<string, string> {
	const parentOf = new Map(diagram.edges.map((edge) => [edge.target, edge.source]));
	const root = diagram.nodes.find((node) => node.kind === "root");
	const assigned = new Map<string, string>();
	const claimed = new Set<string>();
	const { topics } = scenario.assertions;
	for (const [key, topic] of Object.entries(topics)) {
		// The central topic is the root, whatever it says; the root check reads its label.
		if (topic.parent === undefined) {
			if (root) {
				assigned.set(key, root.id);
				claimed.add(root.id);
			}
			continue;
		}
		const parent = assigned.get(topic.parent);
		const candidates = diagram.nodes
			.filter((node) => node.kind !== "root" && !claimed.has(node.id))
			.map((node, order) => ({
				id: node.id,
				order,
				placed: parent !== undefined && parentOf.get(node.id) === parent,
				score: bestScore(node.label, topic.labels),
			}))
			.filter((candidate) => candidate.score > 0)
			.toSorted(
				(a, b) => Number(b.placed) - Number(a.placed) || b.score - a.score || a.order - b.order,
			);
		const best = candidates[0];
		if (best) {
			assigned.set(key, best.id);
			claimed.add(best.id);
		}
	}
	return assigned;
}

/**
 * Mindmap checks score what the prompt states: the central topic, every
 * stated topic under its stated parent, and no topic the prompt never states
 * (a stated topic drawn twice counts as invented the second time).
 */
export function mindmapScenarioChecks(
	scenario: MindmapScenario,
	diagram: MindmapDiagram,
): ScenarioCheck[] {
	const { root, topics } = scenario.assertions;
	const assigned = assignTopics(scenario, diagram);
	const parentOf = new Map(diagram.edges.map((edge) => [edge.target, edge.source]));
	const labelOf = new Map(diagram.nodes.map((node) => [node.id, node.label]));
	const describe = (key: string) => topics[key]!.labels.join("|");
	const invented = diagram.nodes.filter((node) => ![...assigned.values()].includes(node.id));
	return [
		{
			id: "root",
			passed: bestScore(labelOf.get(assigned.get(root) ?? "") ?? "", topics[root]!.labels) > 0,
			message: `Expected the central topic to be "${describe(root)}".`,
		},
		...Object.entries(topics).flatMap(([key, topic]): ScenarioCheck[] =>
			topic.parent === undefined
				? []
				: [
						{
							id: `topic:${key}`,
							passed: assigned.has(key),
							message: `Expected a topic like "${describe(key)}".`,
						},
						{
							id: `topic-parent:${key}`,
							passed:
								assigned.has(key) &&
								assigned.get(topic.parent) !== undefined &&
								parentOf.get(assigned.get(key)!) === assigned.get(topic.parent),
							message: `Expected "${describe(key)}" under "${describe(topic.parent)}"${
								assigned.has(key)
									? `; it is under "${labelOf.get(parentOf.get(assigned.get(key)!) ?? "") ?? "nothing"}"`
									: ""
							}.`,
						},
					],
		),
		{
			id: "no-invented-topics",
			passed: invented.length === 0,
			message:
				invented.length === 0
					? "Every topic is one the prompt states, drawn once."
					: `Topics the prompt does not state: ${invented.map((node) => `"${node.label}"`).join(", ")}.`,
		},
	];
}

/** The drawn map reads: topics clear of each other, no crossing curves, no curve through a topic. */
export function mindmapLayoutCheck(scene: RenderedDiagramScene): ScenarioCheck {
	const issues = mindmapLayoutIssues(scene);
	return {
		id: "mindmap-layout",
		passed: issues.length === 0,
		message:
			issues.length === 0
				? "Topics stay clear of each other and of every curve, and no curves cross."
				: issues.map((issue) => issue.message).join(" "),
	};
}

/**
 * A stated topic: its drawn label, any-of alternatives (its drawn label's
 * words by default), and its children in prompt order.
 */
interface TopicDefinition {
	readonly label: string;
	readonly labels?: readonly string[];
	readonly children?: readonly TopicDefinition[];
}

function topic(
	label: string,
	labels?: readonly string[],
	children?: readonly TopicDefinition[],
): TopicDefinition {
	return { label, ...(labels ? { labels } : {}), ...(children ? { children } : {}) };
}

interface MindmapScenarioDefinition {
	readonly id: string;
	readonly title: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly tags: readonly string[];
	readonly description: string;
	readonly prompt: string;
	readonly root: TopicDefinition;
}

function keyOf(label: string): string {
	return tokens(label).join("-");
}

function defineMindmapScenario(definition: MindmapScenarioDefinition): MindmapScenario {
	const { root, ...scenario } = definition;
	const topics: Record<string, MindmapScenarioTopic> = {};
	const visit = (entry: TopicDefinition, parent?: string) => {
		const key = keyOf(entry.label);
		if (Object.hasOwn(topics, key))
			throw new Error(`Duplicate topic key "${key}" in ${definition.id}.`);
		topics[key] = {
			labels: entry.labels ?? [entry.label.toLowerCase()],
			...(parent === undefined ? {} : { parent }),
		};
		for (const child of entry.children ?? []) visit(child, key);
	};
	visit(root);
	const tree = (entry: TopicDefinition): MindmapTopicTree => ({
		label: entry.label,
		...(entry.children ? { children: entry.children.map(tree) } : {}),
	});
	return {
		...scenario,
		diagramType: "mindmap",
		logos: [],
		assertions: { root: keyOf(root.label), topics },
		expectedDiagram: mindmapDiagramFromTree({
			id: definition.id,
			title: definition.title,
			root: tree(root),
		}),
	};
}

const mindmapScenarioDefinitions: readonly MindmapScenarioDefinition[] = [
	{
		id: "team-offsite-mindmap",
		title: "Team offsite",
		difficulty: "smoke",
		tags: ["mindmap", "brainstorm", "small"],
		description: "A small brainstorm: four branches of two or three ideas each.",
		prompt:
			"Brainstorm our team offsite as a mindmap. The central topic is Team offsite, with four branches: Location (Mountain lodge, City hotel), Activities (Hiking, Cooking class, Board games), Food (Catering, Group dinner) and Budget (Travel costs, Venue deposit). Use only these topics.",
		root: topic(
			"Team offsite",
			["offsite"],
			[
				topic(
					"Location",
					["location"],
					[topic("Mountain lodge", ["lodge"]), topic("City hotel", ["hotel"])],
				),
				topic(
					"Activities",
					["activit"],
					[
						topic("Hiking", ["hiking"]),
						topic("Cooking class", ["cooking"]),
						topic("Board games", ["board game"]),
					],
				),
				topic(
					"Food",
					["food"],
					[topic("Catering", ["catering"]), topic("Group dinner", ["dinner"])],
				),
				topic(
					"Budget",
					["budget"],
					[topic("Travel costs", ["travel"]), topic("Venue deposit", ["deposit"])],
				),
			],
		),
	},
	{
		id: "photosynthesis-study-mindmap",
		title: "Photosynthesis",
		difficulty: "standard",
		tags: ["mindmap", "study-notes", "three-levels"],
		description:
			"Study notes three levels deep, with grouping topics (Inputs, Outputs, Steps) between a branch and its details.",
		prompt:
			"Turn my biology study notes into a mindmap. The central topic is Photosynthesis, with three branches. Light reactions has Thylakoid membrane, Inputs (Water, Sunlight) and Outputs (ATP, NADPH, Oxygen). Calvin cycle has Stroma, Steps (Carbon fixation, Reduction, Regeneration) and Product (Glucose). Limiting factors has Light intensity, Carbon dioxide and Temperature. Use only these topics.",
		root: topic(
			"Photosynthesis",
			["photosynthesis"],
			[
				topic(
					"Light reactions",
					["light reaction"],
					[
						topic("Thylakoid membrane", ["thylakoid"]),
						topic(
							"Inputs",
							["input"],
							[topic("Water", ["water"]), topic("Sunlight", ["sunlight"])],
						),
						topic(
							"Outputs",
							["output"],
							[topic("ATP", ["atp"]), topic("NADPH", ["nadph"]), topic("Oxygen", ["oxygen"])],
						),
					],
				),
				topic(
					"Calvin cycle",
					["calvin"],
					[
						topic("Stroma", ["stroma"]),
						topic(
							"Steps",
							["step"],
							[
								topic("Carbon fixation", ["fixation"]),
								topic("Reduction", ["reduction"]),
								topic("Regeneration", ["regeneration"]),
							],
						),
						topic("Product", ["product"], [topic("Glucose", ["glucose"])]),
					],
				),
				topic(
					"Limiting factors",
					["limiting"],
					[
						topic("Light intensity", ["intensity"]),
						topic("Carbon dioxide", ["carbon dioxide"]),
						topic("Temperature", ["temperature"]),
					],
				),
			],
		),
	},
	{
		id: "app-launch-planning-mindmap",
		title: "App launch",
		difficulty: "standard",
		tags: ["mindmap", "product-planning", "wide"],
		description: "Product planning with seven main branches around the center.",
		prompt:
			"Plan the launch of our budgeting app as a mindmap. The central topic is App launch, with seven branches: Goals (10k signups, 4-star rating), Features (Shared budgets, Bank sync, Spending alerts), Design (Onboarding flow, Dark mode), Engineering (Load testing, Crash reporting), Marketing (Launch video, Influencer outreach, Press kit), Support (Help center, In-app chat) and Risks (Bank API limits, App review delays). Use only these topics.",
		root: topic(
			"App launch",
			["app launch", "launch plan"],
			[
				topic(
					"Goals",
					["goal"],
					[topic("10k signups", ["signup"]), topic("4-star rating", ["rating"])],
				),
				topic(
					"Features",
					["feature"],
					[
						topic("Shared budgets", ["shared budget"]),
						topic("Bank sync", ["sync"]),
						topic("Spending alerts", ["alert"]),
					],
				),
				topic(
					"Design",
					["design"],
					[topic("Onboarding flow", ["onboarding"]), topic("Dark mode", ["dark mode"])],
				),
				topic(
					"Engineering",
					["engineering"],
					[topic("Load testing", ["load test"]), topic("Crash reporting", ["crash"])],
				),
				topic(
					"Marketing",
					["marketing"],
					[
						topic("Launch video", ["video"]),
						topic("Influencer outreach", ["influencer"]),
						topic("Press kit", ["press"]),
					],
				),
				topic(
					"Support",
					["support"],
					[topic("Help center", ["help"]), topic("In-app chat", ["chat"])],
				),
				topic(
					"Risks",
					["risk"],
					[
						topic("Bank API limits", ["api limit"]),
						topic("App review delays", ["review delay", "app review"]),
					],
				),
			],
		),
	},
	{
		id: "ml-roadmap-mindmap",
		title: "Machine learning roadmap",
		difficulty: "challenge",
		tags: ["mindmap", "large", "three-levels"],
		description:
			"A 41-topic study roadmap: seven branches, two with grouping topics, and labels that share words (four kinds of regression).",
		prompt:
			"Map my machine learning study roadmap as a mindmap. The central topic is Machine learning, with seven branches. Math foundations: Linear algebra, Calculus, Probability, Statistics. Programming: Python, NumPy, Pandas, Scikit-learn, Jupyter notebooks. Supervised learning: Regression (Linear regression, Ridge regression) and Classification (Logistic regression, Decision trees, Support vector machines). Unsupervised learning: Clustering (K-means, DBSCAN) and Dimensionality reduction (PCA, t-SNE). Deep learning: Neural networks, CNNs, Transformers and Training tricks (Dropout, Batch normalization). Projects: House price predictor, Spam filter, Image classifier. Deployment: Model serving, Monitoring. Use only these topics.",
		root: topic(
			"Machine learning",
			["machine learning"],
			[
				topic(
					"Math foundations",
					["math"],
					[
						topic("Linear algebra", ["algebra"]),
						topic("Calculus", ["calculus"]),
						topic("Probability", ["probabilit"]),
						topic("Statistics", ["statistic"]),
					],
				),
				topic(
					"Programming",
					["programming"],
					[
						topic("Python", ["python"]),
						topic("NumPy", ["numpy"]),
						topic("Pandas", ["pandas"]),
						topic("Scikit-learn", ["scikit"]),
						topic("Jupyter notebooks", ["jupyter"]),
					],
				),
				topic(
					"Supervised learning",
					["supervised"],
					[
						topic(
							"Regression",
							["regression"],
							[
								topic("Linear regression", ["linear regression"]),
								topic("Ridge regression", ["ridge"]),
							],
						),
						topic(
							"Classification",
							["classification"],
							[
								topic("Logistic regression", ["logistic"]),
								topic("Decision trees", ["decision tree"]),
								topic("Support vector machines", ["support vector"]),
							],
						),
					],
				),
				topic(
					"Unsupervised learning",
					["unsupervised"],
					[
						topic(
							"Clustering",
							["cluster"],
							[topic("K-means", ["k means"]), topic("DBSCAN", ["dbscan"])],
						),
						topic(
							"Dimensionality reduction",
							["dimensionality"],
							[topic("PCA", ["pca"]), topic("t-SNE", ["t sne"])],
						),
					],
				),
				topic(
					"Deep learning",
					["deep learning"],
					[
						topic("Neural networks", ["neural network"]),
						topic("CNNs", ["cnn"]),
						topic("Transformers", ["transformer"]),
						topic(
							"Training tricks",
							["trick"],
							[topic("Dropout", ["dropout"]), topic("Batch normalization", ["batch norm"])],
						),
					],
				),
				topic(
					"Projects",
					["project"],
					[
						topic("House price predictor", ["house price"]),
						topic("Spam filter", ["spam"]),
						topic("Image classifier", ["image"]),
					],
				),
				topic(
					"Deployment",
					["deploy"],
					[topic("Model serving", ["serving"]), topic("Monitoring", ["monitor"])],
				),
			],
		),
	},
	{
		id: "animal-kingdom-mindmap",
		title: "Animal kingdom",
		difficulty: "challenge",
		tags: ["mindmap", "large", "deep", "five-levels"],
		description: "A 42-topic classification five levels deep under two very uneven branches.",
		prompt:
			"Draw part of the animal kingdom as a mindmap. The central topic is Animals, with two branches, Vertebrates and Invertebrates. Vertebrates: Mammals, Birds, Reptiles, Amphibians, Fish. Mammals: Primates, Carnivores, Whales. Primates: Great apes (Gorillas, Chimpanzees) and Monkeys. Carnivores: Big cats (Lions, Tigers) and Bears. Birds: Raptors (Eagles, Owls) and Songbirds. Reptiles: Snakes, Lizards. Amphibians: Frogs, Salamanders. Fish: Sharks, Salmon. Invertebrates: Insects (Beetles, Butterflies, Ants), Mollusks (Octopuses, Snails), Arachnids (Spiders, Scorpions) and Crustaceans (Crabs, Lobsters). Use only these topics.",
		root: topic(
			"Animals",
			["animal"],
			[
				topic(
					"Vertebrates",
					["vertebrate"],
					[
						topic(
							"Mammals",
							["mammal"],
							[
								topic(
									"Primates",
									["primate"],
									[
										topic(
											"Great apes",
											["great ape"],
											[topic("Gorillas", ["gorilla"]), topic("Chimpanzees", ["chimpanzee"])],
										),
										topic("Monkeys", ["monkey"]),
									],
								),
								topic(
									"Carnivores",
									["carnivore"],
									[
										topic(
											"Big cats",
											["big cat"],
											[topic("Lions", ["lion"]), topic("Tigers", ["tiger"])],
										),
										topic("Bears", ["bear"]),
									],
								),
								topic("Whales", ["whale"]),
							],
						),
						topic(
							"Birds",
							["bird"],
							[
								topic("Raptors", ["raptor"], [topic("Eagles", ["eagle"]), topic("Owls", ["owl"])]),
								topic("Songbirds", ["songbird"]),
							],
						),
						topic(
							"Reptiles",
							["reptile"],
							[topic("Snakes", ["snake"]), topic("Lizards", ["lizard"])],
						),
						topic(
							"Amphibians",
							["amphibian"],
							[topic("Frogs", ["frog"]), topic("Salamanders", ["salamander"])],
						),
						topic("Fish", ["fish"], [topic("Sharks", ["shark"]), topic("Salmon", ["salmon"])]),
					],
				),
				topic(
					"Invertebrates",
					["invertebrate"],
					[
						topic(
							"Insects",
							["insect"],
							[
								topic("Beetles", ["beetle"]),
								topic("Butterflies", ["butterfl"]),
								topic("Ants", ["ant"]),
							],
						),
						topic(
							"Mollusks",
							["mollus"],
							[topic("Octopuses", ["octopus"]), topic("Snails", ["snail"])],
						),
						topic(
							"Arachnids",
							["arachnid"],
							[topic("Spiders", ["spider"]), topic("Scorpions", ["scorpion"])],
						),
						topic(
							"Crustaceans",
							["crustacean"],
							[topic("Crabs", ["crab"]), topic("Lobsters", ["lobster"])],
						),
					],
				),
			],
		),
	},
];

export const mindmapScenarios: readonly MindmapScenario[] =
	mindmapScenarioDefinitions.map(defineMindmapScenario);
