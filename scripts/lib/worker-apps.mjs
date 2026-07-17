const workerProjects = {
  excalidraw: {
    buildOutputPath: "dist/apps/excalidraw",
    previewWorkerPrefix: "sketchi-excalidraw-pr",
    projectId: "excalidraw",
    projectRoot: "apps/excalidraw",
    workerName: "sketchi-excalidraw",
    wranglerInputConfigPath: "apps/excalidraw/wrangler.jsonc",
  },
  "eval-harness": {
    buildOutputPath: "dist/apps/eval-harness",
    previewWorkerPrefix: "sketchi-playground-pr",
    projectId: "eval-harness",
    projectRoot: "apps/eval-harness",
    workerName: "sketchi-playground",
    wranglerInputConfigPath: "apps/eval-harness/wrangler.jsonc",
  },
  icons: {
    buildOutputPath: "dist/apps/icons",
    previewWorkerPrefix: "sketchi-icons-pr",
    projectId: "icons",
    projectRoot: "apps/icons",
    workerName: "sketchi-icons",
    wranglerInputConfigPath: "apps/icons/wrangler.jsonc",
  },
  playground: {
    buildOutputPath: "dist/apps/playground",
    previewWorkerPrefix: "sketchi-studio-pr",
    projectId: "playground",
    projectRoot: "apps/playground",
    workerName: "sketchi-studio",
    wranglerInputConfigPath: "apps/playground/wrangler.jsonc",
  },
  web: {
    buildOutputPath: "dist/apps/web",
    previewWorkerPrefix: "sketchi-web-pr",
    projectId: "web",
    projectRoot: "apps/web",
    workerName: "sketchi-web",
    wranglerInputConfigPath: "apps/web/wrangler.jsonc",
  },
};

export const workerProjectIds = Object.freeze(Object.keys(workerProjects));

export function workerProjectConfig(project) {
  const projectId = typeof project === "string" ? project.trim() : "";

  if (!projectId) {
    throw new Error(
      `Worker project selection is required. Expected one of ${workerProjectIds.join(", ")}.`,
    );
  }

  const config = workerProjects[projectId];

  if (!config || config.projectId !== projectId) {
    throw new Error(
      `Unknown Worker project "${projectId}". Expected one of ${workerProjectIds.join(", ")}.`,
    );
  }

  const serverOutputPath = `${config.buildOutputPath}/server`;

  return {
    ...config,
    generatedWranglerConfigPath: `${serverOutputPath}/wrangler.json`,
    previewWranglerConfigPath: `${serverOutputPath}/wrangler.preview.json`,
    productionDomainWranglerConfigPath: `${serverOutputPath}/wrangler.domains.json`,
    serverOutputPath,
  };
}

export function requireWorkerIdentity(projectId, workerName) {
  const project = workerProjectConfig(projectId);
  const resolvedWorkerName =
    typeof workerName === "string" ? workerName.trim() : "";

  if (!resolvedWorkerName) {
    throw new Error(
      `Worker identity is required for project "${project.projectId}".`,
    );
  }

  if (resolvedWorkerName !== project.workerName) {
    throw new Error(
      `Worker identity mismatch for project "${project.projectId}": expected "${project.workerName}", received "${resolvedWorkerName}".`,
    );
  }

  return project;
}

export function assertWranglerWorkerIdentity(config, projectId, workerName) {
  const project = requireWorkerIdentity(projectId, workerName);

  if (!config || typeof config !== "object") {
    throw new Error(
      `Wrangler config is required for project "${project.projectId}" and Worker "${project.workerName}".`,
    );
  }

  for (const field of ["name", "topLevelName"]) {
    if (field === "topLevelName" && config[field] === undefined) {
      continue;
    }

    if (config[field] !== project.workerName) {
      throw new Error(
        `Wrangler ${field} mismatch for project "${project.projectId}": expected "${project.workerName}", received "${String(config[field])}".`,
      );
    }
  }

  return project;
}
