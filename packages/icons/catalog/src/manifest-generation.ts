import { type IconColor, isIconColor } from "./color-mode.js";
import type { IconManifest, SketchiIcon, SketchiIconViewBox } from "./manifest.js";
import { canonicalIconSlug, FOLDED_INTO_SLUG } from "./folded-slugs.js";
import { vendorAliases } from "./vendor-aliases.js";

interface SourceIcon {
	/** Other official names a vendor icon set gives the product ("Amazon Simple Storage Service"). */
	readonly aliases?: readonly string[];
	readonly baseSlug?: string;
	readonly bytes: number;
	/** Measured from the SVG by the generator for every shipped mark. */
	readonly color?: IconColor;
	readonly collection: string;
	/** The product name a vendor icon set gives the mark ("Amazon S3"); others derive it from the slug. */
	readonly name?: string;
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

/**
 * The catalog's name for a pipeline collection where the two differ. Google
 * distributes its per-product icons as "legacy console icons", yet it is its
 * only set with an icon for each product (BigQuery, Pub/Sub, Dataflow); its
 * 2025 core-product set, `gcp`, covers about twenty. The SVGs keep their
 * published paths, and a slug qualified by collection keeps the pipeline's
 * name (`anthos-gcp-legacy`).
 */
const CATALOG_COLLECTION_BY_SOURCE: Readonly<Record<string, string>> = {
	"gcp-legacy": "gcp-products",
};

/** Product marks whose name ends in "-text", which the pipeline reads as wordmarks. */
const PRODUCTS_NAMED_TEXT: ReadonlySet<string> = new Set(["speech-to-text"]);

type SourceKey = Pick<SourceIcon, "collection" | "slug">;

/** The source marks that ship, leaving out those folded into another product's mark. */
export function shippedSourceIcons<Icon extends SourceKey>(icons: readonly Icon[]): Icon[] {
	const slugs = publicSlugs(icons);
	return icons.filter((icon) => {
		const slug = slugs.get(icon)!;
		return canonicalIconSlug(slug) === slug;
	});
}

const ALIASES_BY_BASE_SLUG: Readonly<Record<string, readonly string[]>> = {
	"agent-studio-app": ["agent studio"],
	"ai-fde-app": ["AI forward deployed engineer"],
	"aip-autopilot-app": ["AIP Autopilot", "autopilot workbench"],
	"aip-showcase": ["AIP showcase", "build with aip"],
	"automation-app": ["object monitor", "object-monitor"],
	apachespark: ["Spark"],
	aws: ["amazon", "amazon web services"],
	azure: ["microsoft azure"],
	cloudflareworkers: ["Cloudflare Worker"],
	"code-app": ["code repository", "code-repository", "python repository", "typescript repository"],
	"code-workspace-jupyter-app": [
		"Jupyter code workspace",
		"Palantir Jupyter",
		"code workspace",
		"code-workspace-jupyter",
	],
	"code-workspace-rstudio-app": [
		"Palantir RStudio",
		"RStudio code workspace",
		"code workspace",
		"code-workspace-rstudio",
	],
	"code-workspace-vscode-app": ["Visual Studio Code", "code workspace", "code-workspace-vscode"],
	"custom-endpoints-app": ["endpoint set", "endpoint-set"],
	"deployed-application-app": ["compute module"],
	edge: ["microsoft edge"],
	"evals-app": ["evaluation suite", "evaluation-suite"],
	"foundry-platform": ["foundry"],
	"foundry-vulcan": ["3D models"],
	googleanalytics: ["GA4"],
	googlecloud: ["gcp", "google cloud", "google cloud platform"],
	"hyperauto-app": ["HyperAuto App"],
	knockoutjs: ["knockout.js"],
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
	pi: ["pi coding agent"],
	"pipeline-builder-graph-app": ["pipeline", "pipeline-builder-graph"],
	postgresql: ["postgres", "psql", "postgres sql"],
	rstudio: ["Posit", "R Studio"],
	"preparation-app": ["data preparation"],
	"sddi-app": ["SDDI", "software defined data integration"],
	"slate-document-app": ["slate document", "slate-document"],
	"structured-dataset-app": ["dataset", "structured dataset", "structured-dataset"],
	"symbols-management-app": ["symbol type", "symbol-type"],
	vercel: ["zeit"],
	workersai: ["Cloudflare Workers AI"],
	"workflow-builder-app": ["workflow builder"],
	"workflow-builder-write-mode-app": ["workflow-builder-write-mode"],
	"workshop-module-app": ["workshop module", "workshop-module"],
};

const NAME_BY_BASE_SLUG: Readonly<Record<string, string>> = {
	"11ty": "Eleventy",
	adobefirefly: "Adobe Firefly",
	adobeillustrator: "Adobe Illustrator",
	adobexd: "Adobe XD",
	affinitydesigner: "Affinity Designer",
	affinityphoto: "Affinity Photo",
	affinitypublisher: "Affinity Publisher",
	aftereffects: "Adobe After Effects",
	"agent-builder-app": "Agent Builder",
	"agent-manager-app": "Agent Manager",
	"agent-studio-app": "AIP Chatbot Studio",
	agnesai: "Agnes AI",
	agui: "AG-UI",
	"ai-fde-app": "AI FDE",
	"ai-machine-learning": "AI & Machine Learning",
	ai21: "AI21 Labs",
	ai21labsai: "AI21",
	ai302: "302.AI",
	ai360: "360 AI",
	aihubmix: "AIHubMix",
	aimlapi: "AI/ML API",
	aionlabs: "Aion Labs",
	"aip-analyst-app": "AIP Analyst",
	"aip-assist-tutorials-app": "Walkthroughs",
	"aip-autopilot-app": "Autopilot",
	"aip-document-intelligence-app": "AIP Document Intelligence",
	"aip-evolve-app": "AIP Evolve",
	"aip-showcase": "Examples (Build with AIP)",
	aistudio: "AI Studio",
	akashchat: "Akash Chat",
	alephalpha: "Aleph Alpha",
	alibabacloud: "Alibaba Cloud",
	"alloy-db": "AlloyDB",
	alpinejs: "Alpine.js",
	amdradeoncloud: "AMD Radeon Cloud",
	amznwebserv: "Amazon Web Services",
	animaapp: "Anima",
	antd: "Ant Design",
	antgroup: "Ant Group",
	"approvals-app": "Approvals",
	"arrow-workbook-app": "Code Workbook",
	"artifacts-app": "Artifacts",
	assemblyai: "AssemblyAI",
	atlascloud: "Atlas Cloud",
	"audit-explorer-app": "Audit Explorer",
	"automation-app": "Automate",
	automl: "AutoML",
	"automl-natural-language": "AutoML Natural Language",
	"automl-tables": "AutoML Tables",
	"automl-translation": "AutoML Translation",
	"automl-video-intelligence": "AutoML Video Intelligence",
	"automl-vision": "AutoML Vision",
	avajs: "AVA",
	aws: "AWS",
	azureai: "Azure AI",
	baai: "BAAI",
	backbonejs: "Backbone.js",
	baiducloud: "Baidu Cloud",
	baseui: "Base UI",
	beyondcorp: "BeyondCorp",
	bfl: "Black Forest Labs",
	"big-query": "BigQuery",
	bigquery: "BigQuery",
	bilibiliindex: "Bilibili Index",
	biomejs: "Biome",
	blueprintjs: "Blueprint",
	"boardroom-app": "Boardroom",
	bootstrap5: "Bootstrap",
	briaai: "Bria AI",
	bunjs: "Bun",
	burncloud: "BurnCloud",
	bytedance: "ByteDance",
	cakephp: "CakePHP",
	capcut: "CapCut",
	"carbon-workspace-app": "Carbon workspaces",
	cassandradb: "Apache Cassandra",
	celestoai: "CelestoAI",
	centml: "CentML",
	chakraui: "Chakra UI",
	chatglm: "ChatGLM",
	cheaperinference: "Cheaper Inference",
	"checkpoints-app": "Checkpoints",
	cherrystudio: "Cherry Studio",
	"cipher-channel-app": "Cipher",
	circleci: "CircleCI",
	claudecode: "Claude Code",
	clickhouse: "ClickHouse",
	"cloud-apis": "Cloud APIs",
	"cloud-dns": "Cloud DNS",
	"cloud-ekm": "Cloud EKM",
	"cloud-for-marketing": "Cloud for Marketing",
	"cloud-hsm": "Cloud HSM",
	"cloud-ids": "Cloud IDS",
	"cloud-nat": "Cloud NAT",
	"cloud-run-for-anthos": "Cloud Run for Anthos",
	"cloud-tpu": "Cloud TPU",
	"cloud-vpn": "Cloud VPN",
	cloudflare: "Cloudflare",
	"code-app": "Code Repositories",
	"code-workspace-app": "Code Workspaces",
	"code-workspace-jupyter-app": "Foundry Jupyter",
	"code-workspace-rstudio-app": "Foundry RStudio",
	"code-workspace-vscode-app": "VS Code",
	codebuddy: "CodeBuddy",
	codeflicker: "CodeFlicker",
	codegeex: "CodeGeeX",
	codeigniter: "CodeIgniter",
	coderabbit: "CodeRabbit",
	codex: "Codex",
	cogvideo: "CogVideo",
	cogview: "CogView",
	cometapi: "CometAPI",
	cometd: "CometD",
	comfyui: "ComfyUI",
	commanda: "Command A",
	commandcode: "Command Code",
	"container-optimized-os": "Container-Optimized OS",
	"contour-analysis-app": "Contour",
	"control-panel-app": "Control Panel",
	copilotkit: "CopilotKit",
	copilotms: "Microsoft Copilot",
	crewai: "CrewAI",
	css3: "CSS3",
	"custom-endpoints-app": "Custom Endpoints",
	"custom-widgets-app": "Custom Widgets",
	dalle: "DALL-E",
	"data-connection-app": "Data Connection",
	"data-health-app": "Data Health",
	"data-qna": "Data QnA",
	dbrx: "DBRX",
	deepai: "DeepAI",
	deepcogito: "Deep Cogito",
	deepinfra: "DeepInfra",
	deepl: "DeepL",
	deepmind: "DeepMind",
	deepseek: "DeepSeek",
	"default-app": "Preview",
	"deployed-application-app": "Compute Modules",
	"dev-console-app": "Developer Console",
	"dev-ops": "DevOps",
	"developer-branching-app": "Global Branching",
	"dialogflow-cx": "Dialogflow CX",
	digitalocean: "DigitalOcean",
	dlang: "D",
	doc2x: "Doc2X",
	docsearch: "DocSearch",
	dothoosh: "DotHoosh",
	dotsstudio: "Dots Studio",
	dreammachine: "Dream Machine",
	elementui: "Element UI",
	elevenlabs: "ElevenLabs",
	empiriolabs: "EmpirioLabs AI",
	eslint: "ESLint",
	essentialai: "Essential AI",
	"evals-app": "AIP Evals",
	expressjs: "Express",
	fabricjs: "Fabric.js",
	fastgpt: "FastGPT",
	faunadb: "Fauna",
	fishaudio: "Fish Audio",
	flexai: "FlexAI",
	"flow-capture-app": "Flow Capture",
	flutterflow: "FlutterFlow",
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
	"gce-systems-management": "GCE Systems Management",
	geminicli: "Gemini CLI",
	giteeai: "Gitee AI",
	github: "GitHub",
	githubcopilot: "GitHub Copilot",
	gitlab: "GitLab",
	gke: "GKE",
	"gke-on-prem": "GKE On-Prem",
	glmv: "GLM-V",
	gmicloud: "GMI Cloud",
	googleanalytics: "Google Analytics",
	googlecloud: "Google Cloud",
	graphql: "GraphQL",
	greenpt: "GreenPT",
	grokbot: "Grok Bot",
	gruntjs: "Grunt",
	gsap: "GSAP",
	happyhorse: "HappyHorse",
	headlessui: "Headless UI",
	hermesagent: "Hermes Agent",
	hhvm: "HHVM",
	"hivemind-app": "Hivemind",
	html5: "HTML5",
	huggingface: "Hugging Face",
	hyper2: "Hyper (monochrome)",
	"hyperauto-app": "HyperAuto",
	ibm: "IBM",
	id: "Adobe InDesign",
	"identity-and-access-management": "Identity and Access Management",
	"identity-aware-proxy": "Identity-Aware Proxy",
	ie: "Internet Explorer",
	iflytekcloud: "iFlytek Cloud",
	"inference-app": "Sensitive Data Scanner",
	"ingress-nginx": "Ingress NGINX",
	"insight-app": "Insight",
	internlm: "InternLM",
	invision: "InVision",
	ionet: "io.net",
	"iot-core": "IoT Core",
	"iot-edge": "IoT Edge",
	javascript: "JavaScript",
	"job-tracker-app": "Builds",
	jquery: "jQuery",
	jslint: "JSLint",
	kilocode: "Kilo Code",
	knockoutjs: "Knockout",
	kubernetes: "Kubernetes",
	kuberun: "KubeRun",
	langchain: "LangChain",
	langgraph: "LangGraph",
	leptonai: "Lepton AI",
	lg: "LG",
	lightroom: "Adobe Lightroom",
	"linter-app": "Linter",
	livekit: "LiveKit",
	llamaindex: "LlamaIndex",
	llava: "LLaVA",
	llmapi: "LLM API",
	llmgateway: "LLM Gateway",
	lmstudio: "LM Studio",
	lobehub: "LobeHub",
	"local-ssd": "Local SSD",
	"logic-app": "AIP Logic",
	"logic-flow-app": "Logic Flows",
	logrocket: "LogRocket",
	longcat: "LongCat",
	"machinery-app": "Machinery",
	"managed-service-for-microsoft-active-directory":
		"Managed Service for Microsoft Active Directory",
	"maps-geospatial": "Maps & Geospatial",
	mariadb: "MariaDB",
	"marketplace-app": "Marketplace",
	"marketplace-packaging-app": "DevOps",
	materialui: "Material UI",
	"mcp-hub-app": "MCP Hub",
	mcpso: "MCP.so",
	metaai: "Meta AI",
	metagpt: "MetaGPT",
	"migrate-for-anthos": "Migrate for Anthos",
	"migrate-for-compute-engine": "Migrate for Compute Engine",
	"mindkit-app": "Mindkit",
	minimax: "MiniMax",
	mobx: "MobX",
	mochajs: "Mocha",
	"model-app": "Models app",
	"model-catalog-app": "Model Catalog",
	"model-studio-app": "Model Studio",
	"modeling-objective-app": "Modeling Objectives",
	modelscope: "ModelScope",
	modx: "MODX",
	mongodb: "MongoDB",
	"monocle-graph-app": "Data Lineage",
	msdos: "MS-DOS",
	myshell: "MyShell",
	mysql: "MySQL",
	n8n: "n8n",
	nanobanana: "Nano Banana",
	nasm: "NASM",
	nats: "NATS",
	nestjs: "NestJS",
	net: ".NET",
	netbeans: "NetBeans",
	netbox: "NetBox",
	netcore: ".NET Core",
	netlify2: "Netlify (2023 logo)",
	networkx: "NetworkX",
	newapi: "New API",
	newrelic: "New Relic",
	nextjs: "Next.js",
	ngrx: "NgRx",
	nhibernate: "NHibernate",
	nixos: "NixOS",
	nodejs: "Node.js",
	nodered: "Node-RED",
	nodewebkit: "NW.js",
	notebooklm: "NotebookLM",
	"notepad-app": "Notepad",
	"notifications-app": "Notifications",
	nousresearch: "Nous Research",
	novelai: "NovelAI",
	npm: "npm",
	nuget: "NuGet",
	numpy: "NumPy",
	nuxtjs: "Nuxt",
	nvidia: "NVIDIA",
	oauth: "OAuth",
	"object-search-app": "Object Explorer",
	ocaml: "OCaml",
	ohmyzsh: "Oh My Zsh",
	onedrive: "OneDrive",
	"ontology-objecttype-app": "Ontology Manager",
	openai: "OpenAI",
	openal: "OpenAL",
	openapi: "OpenAPI",
	openchat: "OpenChat",
	opencl: "OpenCL",
	openclaw: "OpenClaw",
	opencode: "OpenCode",
	opencv: "OpenCV",
	opengl: "OpenGL",
	openhands: "OpenHands",
	openrouter: "OpenRouter",
	openstack: "OpenStack",
	opensuse: "openSUSE",
	opentelemetry: "OpenTelemetry",
	openwebui: "Open WebUI",
	opnsense: "OPNsense",
	p5js: "p5.js",
	"palantir-ontology": "Ontology",
	"palantir-pipeline": "Pipeline Builder",
	"palantir-workshop": "Workshop",
	palm: "PaLM",
	pandacss: "Panda CSS",
	"peer-manager-app": "Peer Manager",
	pfsense: "pfSense",
	phpstorm: "PhpStorm",
	pi: "Pi Agent",
	"pilot-app": "Pilot",
	"pipeline-builder-graph-app": "Pipeline Builder",
	pixijs: "PixiJS",
	pixverse: "PixVerse",
	pm2: "PM2",
	pnpm: "pnpm",
	postcss: "PostCSS",
	postgresql: "PostgreSQL",
	posthog: "PostHog",
	powershell: "PowerShell",
	ppio: "PPIO",
	"preparation-app": "Preparation",
	primeng: "PrimeNG",
	processwire: "ProcessWire",
	prunaai: "Pruna AI",
	ps: "Adobe Photoshop",
	pubsub: "Pub/Sub",
	pugjs: "Pug",
	purescript: "PureScript",
	putty: "PuTTY",
	pwa: "PWA",
	pycharm: "PyCharm",
	pydanticai: "Pydantic AI",
	pypi: "PyPI",
	pytorch: "PyTorch",
	pytorch3d: "PyTorch3D",
	qtest: "qTest",
	"quiver-app": "Quiver",
	rabbitmq: "RabbitMQ",
	radixui: "Radix UI",
	radstudio: "RAD Studio",
	ravendb: "RavenDB",
	reactbootstrap: "React Bootstrap",
	reactnative: "React Native",
	reactnavigation: "React Navigation",
	reactquery: "React Query",
	reactrouter: "React Router",
	readthedocs: "Read the Docs",
	redhat: "Red Hat",
	reduxsaga: "Redux-Saga",
	redwoodjs: "RedwoodJS",
	renpy: "Ren'Py",
	"resource-management-app": "Resource Management",
	"restricted-view-app": "Restricted Views",
	"retention-app": "Retention policies",
	rocksdb: "RocksDB",
	rockylinux: "Rocky Linux",
	roocode: "Roo Code",
	rstudio: "RStudio",
	rspec: "RSpec",
	rsshub: "RSSHub",
	rubymine: "RubyMine",
	rwkv: "RWKV",
	rxjs: "RxJS",
	sambanova: "SambaNova",
	scikitlearn: "scikit-learn",
	"sddi-app": "HyperAuto (legacy)",
	search1api: "Search1API",
	searchapi: "SearchApi",
	searxng: "SearXNG",
	"sec-ops": "SecOps",
	"security-identity": "Security & Identity",
	semanticui: "Semantic UI",
	sensenova: "SenseNova",
	shadcnui: "shadcn/ui",
	siliconcloud: "SiliconCloud",
	sillytavern: "SillyTavern",
	"slate-document-app": "Slate",
	socketio: "Socket.IO",
	solidjs: "Solid",
	"solution-design-app": "Solution Designer",
	sonarqube: "SonarQube",
	"speech-to-text": "Speech-to-Text",
	spicedb: "SpiceDB",
	spss: "SPSS",
	"sql-studio-app": "SQL Studio",
	sqlalchemy: "SQLAlchemy",
	sqldeveloper: "SQL Developer",
	sqlite: "SQLite",
	stability: "Stability AI",
	stackblitz: "StackBlitz",
	stackoverflow: "Stack Overflow",
	stenciljs: "Stencil",
	stepfun: "StepFun",
	streamlake: "StreamLake",
	"structured-dataset-app": "Dataset Preview",
	styledcomponents: "styled-components",
	sub2api: "Sub2API",
	sublime: "Sublime Text",
	surrealdb: "SurrealDB",
	sveltejs: "Svelte",
	svgo: "SVGO",
	"symbols-management-app": "Symbols Management",
	tailwindcss: "Tailwind CSS",
	tanstack: "TanStack",
	teamcity: "TeamCity",
	"templates-app": "Templates",
	tencentcloud: "Tencent Cloud",
	tensorflow: "TensorFlow",
	"tensorflow-enterprise": "TensorFlow Enterprise",
	testrail: "TestRail",
	tex: "TeX",
	"text-to-speech": "Text-to-Speech",
	"threads-app": "AIP Threads",
	threejs: "three.js",
	tigerbeetle: "TigerBeetle",
	tii: "TII",
	"time-series-catalog-app": "Time Series Catalog",
	titaniumsdk: "Titanium SDK",
	together: "Together AI",
	"tools-for-powershell": "Tools for PowerShell",
	topazlabs: "Topaz Labs",
	tortoisegit: "TortoiseGit",
	towergit: "Tower",
	traefikmesh: "Traefik Mesh",
	traefikproxy: "Traefik Proxy",
	"training-app": "Training",
	travis: "Travis CI",
	trpc: "tRPC",
	typeorm: "TypeORM",
	typesafeai: "TypeSafe AI",
	typescript: "TypeScript",
	typo3: "TYPO3",
	uml: "UML",
	unionalpha: "Union Alpha",
	unjs: "UnJS",
	"upgrade-assistant-app": "Upgrade Assistant",
	uv: "uv",
	uwsgi: "uWSGI",
	v0: "v0",
	"value-types-app": "Value Types",
	vectorizerai: "Vectorizer.AI",
	vercel: "Vercel",
	"vertex-graph-app": "Vertex",
	vertexai: "Vertex AI",
	vertx: "Vert.x",
	visualbasic: "Visual Basic",
	visualstudio: "Visual Studio",
	vite2: "Vite (blue)",
	vitejs: "Vite",
	vllm: "vLLM",
	"vmware-engine": "VMware Engine",
	"vortex-map-app": "Map",
	"vortex-map-layer-app": "Map Layer",
	vscode: "Visual Studio Code",
	vscodium: "VSCodium",
	vsphere: "vSphere",
	vuejs: "Vue.js",
	vuestorefront: "Vue Storefront",
	wandb: "Weights & Biases",
	wavespeed: "WaveSpeed",
	"web-mobile": "Web & Mobile",
	web3js: "web3.js",
	webassembly: "WebAssembly",
	webgpu: "WebGPU",
	webstorm: "WebStorm",
	windows11: "Windows 11",
	windows8: "Windows 8",
	wireguard: "WireGuard",
	wordpress: "WordPress",
	workbuddy: "WorkBuddy",
	workersai: "Workers AI",
	"workflow-builder-app": "Workflow Lineage",
	"workflow-builder-write-mode-app": "Workflow Builder",
	"workos-lockup": "WorkOS Wordmark",
	"workos-logomark": "WorkOS",
	"workshop-module-app": "Workshop",
	xai: "xAI",
	xiaomimimo: "Xiaomi MiMo",
	xml: "XML",
	yaml: "YAML",
	youmind: "YouMind",
	youtrack: "YouTrack",
	yugabytedb: "YugabyteDB",
	yunohost: "YunoHost",
	zai: "Z.ai",
	zenmux: "ZenMux",
	zeroone: "01.AI",
	zhipu: "Zhipu AI",
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
		// A folded mark lends only its names, so it is never measured for color.
		(value.color === undefined || (isRecord(value.color) && isIconColor(value.color))) &&
		typeof value.bytes === "number" &&
		typeof value.collection === "string" &&
		typeof value.slug === "string" &&
		typeof value.urlPath === "string" &&
		(value.baseSlug === undefined || typeof value.baseSlug === "string") &&
		(value.name === undefined || typeof value.name === "string") &&
		(value.aliases === undefined ||
			(Array.isArray(value.aliases) &&
				value.aliases.every((alias) => typeof alias === "string"))) &&
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
		icons: value.icons.map((icon) => {
			if (PRODUCTS_NAMED_TEXT.has(icon.slug))
				return { ...icon, baseSlug: icon.slug, variant: null };
			// Named provider lockups can omit variant metadata; the suffix still makes them wordmarks.
			if (icon.slug.endsWith("-text") && !icon.variant) {
				return {
					...icon,
					baseSlug: icon.slug.slice(0, -5),
					variant: "text",
					...(icon.name ? { name: `${icon.name} Wordmark` } : {}),
				};
			}
			return icon;
		}),
	};
}

function titleWord(word: string): string {
	if (UPPERCASE_WORDS.has(word)) {
		return word.toUpperCase();
	}
	return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

export function displayNameForSourceIcon(icon: SourceIcon): string {
	if (icon.name) return icon.name;
	const baseSlug = icon.baseSlug ?? icon.slug.replace(/-text$/u, "");
	const baseName =
		NAME_BY_BASE_SLUG[baseSlug] ?? baseSlug.split("-").filter(Boolean).map(titleWord).join(" ");
	const wordmark =
		icon.variant === "text" || (icon.slug.endsWith("-text") && !PRODUCTS_NAMED_TEXT.has(icon.slug));
	return wordmark ? `${baseName} Wordmark` : baseName;
}

/** A source mark's public slug: its own, or qualified by its source collection where shared. */
function publicSlugs<Icon extends SourceKey>(icons: readonly Icon[]): Map<Icon, string> {
	const counts = new Map<string, number>();
	for (const icon of icons) counts.set(icon.slug, (counts.get(icon.slug) ?? 0) + 1);
	return new Map(
		icons.map((icon) => {
			const canonicalCollection = COLLISION_CANONICAL_COLLECTIONS[icon.slug];
			if (canonicalCollection) {
				return [
					icon,
					icon.collection === canonicalCollection ? icon.slug : `${icon.slug}-${icon.collection}`,
				];
			}
			if ((counts.get(icon.slug) ?? 0) > 1) {
				throw new Error(`Choose a canonical collection for duplicate slug ${icon.slug}.`);
			}
			return [icon, icon.slug];
		}),
	);
}

function aliasesForIcon(
	icon: SourceIcon,
	publicSlug: string,
	folded: readonly SourceIcon[],
): readonly string[] {
	const baseSlug = icon.baseSlug ?? icon.slug.replace(/-text$/u, "");
	const seeded = ALIASES_BY_BASE_SLUG[baseSlug] ?? [];
	const curatedName = NAME_BY_BASE_SLUG[baseSlug];
	// A folded mark lends its source slug, not a collection-qualified one: "anthos-gcp-legacy"
	// still resolves through the fold, but as an alias it would answer every "gcp" search.
	const foldedNames = folded.flatMap((other) => [
		other.slug,
		displayNameForSourceIcon(other),
		...(ALIASES_BY_BASE_SLUG[other.slug] ?? []),
	]);
	const names = [
		...seeded,
		...(curatedName ? [curatedName] : []),
		...(icon.aliases ?? []),
		...vendorAliases({
			collection: icon.collection,
			name: displayNameForSourceIcon(icon),
			slug: publicSlug,
		}),
		...foldedNames,
	];
	return Array.from(new Set(publicSlug === icon.slug ? names : [icon.slug, ...names]))
		.filter((name) => name !== publicSlug)
		.sort();
}

function keywordsForIcon(icon: SourceIcon): readonly string[] {
	const baseSlug = icon.baseSlug ?? icon.slug.replace(/-text$/u, "");
	return Array.from(
		new Set([...baseSlug.split("-"), ...(icon.variant ? [icon.variant, "wordmark"] : [])]),
	).sort();
}

export function buildIconCatalog(value: unknown): GeneratedIconCatalog {
	const sourceData = decodeSourceData(value);
	const slugs = publicSlugs(sourceData.icons);
	const shipped = shippedSourceIcons(sourceData.icons);
	const shippedSlugs = new Set(shipped.map((icon) => slugs.get(icon)!));
	const foldedInto = new Map<string, SourceIcon[]>();
	for (const icon of sourceData.icons) {
		const slug = slugs.get(icon)!;
		const target = FOLDED_INTO_SLUG[slug];
		if (target === undefined) continue;
		if (!shippedSlugs.has(target)) {
			throw new Error(`${slug} folds into ${target}, which does not ship.`);
		}
		foldedInto.set(target, [...(foldedInto.get(target) ?? []), icon]);
	}

	const sources: Record<string, string> = {};
	const icons: SketchiIcon[] = shipped.map((icon) => {
		const slug = slugs.get(icon)!;
		if (sources[slug]) {
			throw new Error(`Generated public slug ${slug} is not unique.`);
		}
		if (!icon.color) {
			throw new Error(`Shipped icon ${slug} has no measured color.`);
		}
		sources[slug] = icon.urlPath;
		return {
			aliases: aliasesForIcon(icon, slug, foldedInto.get(slug) ?? []),
			bytes: icon.bytes,
			collection: CATALOG_COLLECTION_BY_SOURCE[icon.collection] ?? icon.collection,
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
