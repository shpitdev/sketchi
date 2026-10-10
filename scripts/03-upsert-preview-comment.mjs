#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { previewCommentBody, previewProjectConfig } from "./lib/deploy/preview.mjs";

function requiredEnv(name) {
	const value = process.env[name]?.trim();

	if (!value) {
		throw new Error(`${name} is required.`);
	}

	return value;
}

async function githubRequest(path, options = {}) {
	const token = requiredEnv("GITHUB_TOKEN");
	const url = new URL(path, "https://api.github.com/");
	if (url.origin !== "https://api.github.com") {
		throw new Error("GitHub pagination must remain on api.github.com.");
	}
	const response = await fetch(url.href, {
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

	const nextLink = response.headers
		.get("link")
		?.split(",")
		.find((link) => /;\s*rel="next"/.test(link));
	return {
		data: response.status === 204 ? null : await response.json(),
		nextUrl: nextLink?.match(/<([^>]+)>/)?.[1] ?? null,
	};
}

export async function upsertPreviewComment() {
	const repository = requiredEnv("GITHUB_REPOSITORY");
	const prNumber = requiredEnv("PR_NUMBER");
	const project = previewProjectConfig(requiredEnv("PREVIEW_PROJECT_ID"));
	const marker = process.env.PREVIEW_COMMENT_MARKER?.trim() || project.commentMarker;
	const botLogin = process.env.PREVIEW_COMMENT_BOT_LOGIN?.trim() || "github-actions[bot]";
	const runId = process.env.GITHUB_RUN_ID?.trim();
	const serverUrl = process.env.GITHUB_SERVER_URL?.trim() || "https://github.com";
	const runUrl = runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : "";
	const body = previewCommentBody({
		marker,
		previewUrl: process.env.PREVIEW_URL,
		previewName: process.env.PREVIEW_NAME,
		projectId: project.projectId,
		runUrl,
		sha: process.env.PREVIEW_SHA ?? process.env.GITHUB_SHA,
		status: process.env.PREVIEW_STATUS,
		workerName: project.workerName,
	});
	let commentsUrl = `repos/${repository}/issues/${prNumber}/comments?per_page=100`;
	while (commentsUrl) {
		const { data: comments, nextUrl } = await githubRequest(commentsUrl);
		const existingComment = comments.find(
			(comment) =>
				comment.user?.type === "Bot" &&
				comment.user.login === botLogin &&
				(comment.body === marker ||
					comment.body?.startsWith(`${marker}\n`) ||
					comment.body?.startsWith(`${marker}\r\n`)),
		);

		if (existingComment) {
			await githubRequest(`repos/${repository}/issues/comments/${existingComment.id}`, {
				body: JSON.stringify({ body }),
				method: "PATCH",
			});
			process.stdout.write(`Updated preview comment ${existingComment.id}.\n`);
			return;
		}
		commentsUrl = nextUrl;
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
