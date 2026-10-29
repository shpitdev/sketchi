import { parseVennDiagram, type VennDiagram } from "./types/venn.js";

/** Venn diagrams that stress the layout: heavy regions, counts, long and non-Latin text. */
export const vennStressFixtures = {
	/** Two sets, every region listed, the overlap labeled. */
	twoSets: parseVennDiagram({
		id: "ios-android",
		title: "iOS vs Android",
		type: "venn",
		sets: [
			{ id: "ios", label: "iOS" },
			{ id: "android", label: "Android" },
		],
		regions: [
			{ sets: ["ios"], items: ["iMessage", "AirDrop", "Face ID", "Apple Pay"] },
			{
				sets: ["android"],
				items: ["Custom launchers", "Sideloading apps", "Expandable storage", "Google Assistant"],
			},
			{
				sets: ["ios", "android"],
				label: "Both",
				items: ["Push notifications", "Biometric unlock", "App stores", "Dark mode", "Widgets"],
			},
		],
	}),
	/** Twelve items in the middle of three sets. */
	heavyCenter: parseVennDiagram({
		id: "heavy-center",
		title: "Features in every plan",
		type: "venn",
		sets: [
			{ id: "starter", label: "Starter" },
			{ id: "team", label: "Team" },
			{ id: "business", label: "Business" },
		],
		regions: [
			{
				sets: ["starter", "team", "business"],
				label: "Every plan",
				items: [
					"Single sign-on",
					"Audit logs",
					"Role-based access",
					"API access",
					"Webhooks",
					"Custom domains",
					"Usage analytics",
					"Priority support",
					"Data export",
					"Two-factor auth",
					"Team workspaces",
					"Version history",
				],
			},
		],
	}),
	/** Twelve items in the overlap of two sets, one in each side. */
	heavyLens: parseVennDiagram({
		id: "heavy-lens",
		title: "Python and JavaScript",
		type: "venn",
		sets: [
			{ id: "python", label: "Python" },
			{ id: "javascript", label: "JavaScript" },
		],
		regions: [
			{ sets: ["python"], items: ["NumPy"] },
			{ sets: ["javascript"], items: ["DOM"] },
			{
				sets: ["python", "javascript"],
				items: [
					"Dynamic typing",
					"First-class functions",
					"Garbage collection",
					"Package managers",
					"REPL",
					"Closures",
					"Async/await",
					"Generators",
					"Decorator-like syntax",
					"Huge ecosystems",
					"Interpreted",
					"Popular in teaching",
				],
			},
		],
	}),
	/** Long items in each set alone, custom colors including a dark one. */
	heavySingles: parseVennDiagram({
		id: "heavy-singles",
		title: "Plan tiers",
		type: "venn",
		sets: [
			{ id: "basic", label: "Basic", color: "violet" },
			{ id: "pro", label: "Pro", color: "pink" },
			{ id: "enterprise", label: "Enterprise", color: "#222222" },
		],
		regions: [
			{
				sets: ["basic"],
				items: [
					"Community forum access for every member of the workspace",
					"Basic templates",
					"Email support within two business days",
					"Five projects",
				],
			},
			{
				sets: ["pro"],
				items: [
					"Unlimited projects",
					"Advanced analytics dashboards",
					"Custom branding on shared pages",
					"Priority email support",
				],
			},
			{
				sets: ["enterprise"],
				items: [
					"Dedicated success manager",
					"SAML single sign-on",
					"Custom contracts and invoicing",
					"99.99% uptime SLA",
					"Audit log export",
				],
			},
			{ sets: ["basic", "pro", "enterprise"], items: ["Mobile apps"] },
		],
	}),
	/** Counts instead of items, and set labels at their 40-character limit. */
	counts: parseVennDiagram({
		id: "counts",
		title: "On-call coverage",
		type: "venn",
		sets: [
			{ id: "support", label: "Customer success and support operations" },
			{ id: "platform", label: "Platform infrastructure engineering" },
		],
		regions: [
			{ sets: ["support"], count: 1204 },
			{ sets: ["platform"], count: 87 },
			{ sets: ["support", "platform"], label: "Shared on-call rotation", count: 12 },
		],
	}),
	/** Three sets and nothing in them. */
	empty: parseVennDiagram({
		id: "empty",
		title: "Pets",
		type: "venn",
		sets: [
			{ id: "cats", label: "Cats" },
			{ id: "dogs", label: "Dogs" },
			{ id: "birds", label: "Birds" },
		],
	}),
	/** Wide glyphs in every region. */
	cjk: parseVennDiagram({
		id: "cjk",
		title: "East Asian scripts",
		type: "venn",
		sets: [
			{ id: "ja", label: "日本語" },
			{ id: "zh", label: "中文" },
			{ id: "ko", label: "한국어" },
		],
		regions: [
			{ sets: ["ja"], items: ["ひらがな", "カタカナ"] },
			{ sets: ["zh"], items: ["简体字"] },
			{ sets: ["ko"], items: ["한글"] },
			{ sets: ["ja", "zh"], items: ["漢字"] },
			{ sets: ["ja", "ko"], items: ["敬語 honorifics"] },
			{ sets: ["zh", "ko"], items: ["声调"] },
			{ sets: ["ja", "zh", "ko"], items: ["東アジア"] },
		],
	}),
} satisfies Record<string, VennDiagram>;
