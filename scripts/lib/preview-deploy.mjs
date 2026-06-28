const MAX_WORKER_NAME_LENGTH = 63;

const webPreviewSurfaceApps = {
  SKETCHI_EXCALIDRAW_URL: "excalidraw",
  SKETCHI_ICONS_URL: "icons",
  SKETCHI_PLAYGROUND_URL: "playground",
};

export const previewApps = {
  excalidraw: {
    commentMarker: "<!-- sketchi-excalidraw-preview -->",
    title: "Sketchi Excalidraw",
    workerPrefix: "sketchi-excalidraw-pr",
  },
  icons: {
    commentMarker: "<!-- sketchi-icons-preview -->",
    title: "Sketchi Icons",
    workerPrefix: "sketchi-icons-pr",
  },
  playground: {
    commentMarker: "<!-- sketchi-playground-preview -->",
    title: "Sketchi Playground",
    workerPrefix: "sketchi-playground-pr",
  },
  studio: {
    commentMarker: "<!-- sketchi-studio-preview -->",
    title: "Sketchi Studio",
    workerPrefix: "sketchi-studio-pr",
  },
  web: {
    commentMarker: "<!-- sketchi-web-preview -->",
    title: "Sketchi Web",
    workerPrefix: "sketchi-web-pr",
  },
};

export function previewAppConfig(app = "playground") {
  const appId = String(app ?? "playground").trim();
  const config = previewApps[appId];

  if (!config) {
    throw new Error(
      `Unknown preview app "${appId}". Expected one of ${Object.keys(previewApps).join(", ")}.`,
    );
  }

  return { appId, ...config };
}

export function normalizePrNumber(value) {
  const prNumber = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error("PR number must be a positive integer.");
  }

  return prNumber;
}

export function previewWorkerName(input) {
  const prNumber = normalizePrNumber(input.prNumber);
  const appConfig = previewAppConfig(input.app);
  const rawPrefix = (input.workerPrefix ?? appConfig.workerPrefix).trim();
  const prefix = rawPrefix
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (!prefix) {
    throw new Error("Preview worker prefix must contain letters or numbers.");
  }

  const workerName = `${prefix}-${prNumber}`;

  if (
    workerName.length > MAX_WORKER_NAME_LENGTH ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(workerName)
  ) {
    throw new Error(
      `Invalid preview worker name "${workerName}". Use a shorter alphanumeric/hyphen prefix.`,
    );
  }

  return workerName;
}

export function normalizeWorkersDevSubdomain(value) {
  const trimmed = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.workers\.dev$/, "");

  if (!trimmed) {
    return null;
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(trimmed)) {
    throw new Error(
      `Invalid workers.dev subdomain "${value}". Expected an account subdomain such as "example".`,
    );
  }

  return trimmed;
}

function previewWorkerUrl(app, prNumber, workersDevSubdomain) {
  return `https://${previewWorkerName({
    app,
    prNumber,
  })}.${workersDevSubdomain}.workers.dev`;
}

function webPreviewVars(input) {
  const appConfig = previewAppConfig(input.app);
  const workersDevSubdomain = normalizeWorkersDevSubdomain(
    input.workersDevSubdomain,
  );

  if (appConfig.appId !== "web" || !workersDevSubdomain) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(webPreviewSurfaceApps).map(([envName, app]) => [
      envName,
      previewWorkerUrl(app, input.prNumber, workersDevSubdomain),
    ]),
  );
}

export function previewWranglerConfig(config, workerName, options = {}) {
  const nextConfig = structuredClone(config);

  nextConfig.name = workerName;
  nextConfig.topLevelName = workerName;
  nextConfig.workers_dev = true;
  nextConfig.preview_urls = false;
  nextConfig.r2_buckets = previewR2Buckets(nextConfig.r2_buckets);

  delete nextConfig.route;
  delete nextConfig.routes;
  delete nextConfig.domains;
  delete nextConfig.custom_domain;
  delete nextConfig.custom_domains;

  const previewVars = webPreviewVars(options);
  if (Object.keys(previewVars).length > 0) {
    nextConfig.vars = {
      ...(nextConfig.vars ?? {}),
      ...previewVars,
    };
  }

  return nextConfig;
}

function previewR2Buckets(buckets) {
  if (!Array.isArray(buckets)) {
    return buckets;
  }

  return buckets.map((bucket) => {
    if (
      bucket &&
      typeof bucket === "object" &&
      typeof bucket.preview_bucket_name === "string" &&
      bucket.preview_bucket_name.length > 0
    ) {
      return {
        ...bucket,
        bucket_name: bucket.preview_bucket_name,
      };
    }

    return bucket;
  });
}

export function extractPreviewUrl(logText, workerName = "") {
  const urls = [
    ...logText.matchAll(/https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev\b/g),
  ].map(([url]) => url);
  const workerUrl = workerName
    ? urls.findLast((url) => url.includes(`://${workerName}.`))
    : undefined;

  return workerUrl ?? urls.at(-1) ?? null;
}

export function previewCommentBody(input) {
  const appConfig = previewAppConfig(input.app);
  const status = (input.status ?? "ready").trim().toLowerCase();
  const runUrl = input.runUrl?.trim();
  const previewUrl = input.previewUrl?.trim();
  const workerName = input.workerName?.trim();
  const sha = input.sha?.trim();
  const marker = input.marker?.trim() || appConfig.commentMarker;
  const lines = [
    marker,
    `### ${appConfig.title} Preview`,
    "",
    `Status: \`${status}\``,
  ];

  if (previewUrl) {
    lines.push(`- URL: ${previewUrl}`);
  }

  if (workerName) {
    lines.push(`- Worker: \`${workerName}\``);
  }

  if (sha) {
    lines.push(`- Commit: \`${sha.slice(0, 12)}\``);
  }

  if (runUrl) {
    lines.push(`- Workflow run: ${runUrl}`);
  }

  if (status === "deleted") {
    lines.push("", "Preview Worker cleanup has completed.");
  }

  if (status === "unconfigured") {
    lines.push(
      "",
      "Preview deploy is wired, but Cloudflare credentials are not configured for this repository yet.",
    );
  }

  return `${lines.join("\n")}\n`;
}
