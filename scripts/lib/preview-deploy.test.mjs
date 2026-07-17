import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPreviewUrl,
  normalizeWorkersDevSubdomain,
  previewCommentBody,
  previewProjectConfig,
  previewWorkerName,
  previewWranglerConfig,
} from "./preview-deploy.mjs";
import { workerProjectConfig } from "./worker-apps.mjs";

test("previewProjectConfig returns project and Worker metadata", () => {
  assert.deepEqual(previewProjectConfig("icons"), {
    ...workerProjectConfig("icons"),
    commentMarker: "<!-- sketchi-icons-preview -->",
    publicSurface: true,
    routePolicy: "icons.sketchi.app product surface",
    title: "Sketchi Icons",
  });
});

test("playground project preserves the durable Studio preview Worker", () => {
  assert.deepEqual(previewProjectConfig("playground"), {
    ...workerProjectConfig("playground"),
    commentMarker: "<!-- sketchi-studio-preview -->",
    publicSurface: true,
    routePolicy:
      "playground.sketchi.app product surface; authenticated Studio remains unexposed",
    title: "Sketchi Playground / Studio",
  });
});

test("eval-harness keeps its durable internal Worker", () => {
  assert.deepEqual(previewProjectConfig("eval-harness"), {
    ...workerProjectConfig("eval-harness"),
    commentMarker: "<!-- sketchi-playground-preview -->",
    publicSurface: false,
    routePolicy: "internal eval harness; no public product domain",
    title: "Sketchi Eval Harness",
  });
});

test("previewProjectConfig requires an explicit project selection", () => {
  assert.throws(
    () => previewProjectConfig(),
    /Preview project selection is required/,
  );
});

test("previewWorkerName uses the registered durable prefix", () => {
  assert.equal(
    previewWorkerName({
      projectId: "playground",
      prNumber: 42,
      workerName: "sketchi-studio",
    }),
    "sketchi-studio-pr-42",
  );
  assert.equal(
    previewWorkerName({
      projectId: "eval-harness",
      prNumber: 42,
      workerName: "sketchi-playground",
    }),
    "sketchi-playground-pr-42",
  );
});

test("previewWorkerName rejects invalid numbers and identity mismatches", () => {
  assert.throws(
    () =>
      previewWorkerName({
        projectId: "playground",
        prNumber: "nope",
        workerName: "sketchi-studio",
      }),
    /positive integer/,
  );
  assert.throws(
    () =>
      previewWorkerName({
        projectId: "playground",
        prNumber: 42,
        workerName: "sketchi-playground",
      }),
    /Worker identity mismatch/,
  );
});

test("normalizeWorkersDevSubdomain accepts account subdomain or host", () => {
  assert.equal(normalizeWorkersDevSubdomain("Dimethyl"), "dimethyl");
  assert.equal(
    normalizeWorkersDevSubdomain("dimethyl.workers.dev"),
    "dimethyl",
  );
});

test("normalizeWorkersDevSubdomain rejects invalid hosts", () => {
  assert.throws(
    () => normalizeWorkersDevSubdomain("https://dimethyl.workers.dev"),
    /Invalid workers\.dev subdomain/,
  );
});

test("playground preview preserves Studio data contracts and isolates routes", () => {
  const previewConfig = previewWranglerConfig(
    {
      name: "sketchi-studio",
      topLevelName: "sketchi-studio",
      route: "playground.sketchi.app/*",
      routes: ["playground.sketchi.app/*"],
      domains: [{ pattern: "playground.sketchi.app" }],
      custom_domain: true,
      vars: {
        SKETCHI_AI_GATEWAY_ID: "google-ai-studio",
        SKETCHI_APP_SURFACE: "studio",
      },
      r2_buckets: [
        {
          binding: "SKETCHI_ARTIFACTS",
          bucket_name: "sketchi-studio-codemode-artifacts-production",
          preview_bucket_name: "sketchi-studio-codemode-artifacts-preview",
        },
      ],
      pipelines: [
        {
          binding: "CODEMODE_USAGE_EVENTS",
          remote: true,
          stream: "d9044253316f4273a60298098f444a62",
        },
        {
          binding: "CODEMODE_USAGE_ISSUES",
          pipeline: "f687dab6e7d742c1a76834089e709462",
          remote: true,
        },
      ],
    },
    {
      projectId: "playground",
      prNumber: 42,
      workerName: "sketchi-studio",
    },
  );

  assert.equal(previewConfig.name, "sketchi-studio-pr-42");
  assert.equal(previewConfig.topLevelName, "sketchi-studio-pr-42");
  assert.equal(previewConfig.workers_dev, true);
  assert.equal(previewConfig.preview_urls, false);
  assert.equal(previewConfig.route, undefined);
  assert.equal(previewConfig.routes, undefined);
  assert.equal(previewConfig.domains, undefined);
  assert.equal(previewConfig.custom_domain, undefined);
  assert.deepEqual(previewConfig.vars, {
    SKETCHI_AI_GATEWAY_ID: "google-ai-studio",
    SKETCHI_APP_SURFACE: "studio",
  });
  assert.deepEqual(previewConfig.r2_buckets, [
    {
      binding: "SKETCHI_ARTIFACTS",
      bucket_name: "sketchi-studio-codemode-artifacts-preview",
      preview_bucket_name: "sketchi-studio-codemode-artifacts-preview",
    },
  ]);
  assert.deepEqual(previewConfig.pipelines, [
    {
      binding: "CODEMODE_USAGE_EVENTS",
      remote: true,
      stream: "e9fc3bcd35314fa39fc6a89018207acc",
    },
    {
      binding: "CODEMODE_USAGE_ISSUES",
      pipeline: "d95a1767edf246af8c637c5b9bf5a5c5",
      remote: true,
    },
  ]);
});

test("preview config fails closed when selected project and source Worker differ", () => {
  assert.throws(
    () =>
      previewWranglerConfig(
        { name: "sketchi-playground" },
        {
          projectId: "playground",
          prNumber: 42,
          workerName: "sketchi-studio",
        },
      ),
    /Wrangler name mismatch for project "playground"/,
  );
});

test("web previews map SKETCHI_PLAYGROUND_URL to the playground project", () => {
  const previewConfig = previewWranglerConfig(
    {
      name: "sketchi-web",
      vars: {
        SKETCHI_APP_SURFACE: "web",
      },
    },
    {
      projectId: "web",
      prNumber: 42,
      workerName: "sketchi-web",
      workersDevSubdomain: "dimethyl",
    },
  );

  assert.deepEqual(previewConfig.vars, {
    SKETCHI_APP_SURFACE: "web",
    SKETCHI_ICONS_URL: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
    SKETCHI_PLAYGROUND_URL: "https://sketchi-studio-pr-42.dimethyl.workers.dev",
  });
});

test("non-web preview vars remain unchanged", () => {
  const previewConfig = previewWranglerConfig(
    {
      name: "sketchi-icons",
      vars: {
        SKETCHI_APP_SURFACE: "icons",
      },
    },
    {
      projectId: "icons",
      prNumber: 42,
      workerName: "sketchi-icons",
      workersDevSubdomain: "dimethyl",
    },
  );

  assert.deepEqual(previewConfig.vars, {
    SKETCHI_APP_SURFACE: "icons",
  });
});

test("extractPreviewUrl prefers the URL for the requested Worker", () => {
  const log = [
    "Uploaded sketchi-studio",
    "https://sketchi-studio.account.workers.dev",
    "Uploaded sketchi-studio-pr-42",
    "https://sketchi-studio-pr-42.account.workers.dev",
  ].join("\n");

  assert.equal(
    extractPreviewUrl(log, "sketchi-studio-pr-42"),
    "https://sketchi-studio-pr-42.account.workers.dev",
  );
});

test("previewCommentBody exposes project and Worker identities separately", () => {
  assert.equal(
    previewCommentBody({
      previewUrl: "https://sketchi-studio-pr-42.account.workers.dev",
      previewWorkerName: "sketchi-studio-pr-42",
      projectId: "playground",
      runUrl: "https://github.com/shpitdev/sketchi/actions/runs/1",
      sha: "abcdef1234567890",
      status: "ready",
      workerName: "sketchi-studio",
    }),
    [
      "<!-- sketchi-studio-preview -->",
      "### Sketchi Playground / Studio Preview",
      "",
      "Status: `ready`",
      "- Surface: public product preview",
      "- Project: `playground`",
      "- Worker identity: `sketchi-studio`",
      "- Route policy: playground.sketchi.app product surface; authenticated Studio remains unexposed",
      "- URL: https://sketchi-studio-pr-42.account.workers.dev",
      "- Preview Worker: `sketchi-studio-pr-42`",
      "- Commit: `abcdef123456`",
      "- Workflow run: https://github.com/shpitdev/sketchi/actions/runs/1",
      "",
    ].join("\n"),
  );
});

test("previewCommentBody marks deleted previews", () => {
  assert.match(
    previewCommentBody({
      previewWorkerName: "sketchi-icons-pr-42",
      projectId: "icons",
      status: "deleted",
      workerName: "sketchi-icons",
    }),
    /Preview Worker cleanup has completed/,
  );
});
