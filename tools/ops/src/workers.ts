/**
 * The deployed Worker apps: each Nx project id resolves to one durable Worker identity and its
 * build paths. Vite configs read this synchronously, so it throws instead of returning Effects.
 */
const workerProjects = {
	excalidraw: {
		buildOutputPath: "dist/apps/editor",
		projectRoot: "apps/editor",
		workerName: "sketchi-excalidraw",
		wranglerInputConfigPath: "apps/editor/wrangler.jsonc",
	},
	icons: {
		buildOutputPath: "dist/apps/icons",
		projectRoot: "apps/icons",
		workerName: "sketchi-icons",
		wranglerInputConfigPath: "apps/icons/wrangler.jsonc",
	},
	playground: {
		buildOutputPath: "dist/apps/studio",
		projectRoot: "apps/studio",
		workerName: "sketchi-studio",
		wranglerInputConfigPath: "apps/studio/wrangler.jsonc",
	},
	web: {
		buildOutputPath: "dist/apps/web",
		projectRoot: "apps/web",
		workerName: "sketchi-web",
		wranglerInputConfigPath: "apps/web/wrangler.jsonc",
	},
} as const;

export type WorkerProjectId = keyof typeof workerProjects;

export const workerProjectIds = Object.freeze(Object.keys(workerProjects) as WorkerProjectId[]);

export interface WorkerProject {
	readonly projectId: WorkerProjectId;
	readonly buildOutputPath: string;
	readonly projectRoot: string;
	readonly workerName: string;
	readonly wranglerInputConfigPath: string;
	readonly serverOutputPath: string;
	readonly generatedWranglerConfigPath: string;
	readonly productionDomainWranglerConfigPath: string;
}

export function isWorkerProjectId(value: string): value is WorkerProjectId {
	return Object.hasOwn(workerProjects, value);
}

export function workerProjectConfig(project: string | undefined): WorkerProject {
	const projectId = project?.trim() ?? "";
	const expected = `Expected one of ${workerProjectIds.join(", ")}.`;
	if (!projectId) throw new Error(`Worker project selection is required. ${expected}`);
	if (!isWorkerProjectId(projectId)) {
		throw new Error(`Unknown Worker project "${projectId}". ${expected}`);
	}
	const config = workerProjects[projectId];
	const serverOutputPath = `${config.buildOutputPath}/server`;
	return {
		projectId,
		...config,
		serverOutputPath,
		generatedWranglerConfigPath: `${serverOutputPath}/wrangler.json`,
		productionDomainWranglerConfigPath: `${serverOutputPath}/wrangler.domains.json`,
	};
}

export function requireWorkerIdentity(projectId: string, workerName: string | undefined) {
	const project = workerProjectConfig(projectId);
	const resolved = workerName?.trim() ?? "";
	if (!resolved) throw new Error(`Worker identity is required for project "${project.projectId}".`);
	if (resolved !== project.workerName) {
		throw new Error(
			`Worker identity mismatch for project "${project.projectId}": expected "${project.workerName}", received "${resolved}".`,
		);
	}
	return project;
}

/** The generated Wrangler config must name the project's Worker, never another one. */
export function assertWranglerWorkerIdentity(
	config: unknown,
	projectId: string,
	workerName: string | undefined,
) {
	const project = requireWorkerIdentity(projectId, workerName);
	if (!config || typeof config !== "object") {
		throw new Error(
			`Wrangler config is required for project "${project.projectId}" and Worker "${project.workerName}".`,
		);
	}
	const fields = config as Record<string, unknown>;
	for (const field of ["name", "topLevelName"]) {
		if (field === "topLevelName" && fields[field] === undefined) continue;
		if (fields[field] !== project.workerName) {
			throw new Error(
				`Wrangler ${field} mismatch for project "${project.projectId}": expected "${project.workerName}", received "${String(fields[field])}".`,
			);
		}
	}
	return project;
}
