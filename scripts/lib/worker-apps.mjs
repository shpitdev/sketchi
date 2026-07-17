const workerApps = {
  excalidraw: {
    buildOutputPath: "dist/apps/excalidraw",
    nxProjectId: "excalidraw",
    projectRoot: "apps/excalidraw",
    workerName: "sketchi-excalidraw",
    wranglerInputConfigPath: "apps/excalidraw/wrangler.jsonc",
  },
  "eval-harness": {
    buildOutputPath: "dist/apps/eval-harness",
    nxProjectId: "eval-harness",
    projectRoot: "apps/eval-harness",
    workerName: "sketchi-playground",
    wranglerInputConfigPath: "apps/eval-harness/wrangler.jsonc",
  },
  icons: {
    buildOutputPath: "dist/apps/icons",
    nxProjectId: "icons",
    projectRoot: "apps/icons",
    workerName: "sketchi-icons",
    wranglerInputConfigPath: "apps/icons/wrangler.jsonc",
  },
  studio: {
    buildOutputPath: "dist/apps/studio",
    nxProjectId: "studio",
    projectRoot: "apps/studio",
    workerName: "sketchi-studio",
    wranglerInputConfigPath: "apps/studio/wrangler.jsonc",
  },
  web: {
    buildOutputPath: "dist/apps/web",
    nxProjectId: "web",
    projectRoot: "apps/web",
    workerName: "sketchi-web",
    wranglerInputConfigPath: "apps/web/wrangler.jsonc",
  },
};

export const workerAppIds = Object.freeze(Object.keys(workerApps));

export function workerAppConfig(app) {
  const appId = typeof app === "string" ? app.trim() : "";

  if (!appId) {
    throw new Error(
      `Worker app/project selection is required. Expected one of ${workerAppIds.join(", ")}.`,
    );
  }

  const config = workerApps[appId];

  if (!config) {
    throw new Error(
      `Unknown Worker app "${appId}". Expected one of ${workerAppIds.join(", ")}.`,
    );
  }

  const serverOutputPath = `${config.buildOutputPath}/server`;

  return {
    appId,
    ...config,
    generatedWranglerConfigPath: `${serverOutputPath}/wrangler.json`,
    previewWranglerConfigPath: `${serverOutputPath}/wrangler.preview.json`,
    productionDomainWranglerConfigPath: `${serverOutputPath}/wrangler.domains.json`,
    serverOutputPath,
  };
}
