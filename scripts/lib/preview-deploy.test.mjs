import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPreviewUrl,
  normalizeWorkersDevSubdomain,
  previewAppConfig,
  previewCommentBody,
  previewWorkerName,
  previewWranglerConfig,
} from "./preview-deploy.mjs";

test("previewAppConfig returns app-scoped preview metadata", () => {
  assert.deepEqual(previewAppConfig("icons"), {
    appId: "icons",
    commentMarker: "<!-- sketchi-icons-preview -->",
    title: "Sketchi Icons",
    workerPrefix: "sketchi-icons-pr",
  });
});

test("previewAppConfig includes the studio preview Worker", () => {
  assert.deepEqual(previewAppConfig("studio"), {
    appId: "studio",
    commentMarker: "<!-- sketchi-studio-preview -->",
    title: "Sketchi Studio",
    workerPrefix: "sketchi-studio-pr",
  });
});

test("previewWorkerName creates a stable Cloudflare-safe PR worker name", () => {
  assert.equal(
    previewWorkerName({ prNumber: 42, workerPrefix: "Sketchi Playground PR" }),
    "sketchi-playground-pr-42",
  );
});

test("previewWorkerName defaults to the selected app prefix", () => {
  assert.equal(
    previewWorkerName({ app: "web", prNumber: 42 }),
    "sketchi-web-pr-42",
  );
});

test("previewWorkerName rejects invalid PR numbers", () => {
  assert.throws(
    () => previewWorkerName({ prNumber: "nope" }),
    /positive integer/,
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

test("previewWranglerConfig isolates preview worker settings", () => {
  const previewConfig = previewWranglerConfig(
    {
      name: "sketchi-playground",
      topLevelName: "sketchi-playground",
      route: "playground.sketchi.app/*",
      routes: ["playground.sketchi.app/*"],
      domains: [{ pattern: "playground.sketchi.app" }],
      custom_domain: true,
      vars: {
        SKETCHI_AI_GATEWAY_ID: "google-ai-studio",
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
          binding: "CODEMODE_USAGE_ISSUES_LEGACY",
          pipeline: "f687dab6e7d742c1a76834089e709462",
          remote: true,
        },
      ],
    },
    "sketchi-playground-pr-42",
  );

  assert.equal(previewConfig.name, "sketchi-playground-pr-42");
  assert.equal(previewConfig.topLevelName, "sketchi-playground-pr-42");
  assert.equal(previewConfig.workers_dev, true);
  assert.equal(previewConfig.preview_urls, false);
  assert.equal(previewConfig.route, undefined);
  assert.equal(previewConfig.routes, undefined);
  assert.equal(previewConfig.domains, undefined);
  assert.equal(previewConfig.custom_domain, undefined);
  assert.deepEqual(previewConfig.vars, {
    SKETCHI_AI_GATEWAY_ID: "google-ai-studio",
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
      binding: "CODEMODE_USAGE_ISSUES_LEGACY",
      pipeline: "d95a1767edf246af8c637c5b9bf5a5c5",
      remote: true,
    },
  ]);
});

test("previewWranglerConfig injects sibling app URLs for web previews", () => {
  const previewConfig = previewWranglerConfig(
    {
      name: "sketchi-web",
      vars: {
        SKETCHI_APP_SURFACE: "web",
      },
    },
    "sketchi-web-pr-42",
    {
      app: "web",
      prNumber: 42,
      workersDevSubdomain: "dimethyl",
    },
  );

  assert.deepEqual(previewConfig.vars, {
    SKETCHI_APP_SURFACE: "web",
    SKETCHI_ICONS_URL: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
    SKETCHI_PLAYGROUND_URL: "https://sketchi-studio-pr-42.dimethyl.workers.dev",
  });
});

test("previewWranglerConfig leaves non-web preview vars unchanged", () => {
  const previewConfig = previewWranglerConfig(
    {
      name: "sketchi-icons",
      vars: {
        SKETCHI_APP_SURFACE: "icons",
      },
    },
    "sketchi-icons-pr-42",
    {
      app: "icons",
      prNumber: 42,
      workersDevSubdomain: "dimethyl",
    },
  );

  assert.deepEqual(previewConfig.vars, {
    SKETCHI_APP_SURFACE: "icons",
  });
});

test("extractPreviewUrl prefers the URL for the requested worker", () => {
  const log = [
    "Uploaded sketchi-playground",
    "https://sketchi-playground.account.workers.dev",
    "Uploaded sketchi-playground-pr-42",
    "https://sketchi-playground-pr-42.account.workers.dev",
  ].join("\n");

  assert.equal(
    extractPreviewUrl(log, "sketchi-playground-pr-42"),
    "https://sketchi-playground-pr-42.account.workers.dev",
  );
});

test("previewCommentBody includes ready preview details", () => {
  assert.equal(
    previewCommentBody({
      app: "playground",
      previewUrl: "https://sketchi-playground-pr-42.account.workers.dev",
      runUrl:
        "https://github.com/anand-testcompare/sketchi-v2-lab/actions/runs/1",
      sha: "abcdef1234567890",
      status: "ready",
      workerName: "sketchi-playground-pr-42",
    }),
    [
      "<!-- sketchi-playground-preview -->",
      "### Sketchi Eval Harness Preview",
      "",
      "Status: `ready`",
      "- URL: https://sketchi-playground-pr-42.account.workers.dev",
      "- Worker: `sketchi-playground-pr-42`",
      "- Commit: `abcdef123456`",
      "- Workflow run: https://github.com/anand-testcompare/sketchi-v2-lab/actions/runs/1",
      "",
    ].join("\n"),
  );
});

test("previewCommentBody marks deleted previews", () => {
  assert.match(
    previewCommentBody({
      app: "icons",
      status: "deleted",
      workerName: "sketchi-playground-pr-42",
    }),
    /Preview Worker cleanup has completed/,
  );
});
