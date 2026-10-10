import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractPreviewUrlCommand } from "../../02-extract-preview-url.mjs";
import { upsertPreviewComment } from "../../03-upsert-preview-comment.mjs";
import { deletePreview } from "../../04-delete-preview.mjs";

const marker = "<!-- sketchi-web-preview -->";
const commentsUrl =
  "https://api.github.com/repos/shpitdev/sketchi/issues/42/comments?per_page=100";
const pageTwoUrl = `${commentsUrl}&page=2`;
const botComment = {
  id: 200,
  body: `${marker}\nPreview`,
  user: { login: "github-actions[bot]", type: "Bot" },
};

function mockGithub(t, responses, extraEnv = {}) {
  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    GITHUB_TOKEN: "offline-test-token",
    GITHUB_REPOSITORY: "shpitdev/sketchi",
    PREVIEW_PROJECT_ID: "web",
    PR_NUMBER: "42",
    PREVIEW_COMMENT_MARKER: marker,
    PREVIEW_COMMENT_BOT_LOGIN: "",
    ...extraEnv,
  };
  t.after(() => {
    process.env = originalEnv;
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), ...options });
    const response = responses.shift();
    assert.ok(response, "unexpected GitHub request");
    return Response.json(response.data ?? {}, { headers: response.headers });
  });
  return calls;
}

test("URL command rejects an unrelated Worker without emitting an output", (t) => {
  const memory = new URL("../../../.memory/", import.meta.url);
  mkdirSync(memory, { recursive: true });
  const directory = mkdtempSync(join(memory.pathname, "preview-url-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const logPath = join(directory, "wrangler.log");
  writeFileSync(logPath, "https://other-worker.account.workers.dev\n");
  const output = t.mock.method(process.stdout, "write", () => true);
  assert.throws(
    () => extractPreviewUrlCommand([logPath, "--worker-name", "sketchi-web"]),
    /Failed to parse preview URL/,
  );
  assert.equal(output.mock.callCount(), 0);
});

test("upsert skips human markers and unanchored or unrelated bot comments", async (t) => {
  const calls = mockGithub(t, [
    {
      data: [
        {
          id: 100,
          body: `Quoted preview:\n${marker}`,
          user: { login: "reviewer", type: "User" },
        },
        {
          id: 101,
          body: `${marker}\nCopied preview`,
          user: { login: "reviewer", type: "User" },
        },
        { ...botComment, id: 102, body: `Quote:\n${marker}` },
        { ...botComment, id: 103, body: `${marker} not a marker line` },
        {
          ...botComment,
          id: 104,
          user: { login: "other-app[bot]", type: "Bot" },
        },
        botComment,
      ],
    },
    {},
  ]);
  await upsertPreviewComment();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, "PATCH");
  assert.equal(
    calls[1].url,
    "https://api.github.com/repos/shpitdev/sketchi/issues/comments/200",
  );
  assert.ok(JSON.parse(calls[1].body).body.startsWith(`${marker}\n`));
});

test("upsert follows Link next and updates the bot comment on page two", async (t) => {
  const calls = mockGithub(t, [
    {
      data: Array.from({ length: 100 }, (_, id) => ({
        id,
        body: "Discussion",
      })),
      headers: {
        link: `<${pageTwoUrl}>; rel="next", <${pageTwoUrl}>; rel="last"`,
      },
    },
    { data: [botComment] },
    {},
  ]);
  await upsertPreviewComment();
  assert.deepEqual(
    calls.map(({ url, method = "GET" }) => [url, method]),
    [
      [commentsUrl, "GET"],
      [pageTwoUrl, "GET"],
      [
        "https://api.github.com/repos/shpitdev/sketchi/issues/comments/200",
        "PATCH",
      ],
    ],
  );
});

test("upsert creates one comment only after all pages lack an owned marker", async (t) => {
  const calls = mockGithub(t, [
    { data: [], headers: { link: `<${pageTwoUrl}>; rel="next"` } },
    { data: [{ ...botComment, user: { login: "reviewer", type: "User" } }] },
    {},
  ]);
  await upsertPreviewComment();
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, pageTwoUrl);
  assert.equal(calls[2].method, "POST");
  assert.equal(calls[2].url, commentsUrl.split("?")[0]);
});

test("upsert supports a configured GitHub App bot identity", async (t) => {
  const calls = mockGithub(
    t,
    [
      {
        data: [
          botComment,
          {
            ...botComment,
            id: 300,
            user: { login: "preview-app[bot]", type: "Bot" },
          },
        ],
      },
      {},
    ],
    { PREVIEW_COMMENT_BOT_LOGIN: "preview-app[bot]" },
  );
  await upsertPreviewComment();
  assert.equal(
    calls[1].url,
    "https://api.github.com/repos/shpitdev/sketchi/issues/comments/300",
  );
});

test("upsert refuses pagination outside the GitHub API origin", async (t) => {
  const calls = mockGithub(t, [
    {
      data: [],
      headers: { link: '<https://other.example/comments>; rel="next"' },
    },
  ]);
  await assert.rejects(upsertPreviewComment(), /must remain on api.github.com/);
  assert.equal(calls.length, 1);
});

const workerApi =
  "https://api.cloudflare.com/client/v4/accounts/acct/workers/workers/sketchi-web";
const previewUrl = "https://pr-42-sketchi-web.dimethyl.workers.dev";

// `served` lists what the Preview hostname answers on each check: "retired" is
// Cloudflare's no-Preview 404; a number is the app's own response status.
function mockCloudflare(t, { deleteStatus = 200, served = [], env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "preview-delete-"));
  const output = join(dir, "output");
  writeFileSync(output, "");
  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CLOUDFLARE_API_TOKEN: "offline-test-token",
    GITHUB_OUTPUT: output,
    ...env,
  };
  t.after(() => {
    process.env = originalEnv;
    rmSync(dir, { force: true, recursive: true });
  });
  t.mock.method(process.stdout, "write", () => true);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const href = String(url);
    calls.push(`${options.method ?? "GET"} ${href.replace(/\?.*/, "")}`);
    if (href === workerApi) {
      return Response.json({
        result: {
          subdomain: {
            preview_url_suffix: "-sketchi-web.dimethyl.workers.dev",
          },
        },
      });
    }
    if (href === `${workerApi}/previews/pr-42`) {
      return Response.json({}, { status: deleteStatus });
    }
    if (href.startsWith(`${previewUrl}/?sketchi-cleanup=`)) {
      const next = served.shift();
      assert.ok(next !== undefined, "unexpected Preview URL check");
      return next === "retired"
        ? new Response("There is nothing here yet", {
            headers: { "x-preview-user-error": "true" },
            status: 404,
          })
        : new Response("app", { status: next });
    }
    assert.fail(`unexpected request ${href}`);
  });
  return { calls, outputs: () => readFileSync(output, "utf8") };
}

const cleanupArgs = ["--project", "web", "--pr-number", "42"];

test("cleanup reports deletion only after the Preview URL stops serving", async (t) => {
  const cloudflare = mockCloudflare(t, { served: [200, 200, "retired"] });
  const waits = [];
  await deletePreview(cleanupArgs, {
    attempts: 5,
    intervalMs: 7,
    wait: async (ms) => waits.push(ms),
  });
  assert.deepEqual(cloudflare.calls, [
    `GET ${workerApi}`,
    `DELETE ${workerApi}/previews/pr-42`,
    `GET ${previewUrl}/`,
    `GET ${previewUrl}/`,
    `GET ${previewUrl}/`,
  ]);
  assert.deepEqual(waits, [7, 7]);
  assert.equal(
    cloudflare.outputs(),
    `comment_status=deleted\npreview_name=pr-42\npreview_url=${previewUrl}\n`,
  );
});

test("cleanup fails as deletion-pending when a deleted Preview keeps serving", async (t) => {
  // An app 404 without Cloudflare's marker header is still the Preview serving.
  const cloudflare = mockCloudflare(t, { served: [200, 404, 200] });
  await assert.rejects(
    deletePreview(cleanupArgs, { attempts: 3, wait: async () => {} }),
    /still serves after 3 checks \(cloudflare\/workers-sdk#15945\)/,
  );
  assert.equal(
    cloudflare.outputs(),
    `comment_status=deletion-pending\npreview_name=pr-42\npreview_url=${previewUrl}\n`,
  );
});

test("cleanup treats an already-deleted Preview as deleted once its URL is retired", async (t) => {
  const cloudflare = mockCloudflare(t, {
    deleteStatus: 404,
    served: ["retired"],
  });
  await deletePreview(cleanupArgs, { wait: async () => {} });
  assert.match(cloudflare.outputs(), /^comment_status=deleted\n/);
});

test("cleanup surfaces delete failures without checking or reporting the URL", async (t) => {
  const cloudflare = mockCloudflare(t, { deleteStatus: 500 });
  await assert.rejects(
    deletePreview(cleanupArgs, { wait: async () => {} }),
    /HTTP 500/,
  );
  assert.equal(cloudflare.calls.length, 2);
  assert.equal(cloudflare.outputs(), "");
});

test("cleanup rejects malformed PR targets and skips without credentials", async (t) => {
  const cloudflare = mockCloudflare(t, {
    env: { CLOUDFLARE_API_TOKEN: "" },
  });
  for (const value of ["42oops", "42.9", "4e2", "9007199254740993"]) {
    await assert.rejects(
      deletePreview(["--project", "web", "--pr-number", value]),
      /positive.*integer/,
    );
  }
  await deletePreview(cleanupArgs);
  assert.deepEqual(cloudflare.calls, []);
  assert.equal(cloudflare.outputs(), "");
});
