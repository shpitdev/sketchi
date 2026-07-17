import {
  assertWranglerWorkerIdentity,
  requireWorkerIdentity,
  workerProjectConfig,
} from "./worker-apps.mjs";

const MAX_WORKER_NAME_LENGTH = 63;

const webPreviewSurfaceProjects = {
  SKETCHI_ICONS_URL: "icons",
  SKETCHI_PLAYGROUND_URL: "playground",
};

const previewPipelineStreams = {
  d9044253316f4273a60298098f444a62: "e9fc3bcd35314fa39fc6a89018207acc",
  f687dab6e7d742c1a76834089e709462: "d95a1767edf246af8c637c5b9bf5a5c5",
};

export const previewProjects = {
  excalidraw: {
    commentMarker: "<!-- sketchi-excalidraw-preview -->",
    publicSurface: false,
    routePolicy: "internal canvas workspace; no public product domain",
    title: "Sketchi Excalidraw Workspace",
  },
  icons: {
    commentMarker: "<!-- sketchi-icons-preview -->",
    publicSurface: true,
    routePolicy: "icons.sketchi.app product surface",
    title: "Sketchi Icons",
  },
  "eval-harness": {
    commentMarker: "<!-- sketchi-playground-preview -->",
    publicSurface: false,
    routePolicy: "internal eval harness; no public product domain",
    title: "Sketchi Eval Harness",
  },
  playground: {
    commentMarker: "<!-- sketchi-studio-preview -->",
    publicSurface: true,
    routePolicy:
      "playground.sketchi.app product surface; authenticated Studio remains unexposed",
    title: "Sketchi Playground / Studio",
  },
  web: {
    commentMarker: "<!-- sketchi-web-preview -->",
    publicSurface: true,
    routePolicy: "sketchi.app and www.sketchi.app product surface",
    title: "Sketchi Web",
  },
};

export function previewProjectConfig(project) {
  const projectId = typeof project === "string" ? project.trim() : "";

  if (!projectId) {
    throw new Error(
      `Preview project selection is required. Expected one of ${Object.keys(previewProjects).join(", ")}.`,
    );
  }

  const config = previewProjects[projectId];

  if (!config) {
    throw new Error(
      `Unknown preview project "${projectId}". Expected one of ${Object.keys(previewProjects).join(", ")}.`,
    );
  }

  const worker = workerProjectConfig(projectId);

  return {
    ...worker,
    ...config,
  };
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
  const project = requireWorkerIdentity(input.projectId, input.workerName);
  const workerName = `${project.previewWorkerPrefix}-${prNumber}`;

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

function previewWorkerUrl(projectId, prNumber, workersDevSubdomain) {
  const project = previewProjectConfig(projectId);
  const workerName = previewWorkerName({
    projectId: project.projectId,
    prNumber,
    workerName: project.workerName,
  });

  return `https://${workerName}.${workersDevSubdomain}.workers.dev`;
}

function webPreviewVars(input) {
  const project = previewProjectConfig(input.projectId);
  requireWorkerIdentity(project.projectId, input.workerName);
  const workersDevSubdomain = normalizeWorkersDevSubdomain(
    input.workersDevSubdomain,
  );

  if (project.projectId !== "web" || !workersDevSubdomain) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(webPreviewSurfaceProjects).map(([envName, projectId]) => [
      envName,
      previewWorkerUrl(projectId, input.prNumber, workersDevSubdomain),
    ]),
  );
}

export function previewWranglerConfig(config, identity) {
  const project = assertWranglerWorkerIdentity(
    config,
    identity.projectId,
    identity.workerName,
  );
  const previewName = previewWorkerName({
    projectId: project.projectId,
    prNumber: identity.prNumber,
    workerName: project.workerName,
  });
  const nextConfig = structuredClone(config);

  nextConfig.name = previewName;
  nextConfig.topLevelName = previewName;
  nextConfig.workers_dev = true;
  nextConfig.preview_urls = false;
  nextConfig.r2_buckets = previewR2Buckets(nextConfig.r2_buckets);
  nextConfig.pipelines = previewPipelines(nextConfig.pipelines);

  delete nextConfig.route;
  delete nextConfig.routes;
  delete nextConfig.domains;
  delete nextConfig.custom_domain;
  delete nextConfig.custom_domains;

  const previewVars = webPreviewVars(identity);
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

function previewPipelines(pipelines) {
  if (!Array.isArray(pipelines)) {
    return pipelines;
  }

  return pipelines.map((pipeline) => {
    if (!pipeline || typeof pipeline !== "object") {
      return pipeline;
    }

    return {
      ...pipeline,
      ...(typeof pipeline.stream === "string" &&
      previewPipelineStreams[pipeline.stream]
        ? { stream: previewPipelineStreams[pipeline.stream] }
        : {}),
      ...(typeof pipeline.pipeline === "string" &&
      previewPipelineStreams[pipeline.pipeline]
        ? { pipeline: previewPipelineStreams[pipeline.pipeline] }
        : {}),
    };
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
  const project = previewProjectConfig(input.projectId);
  requireWorkerIdentity(project.projectId, input.workerName);
  const status = (input.status ?? "ready").trim().toLowerCase();
  const runUrl = input.runUrl?.trim();
  const previewUrl = input.previewUrl?.trim();
  const previewName = input.previewWorkerName?.trim();
  const sha = input.sha?.trim();
  const marker = input.marker?.trim() || project.commentMarker;
  const lines = [
    marker,
    `### ${project.title} Preview`,
    "",
    `Status: \`${status}\``,
    `- Surface: ${
      project.publicSurface
        ? "public product preview"
        : "internal preview; not linked from public navigation"
    }`,
    `- Project: \`${project.projectId}\``,
    `- Worker identity: \`${project.workerName}\``,
    `- Route policy: ${project.routePolicy}`,
  ];

  if (previewUrl) {
    lines.push(`- URL: ${previewUrl}`);
  }

  if (previewName) {
    lines.push(`- Preview Worker: \`${previewName}\``);
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
