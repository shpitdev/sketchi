import { type IconColor, isIconColor } from "./color-mode.js";
import type { IconManifest, SketchiIcon, SketchiIconViewBox } from "./manifest.js";

interface SourceIcon {
	readonly baseSlug?: string;
	readonly bytes: number;
	/** Measured from the SVG by the generator, which adds it to the pipeline record. */
	readonly color: IconColor;
	readonly collection: string;
	readonly slug: string;
	readonly urlPath: string;
	readonly variant?: string | null;
	readonly viewBox: SketchiIconViewBox;
}

interface SourceData {
	readonly generatedAt?: string;
	readonly icons: readonly SourceIcon[];
}

export interface GeneratedIconCatalog {
	readonly manifest: IconManifest;
	readonly sources: Readonly<Record<string, string>>;
}

export const COLLISION_CANONICAL_COLLECTIONS: Readonly<Record<string, string>> = {
	aihubmix: "ai-ecosystem",
	amp: "ai-apps-agents",
	anthos: "gcp",
	"cloud-run": "gcp",
	"cloud-spanner": "gcp",
	"cloud-sql": "gcp",
	"cloud-storage": "gcp",
	"compute-engine": "gcp",
	looker: "gcp",
	"security-command-center": "gcp",
	vertexai: "ai-infrastructure",
};

const ALIASES_BY_BASE_SLUG: Readonly<Record<string, readonly string[]>> = {
	"agent-studio-app": ["agent studio"],
	"ai-fde-app": ["AI forward deployed engineer"],
	"aip-autopilot-app": ["AIP Autopilot", "autopilot workbench"],
	"aip-showcase": ["AIP showcase", "build with aip"],
	"automation-app": ["object monitor", "object-monitor"],
	aws: ["amazon", "amazon web services"],
	azure: ["microsoft azure"],
	bedrock: ["amazon bedrock", "aws bedrock"],
	"code-app": ["code repository", "code-repository", "python repository", "typescript repository"],
	"code-workspace-jupyter-app": ["code workspace", "code-workspace-jupyter", "jupyter notebook"],
	"code-workspace-rstudio-app": ["R Studio", "code workspace", "code-workspace-rstudio"],
	"code-workspace-vscode-app": ["Visual Studio Code", "code workspace", "code-workspace-vscode"],
	"custom-endpoints-app": ["endpoint set", "endpoint-set"],
	"deployed-application-app": ["compute module"],
	edge: ["microsoft edge"],
	"evals-app": ["evaluation suite", "evaluation-suite"],
	"foundry-platform": ["foundry"],
	"foundry-vulcan": ["3D models"],
	googlecloud: ["gcp", "google cloud", "google cloud platform"],
	"hyperauto-app": ["HyperAuto App"],
	kubernetes: ["k8s", "kube"],
	"logic-app": ["function logic", "function-logic"],
	"mcp-hub-app": ["ontology MCP", "ontology-mcp", "palantir MCP", "palantir-mcp"],
	"monocle-graph-app": ["monocle"],
	nextjs: ["next", "next.js"],
	"object-search-app": ["Object View Editor", "object search"],
	"ontology-objecttype-app": [
		"Ontology Object Type App",
		"object type",
		"object types",
		"object-type",
		"ontology",
	],
	"palantir-ontology": ["ontology manager", "palantir ontology"],
	"palantir-pipeline": ["palantir pipeline", "pipeline"],
	"palantir-workshop": ["palantir workshop"],
	"pipeline-builder-graph-app": ["pipeline", "pipeline-builder-graph"],
	postgresql: ["postgres", "psql", "postgres sql"],
	"preparation-app": ["data preparation"],
	"sddi-app": ["SDDI", "software defined data integration"],
	"slate-document-app": ["slate document", "slate-document"],
	"structured-dataset-app": ["dataset", "structured dataset", "structured-dataset"],
	"symbols-management-app": ["symbol type", "symbol-type"],
	vercel: ["zeit"],
	"workflow-builder-app": ["workflow builder"],
	"workflow-builder-write-mode-app": ["workflow-builder-write-mode"],
	"workshop-module-app": ["workshop module", "workshop-module"],
};

const NAME_BY_BASE_SLUG: Readonly<Record<string, string>> = {
	adobefirefly: "Adobe Firefly",
	adobeillustrator: "Adobe Illustrator",
	affinitydesigner: "Affinity Designer",
	"agent-builder-app": "Agent Builder",
	"agent-manager-app": "Agent Manager",
	"agent-studio-app": "AIP Chatbot Studio",
	"ai-fde-app": "AI FDE",
	aihubmix: "AIHubMix",
	"aip-analyst-app": "AIP Analyst",
	"aip-assist-tutorials-app": "Walkthroughs",
	"aip-autopilot-app": "Autopilot",
	"aip-document-intelligence-app": "AIP Document Intelligence",
	"aip-evolve-app": "AIP Evolve",
	"aip-showcase": "Examples (Build with AIP)",
	alibabacloud: "Alibaba Cloud",
	amznwebserv: "Amazon Web Services",
	"approvals-app": "Approvals",
	"arrow-workbook-app": "Code Workbook",
	"artifacts-app": "Artifacts",
	"audit-explorer-app": "Audit Explorer",
	"automation-app": "Automate",
	aws: "AWS",
	baiducloud: "Baidu Cloud",
	"boardroom-app": "Boardroom",
	"carbon-workspace-app": "Carbon workspaces",
	"checkpoints-app": "Checkpoints",
	"cipher-channel-app": "Cipher",
	claudecode: "Claude Code",
	cloudflare: "Cloudflare",
	"code-app": "Code Repositories",
	"code-workspace-app": "Code Workspaces",
	"code-workspace-jupyter-app": "Jupyter",
	"code-workspace-rstudio-app": "RStudio",
	"code-workspace-vscode-app": "VS Code",
	codex: "Codex",
	"contour-analysis-app": "Contour",
	"control-panel-app": "Control Panel",
	"custom-endpoints-app": "Custom Endpoints",
	"custom-widgets-app": "Custom Widgets",
	"data-connection-app": "Data Connection",
	"data-health-app": "Data Health",
	"default-app": "Preview",
	"deployed-application-app": "Compute Modules",
	"dev-console-app": "Developer Console",
	"developer-branching-app": "Global Branching",
	digitalocean: "DigitalOcean",
	"evals-app": "AIP Evals",
	"flow-capture-app": "Flow Capture",
	flyio: "Fly.io",
	"form-app": "Forms",
	"foundry-applications-portal": "Applications Portal",
	"foundry-build-schedules": "Build Schedules",
	"foundry-code-templates": "Code Templates",
	"foundry-documentation": "Custom documentation",
	"foundry-issues": "Issues",
	"foundry-platform": "Foundry Platform",
	"foundry-projects-files": "Projects & files",
	"foundry-rules-app": "Foundry Rules",
	"foundry-user-directory": "User Directory",
	"foundry-vulcan": "Vulcan",
	"fusion-app": "Fusion",
	githubcopilot: "GitHub Copilot",
	googlecloud: "Google Cloud",
	"hivemind-app": "Hivemind",
	"hyperauto-app": "HyperAuto",
	"inference-app": "Sensitive Data Scanner",
	"insight-app": "Insight",
	"job-tracker-app": "Builds",
	kubernetes: "Kubernetes",
	"linter-app": "Linter",
	lmstudio: "LM Studio",
	"logic-app": "AIP Logic",
	"logic-flow-app": "Logic Flows",
	"machinery-app": "Machinery",
	"marketplace-app": "Marketplace",
	"marketplace-packaging-app": "DevOps",
	"mcp-hub-app": "MCP Hub",
	"mindkit-app": "Mindkit",
	"model-app": "Models app",
	"model-catalog-app": "Model Catalog",
	"model-studio-app": "Model Studio",
	"modeling-objective-app": "Modeling Objectives",
	"monocle-graph-app": "Data Lineage",
	nextjs: "Next.js",
	nodejs: "Node.js",
	"notepad-app": "Notepad",
	"notifications-app": "Notifications",
	"object-search-app": "Object Explorer",
	"ontology-objecttype-app": "Ontology Manager",
	openai: "OpenAI",
	"palantir-ontology": "Ontology",
	"palantir-pipeline": "Pipeline Builder",
	"palantir-workshop": "Workshop",
	"peer-manager-app": "Peer Manager",
	"pilot-app": "Pilot",
	"pipeline-builder-graph-app": "Pipeline Builder",
	postgresql: "PostgreSQL",
	"preparation-app": "Preparation",
	"quiver-app": "Quiver",
	reactnative: "React Native",
	"resource-management-app": "Resource Management",
	"restricted-view-app": "Restricted Views",
	"retention-app": "Retention policies",
	"sddi-app": "HyperAuto (legacy)",
	"slate-document-app": "Slate",
	"solution-design-app": "Solution Designer",
	"sql-studio-app": "SQL Studio",
	"structured-dataset-app": "Dataset Preview",
	"symbols-management-app": "Symbols Management",
	tailwindcss: "Tailwind CSS",
	"templates-app": "Templates",
	"threads-app": "AIP Threads",
	"time-series-catalog-app": "Time Series Catalog",
	"training-app": "Training",
	"upgrade-assistant-app": "Upgrade Assistant",
	"value-types-app": "Value Types",
	vercel: "Vercel",
	"vertex-graph-app": "Vertex",
	vertexai: "Vertex AI",
	visualbasic: "Visual Basic",
	visualstudio: "Visual Studio",
	"vortex-map-app": "Map",
	"vortex-map-layer-app": "Map Layer",
	vscode: "Visual Studio Code",
	"workflow-builder-app": "Workflow Lineage",
	"workflow-builder-write-mode-app": "Workflow Builder",
	"workshop-module-app": "Workshop",
};

const UPPERCASE_WORDS = new Set([
	"ai",
	"aip",
	"api",
	"aws",
	"cdn",
	"ci",
	"cli",
	"css",
	"db",
	"gcp",
	"gpu",
	"html",
	"http",
	"ide",
	"iot",
	"ip",
	"js",
	"json",
	"llm",
	"mcp",
	"ml",
	"os",
	"php",
	"sdk",
	"sddi",
	"sql",
	"ssh",
	"svg",
	"ts",
	"ui",
	"url",
	"ux",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isViewBox(value: unknown): value is SketchiIconViewBox {
	return (
		isRecord(value) &&
		typeof value.height === "number" &&
		typeof value.minX === "number" &&
		typeof value.minY === "number" &&
		typeof value.width === "number"
	);
}

function isSourceIcon(value: unknown): value is SourceIcon {
	return (
		isRecord(value) &&
		isRecord(value.color) &&
		isIconColor(value.color) &&
		typeof value.bytes === "number" &&
		typeof value.collection === "string" &&
		typeof value.slug === "string" &&
		typeof value.urlPath === "string" &&
		(value.baseSlug === undefined || typeof value.baseSlug === "string") &&
		(value.variant === undefined || value.variant === null || typeof value.variant === "string") &&
		isViewBox(value.viewBox)
	);
}

function decodeSourceData(value: unknown): SourceData {
	if (
		!isRecord(value) ||
		!Array.isArray(value.icons) ||
		!value.icons.every(isSourceIcon) ||
		(value.generatedAt !== undefined && typeof value.generatedAt !== "string")
	) {
		throw new Error("Icon source data is invalid.");
	}
	return {
		...(typeof value.generatedAt === "string" ? { generatedAt: value.generatedAt } : {}),
		icons: value.icons,
	};
}

function titleWord(word: string): string {
	if (UPPERCASE_WORDS.has(word)) {
		return word.toUpperCase();
	}
	return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

export function displayNameForSourceIcon(icon: SourceIcon): string {
	const baseSlug = icon.baseSlug ?? icon.slug.replace(/-text$/u, "");
	const baseName =
		NAME_BY_BASE_SLUG[baseSlug] ?? baseSlug.split("-").filter(Boolean).map(titleWord).join(" ");
	return icon.variant === "text" || icon.slug.endsWith("-text") ? `${baseName} Wordmark` : baseName;
}

function publicSlugForIcon(
	icon: SourceIcon,
	collisions: ReadonlyMap<string, readonly SourceIcon[]>,
): string {
	const canonicalCollection = COLLISION_CANONICAL_COLLECTIONS[icon.slug];
	if (canonicalCollection) {
		return icon.collection === canonicalCollection ? icon.slug : `${icon.slug}-${icon.collection}`;
	}

	const collided = collisions.get(icon.slug);
	if (!collided || collided.length === 1) {
		return icon.slug;
	}

	throw new Error(`Choose a canonical collection for duplicate slug ${icon.slug}.`);
}

function aliasesForIcon(icon: SourceIcon, publicSlug: string): readonly string[] {
	const baseSlug = icon.baseSlug ?? icon.slug.replace(/-text$/u, "");
	const seeded = ALIASES_BY_BASE_SLUG[baseSlug] ?? [];
	const curatedName = NAME_BY_BASE_SLUG[baseSlug];
	return Array.from(
		new Set(
			publicSlug === icon.slug
				? [...seeded, ...(curatedName ? [curatedName] : [])]
				: [icon.slug, ...seeded, ...(curatedName ? [curatedName] : [])],
		),
	).sort();
}

function keywordsForIcon(icon: SourceIcon): readonly string[] {
	const baseSlug = icon.baseSlug ?? icon.slug.replace(/-text$/u, "");
	return Array.from(
		new Set([...baseSlug.split("-"), ...(icon.variant ? [icon.variant, "wordmark"] : [])]),
	).sort();
}

export function buildIconCatalog(value: unknown): GeneratedIconCatalog {
	const sourceData = decodeSourceData(value);
	const collisions = new Map<string, SourceIcon[]>();
	for (const icon of sourceData.icons) {
		const current = collisions.get(icon.slug) ?? [];
		current.push(icon);
		collisions.set(icon.slug, current);
	}

	const sources: Record<string, string> = {};
	const icons: SketchiIcon[] = sourceData.icons.map((icon) => {
		const slug = publicSlugForIcon(icon, collisions);
		if (sources[slug]) {
			throw new Error(`Generated public slug ${slug} is not unique.`);
		}
		sources[slug] = icon.urlPath;
		return {
			aliases: aliasesForIcon(icon, slug),
			bytes: icon.bytes,
			collection: icon.collection,
			colorMode: icon.color.colorMode,
			keywords: keywordsForIcon(icon),
			name: displayNameForSourceIcon(icon),
			...(icon.color.onDark ? { onDark: icon.color.onDark } : {}),
			...(icon.color.onLight ? { onLight: icon.color.onLight } : {}),
			slug,
			svgPath: icon.urlPath,
			...(icon.variant ? { variant: icon.variant } : {}),
			viewBox: icon.viewBox,
		};
	});

	icons.sort(
		(left, right) => left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug),
	);
	const collectionCounts: Record<string, number> = {};
	for (const icon of icons) {
		collectionCounts[icon.collection] = (collectionCounts[icon.collection] ?? 0) + 1;
	}

	return {
		manifest: {
			...(sourceData.generatedAt ? { generatedAt: sourceData.generatedAt } : {}),
			icons,
			summary: {
				collectionCounts,
				totalIcons: icons.length,
			},
			version: 1,
		},
		sources,
	};
}
