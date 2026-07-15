#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { previewAppConfig, previewCommentBody } from "./lib/preview-deploy.mjs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

async function githubRequest(path, options = {}) {
  const token = requiredEnv("GITHUB_TOKEN");
  const response = await fetch(`https://api.github.com/${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }

  return response.status === 204 ? null : response.json();
}

export async function upsertPreviewComment() {
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const prNumber = requiredEnv("PR_NUMBER");
  const app = previewAppConfig(process.env.PREVIEW_APP);
  const marker =
    process.env.PREVIEW_COMMENT_MARKER?.trim() || app.commentMarker;
  const runId = process.env.GITHUB_RUN_ID?.trim();
  const serverUrl =
    process.env.GITHUB_SERVER_URL?.trim() || "https://github.com";
  const runUrl = runId
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
    : "";
  const body = previewCommentBody({
    app: app.appId,
    marker,
    previewUrl: process.env.PREVIEW_URL,
    runUrl,
    sha: process.env.PREVIEW_SHA ?? process.env.GITHUB_SHA,
    status: process.env.PREVIEW_STATUS,
    workerName: process.env.WORKER_NAME,
  });
  const comments = await githubRequest(
    `repos/${repository}/issues/${prNumber}/comments?per_page=100`,
  );
  const existingComment = comments.find((comment) =>
    String(comment.body ?? "").includes(marker),
  );

  if (existingComment) {
    await githubRequest(
      `repos/${repository}/issues/comments/${existingComment.id}`,
      {
        body: JSON.stringify({ body }),
        method: "PATCH",
      },
    );
    process.stdout.write(`Updated preview comment ${existingComment.id}.\n`);
    return;
  }

  await githubRequest(`repos/${repository}/issues/${prNumber}/comments`, {
    body: JSON.stringify({ body }),
    method: "POST",
  });
  process.stdout.write("Created preview comment.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  upsertPreviewComment().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
