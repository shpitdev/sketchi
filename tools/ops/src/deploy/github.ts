import { Console, Effect, Option, Redacted, Schema } from "effect";
import { HttpClientRequest } from "effect/http";

import { optionalEnv, requiredEnv } from "../outputs";
import { attempt, opsError } from "../process";
import { decodeBody, send, type JsonResponse } from "./http";
import { previewCommentBody, previewProjectConfig } from "./preview";

const API_ORIGIN = "https://api.github.com";

const Comments = Schema.Array(
	Schema.Struct({
		id: Schema.Number,
		body: Schema.optional(Schema.NullOr(Schema.String)),
		user: Schema.optional(
			Schema.NullOr(Schema.Struct({ login: Schema.String, type: Schema.String })),
		),
	}),
);

const githubRequest = Effect.fn("ops.github.request")(function* (
	token: Redacted.Redacted<string>,
	request: HttpClientRequest.HttpClientRequest,
) {
	const response = yield* send(
		request.pipe(
			HttpClientRequest.bearerToken(token),
			HttpClientRequest.setHeaders({
				accept: "application/vnd.github+json",
				"x-github-api-version": "2022-11-28",
			}),
		),
	);
	if (!response.ok) {
		return yield* opsError(
			`GitHub API request failed with HTTP ${response.status}: ${response.text}`,
		);
	}
	return response;
});

function nextPage(response: JsonResponse) {
	const link = response.headers["link"]?.split(",").find((part) => /;\s*rel="next"/.test(part));
	return link?.match(/<([^>]+)>/)?.[1];
}

/**
 * Creates or updates this project's sticky Preview comment on the PR. Only a comment by the
 * configured bot whose body starts with the project's marker is ever edited, and pagination
 * never leaves the GitHub API origin, so the token goes nowhere else.
 */
export const upsertPreviewComment = Effect.fn("ops.preview.comment")(function* () {
	const token = Redacted.make(yield* requiredEnv("GITHUB_TOKEN"));
	const repository = yield* requiredEnv("GITHUB_REPOSITORY");
	const prNumber = yield* requiredEnv("PR_NUMBER");
	const projectId = yield* requiredEnv("PREVIEW_PROJECT_ID");
	const project = yield* attempt(() => previewProjectConfig(projectId));
	const env = (name: string) => optionalEnv(name).pipe(Effect.map(Option.getOrUndefined));
	const previewUrl = yield* env("PREVIEW_URL");
	const previewName = yield* env("PREVIEW_NAME");
	const sha = (yield* env("PREVIEW_SHA")) ?? (yield* env("GITHUB_SHA"));
	const status = yield* env("PREVIEW_STATUS");
	const marker = (yield* env("PREVIEW_COMMENT_MARKER")) ?? project.commentMarker;
	const botLogin = (yield* env("PREVIEW_COMMENT_BOT_LOGIN")) ?? "github-actions[bot]";
	const runId = yield* env("GITHUB_RUN_ID");
	const serverUrl = (yield* env("GITHUB_SERVER_URL")) ?? "https://github.com";
	const body = yield* attempt(() =>
		previewCommentBody({
			marker,
			previewUrl,
			previewName,
			projectId: project.projectId,
			runUrl: runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : "",
			sha,
			status,
			workerName: project.workerName,
		}),
	);

	let page: string | undefined =
		`${API_ORIGIN}/repos/${repository}/issues/${prNumber}/comments?per_page=100`;
	while (page) {
		const url = new URL(page, `${API_ORIGIN}/`);
		if (url.origin !== API_ORIGIN) {
			return yield* opsError("GitHub pagination must remain on api.github.com.");
		}
		const response = yield* githubRequest(token, HttpClientRequest.get(url.href));
		const comments = yield* decodeBody(Comments, response, "GitHub returned unexpected comments");
		const owned = comments.find(
			(comment) =>
				comment.user?.type === "Bot" &&
				comment.user.login === botLogin &&
				(comment.body === marker ||
					comment.body?.startsWith(`${marker}\n`) ||
					comment.body?.startsWith(`${marker}\r\n`)),
		);
		if (owned) {
			yield* githubRequest(
				token,
				HttpClientRequest.patch(
					`${API_ORIGIN}/repos/${repository}/issues/comments/${owned.id}`,
				).pipe(HttpClientRequest.bodyJsonUnsafe({ body })),
			);
			yield* Console.log(`Updated preview comment ${owned.id}.`);
			return;
		}
		page = nextPage(response);
	}
	yield* githubRequest(
		token,
		HttpClientRequest.post(`${API_ORIGIN}/repos/${repository}/issues/${prNumber}/comments`).pipe(
			HttpClientRequest.bodyJsonUnsafe({ body }),
		),
	);
	yield* Console.log("Created preview comment.");
});
