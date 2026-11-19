import {
	assertWranglerWorkerIdentity,
	requireWorkerIdentity,
	workerProjectConfig,
	workerProjectIds,
	type WorkerProjectId,
} from "../../../build-config/workers";

/**
 * The Worker apps a production run deploys: every app, one named app, or (for a push) the apps
 * whose `build` the push reaches.
 */
export function selectProductionProjects(
	selection: string,
	affected: readonly string[] = [],
): WorkerProjectId[] {
	if (selection === "all") return [...workerProjectIds];
	if (selection === "affected") return workerProjectIds.filter((id) => affected.includes(id));
	return [workerProjectConfig(selection).projectId];
}

const productionProjects: Record<
	WorkerProjectId,
	{
		domainPatterns: readonly string[];
		publicSurface: boolean;
		routePolicy: string;
		title: string;
	}
> = {
	editor: {
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
	studio: {
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

export function productionProjectConfig(project: string | undefined) {
	const projectId = project?.trim() ?? "";
	const expected = `Expected one of ${Object.keys(productionProjects).join(", ")}.`;
	if (!projectId) throw new Error(`Production project selection is required. ${expected}`);
	if (!Object.hasOwn(productionProjects, projectId)) {
		throw new Error(`Unknown production project "${projectId}". ${expected}`);
	}
	const worker = workerProjectConfig(projectId);
	return { ...worker, ...productionProjects[worker.projectId] };
}

/** The generated config with only the project's approved custom domains as routes. */
export function productionDomainWranglerConfig(
	config: unknown,
	identity: { readonly projectId: string; readonly workerName: string },
) {
	const project = assertWranglerWorkerIdentity(config, identity.projectId, identity.workerName);
	const production = productionProjectConfig(project.projectId);
	requireWorkerIdentity(production.projectId, identity.workerName);
	const next = structuredClone(config) as Record<string, unknown>;
	next["name"] = production.workerName;
	next["topLevelName"] = production.workerName;
	next["workers_dev"] = true;
	next["routes"] = production.domainPatterns.map((pattern) => ({ pattern, custom_domain: true }));
	delete next["route"];
	delete next["domains"];
	delete next["custom_domain"];
	delete next["custom_domains"];
	return next;
}

export interface WorkerDomain {
	readonly hostname: string;
	readonly id: string;
	readonly service: string;
}

/**
 * The listed custom domains this project may detach: only its approved hostnames, and only
 * while they still point at its own Worker. Another Worker on an approved hostname fails closed.
 */
export function selectProductionDomainDetachments(
	identity: { readonly projectId: string; readonly workerName: string },
	domains: readonly unknown[],
): WorkerDomain[] {
	const project = productionProjectConfig(identity.projectId);
	requireWorkerIdentity(project.projectId, identity.workerName);
	const expected = new Set(project.domainPatterns);
	const required = (value: unknown, label: string) => {
		if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
		return value.trim();
	};
	return domains
		.map((domain) =>
			domain && typeof domain === "object" ? (domain as Record<string, unknown>) : {},
		)
		.filter((domain) => typeof domain["hostname"] === "string" && expected.has(domain["hostname"]))
		.map((domain) => {
			if (domain["service"] !== project.workerName) {
				throw new Error(
					`Refusing to detach ${String(domain["hostname"])}: project ${project.projectId} expects Worker ${project.workerName}, found ${String(domain["service"])}.`,
				);
			}
			return {
				hostname: required(domain["hostname"], "Cloudflare domain hostname"),
				id: required(domain["id"], "Cloudflare domain id"),
				service: required(domain["service"], "Cloudflare Worker service"),
			};
		});
}

/** The step-summary lines for a deployed production Worker. */
export function productionSummary(projectId: string, workerName: string) {
	const project = productionProjectConfig(projectId);
	requireWorkerIdentity(project.projectId, workerName);
	const visibility = project.publicSurface
		? "public product surface"
		: "internal surface; not linked from public navigation";
	const domains =
		project.domainPatterns.length > 0
			? `${project.domainPatterns.join(", ")} (manual attach only)`
			: "none";
	return [
		`- Project ID: \`${project.projectId}\``,
		`- Worker identity: \`${project.workerName}\``,
		`- Visibility: ${visibility}`,
		`- Route policy: ${project.routePolicy}`,
		`- Custom domains: ${domains}`,
	].join("\n");
}
