import {
	assertWranglerWorkerIdentity,
	requireWorkerIdentity,
	workerProjectConfig,
	workerProjectIds,
} from "../worker-apps.mjs";

/**
 * The Worker apps a production run deploys: every app, one named app, or the apps whose `build`
 * a push reaches. `affected` comes from Nx's task-input selection, so a change only to tests,
 * stories or files outside every project's build inputs deploys nothing.
 * @param {{ selection: string, affected?: string[] }} input
 */
export function selectProductionProjects({ selection, affected = [] }) {
	if (selection === "all") return [...workerProjectIds];
	if (selection !== "affected") return [workerProjectConfig(selection).projectId];
	return workerProjectIds.filter((project) => affected.includes(project));
}

export const productionProjects = {
	excalidraw: {
		domainPatterns: [],
		publicSurface: false,
		routePolicy: "internal canvas workspace; no public product domain",
		title: "Sketchi Excalidraw Workspace",
	},
	icons: {
		domainPatterns: ["icons.sketchi.app"],
		publicSurface: true,
		routePolicy: "icons.sketchi.app product surface",
		title: "Sketchi Icons",
	},
	"eval-harness": {
		domainPatterns: [],
		publicSurface: false,
		routePolicy: "internal eval harness; no public product domain",
		title: "Sketchi Eval Harness",
	},
	playground: {
		domainPatterns: ["playground.sketchi.app"],
		publicSurface: true,
		routePolicy: "playground.sketchi.app product surface; authenticated Studio remains unexposed",
		title: "Sketchi Playground / Studio",
	},
	web: {
		domainPatterns: ["sketchi.app", "www.sketchi.app"],
		publicSurface: true,
		routePolicy: "sketchi.app and www.sketchi.app product surface",
		title: "Sketchi Web",
	},
};

export function productionProjectConfig(project) {
	const projectId = typeof project === "string" ? project.trim() : "";

	if (!projectId) {
		throw new Error(
			`Production project selection is required. Expected one of ${Object.keys(productionProjects).join(", ")}.`,
		);
	}

	const config = productionProjects[projectId];

	if (!config) {
		throw new Error(
			`Unknown production project "${projectId}". Expected one of ${Object.keys(productionProjects).join(", ")}.`,
		);
	}

	const worker = workerProjectConfig(projectId);

	return { ...worker, ...config };
}

export function productionDomainWranglerConfig(config, identity) {
	const project = assertWranglerWorkerIdentity(config, identity.projectId, identity.workerName);
	const production = productionProjectConfig(project.projectId);
	requireWorkerIdentity(production.projectId, identity.workerName);
	const nextConfig = structuredClone(config);

	nextConfig.name = production.workerName;
	nextConfig.topLevelName = production.workerName;
	nextConfig.workers_dev = true;
	nextConfig.routes = production.domainPatterns.map((pattern) => ({
		pattern,
		custom_domain: true,
	}));

	delete nextConfig.route;
	delete nextConfig.domains;
	delete nextConfig.custom_domain;
	delete nextConfig.custom_domains;

	return nextConfig;
}
