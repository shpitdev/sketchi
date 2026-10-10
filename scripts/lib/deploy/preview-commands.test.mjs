import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { extractPreviewUrlCommand } from "../../02-extract-preview-url.mjs";
import { upsertPreviewComment } from "../../03-upsert-preview-comment.mjs";

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
