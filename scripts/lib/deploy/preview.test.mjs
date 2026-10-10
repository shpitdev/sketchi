import assert from "node:assert/strict";
import test from "node:test";

import {
	extractPreviewUrl,
	normalizePrNumber,
	previewCommentBody,
	previewProjectConfig,
	previewName,
	validatePreviewConfig,
	officialPreviewUrl,
	webPreviewUrls,
} from "./preview.mjs";
import { workerProjectConfig, workerProjectIds } from "../worker-apps.mjs";
import { unstable_readConfig } from "wrangler";

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
		routePolicy: "playground.sketchi.app product surface; authenticated Studio remains unexposed",
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
	assert.throws(() => previewProjectConfig(), /Preview project selection is required/);
});

test("PR preview names require entire decimal inputs and positive safe integers", () => {
	for (const value of [42, "42", "0042", Number.MAX_SAFE_INTEGER]) {
		assert.equal(normalizePrNumber(value), Number(value));
		assert.equal(previewName(value), `pr-${Number(value)}`);
	}
	for (const value of [
		"42oops",
		"42.9",
		"4e2",
		"9007199254740993",
		"",
		" 42",
		"42\n",
		"+42",
		0,
		-1,
	]) {
		assert.throws(() => previewName(value), /positive.*integer/);
	}
});

test("all checked-in Preview settings retain runtime bindings without production data", async () => {
	for (const projectId of workerProjectIds) {
		const config = await unstable_readConfig({
			config: workerProjectConfig(projectId).wranglerInputConfigPath,
		});
		assert.equal(validatePreviewConfig(config, projectId).projectId, projectId);
		assert.equal(config.name, workerProjectConfig(projectId).workerName);
		if (projectId === "playground") {
			assert.notEqual(config.previews.r2_buckets[0].bucket_name, config.r2_buckets[0].bucket_name);
			for (const pipeline of config.previews.pipelines) {
				assert.ok(!config.pipelines.some((p) => p.stream === pipeline.stream));
			}
		}
	}
});

test("Preview validation rejects production targets, missing bindings, and unreviewed resources", async () => {
	const original = await unstable_readConfig({
		config: workerProjectConfig("playground").wranglerInputConfigPath,
	});
	for (const mutate of [
		(config) => {
			delete config.previews;
		},
		(config) => {
			config.name = "sketchi-playground";
		},
		(config) => {
			config.previews.r2_buckets = config.r2_buckets;
		},
		(config) => {
			config.previews.pipelines = config.pipelines;
		},
		(config) => {
			config.previews.pipelines.pop();
		},
		(config) => {
			config.previews.pipelines[1] = config.previews.pipelines[0];
		},
		(config) => {
			config.previews.r2_buckets[0].bucket_name = "unreviewed-bucket";
		},
		(config) => {
			config.previews.r2_buckets[0].preview_bucket_name = config.r2_buckets[0].bucket_name;
		},
		(config) => {
			config.previews.pipelines[0].stream = config.pipelines[1].stream;
		},
		(config) => {
			delete config.previews.ai;
		},
		(config) => {
			config.previews.services = [{ binding: "AUTH", service: "production-auth" }];
		},
	]) {
		const config = structuredClone(original);
		mutate(config);
		assert.throws(() => validatePreviewConfig(config, "playground"));
	}
});

test("Preview Pipelines reject the legacy pipeline key, alone or next to a preview stream", async () => {
	const original = await unstable_readConfig({
		config: workerProjectConfig("playground").wranglerInputConfigPath,
	});
	const productionStream = original.pipelines[0].stream;
	const previewStream = original.previews.pipelines[0].stream;
	for (const entry of [
		{ pipeline: productionStream },
		{ pipeline: previewStream },
		{ stream: previewStream, pipeline: productionStream },
	]) {
		const config = structuredClone(original);
		config.previews.pipelines[0] = {
			binding: config.previews.pipelines[0].binding,
			...entry,
		};
		assert.throws(() => validatePreviewConfig(config, "playground"), /unreviewed keys: pipeline/);
	}
});

test("Preview data bindings reject production targets named by the legacy pipeline key", async () => {
	const config = structuredClone(
		await unstable_readConfig({
			config: workerProjectConfig("playground").wranglerInputConfigPath,
		}),
	);
	const { stream } = config.previews.pipelines[0];
	config.pipelines[0] = {
		binding: config.pipelines[0].binding,
		pipeline: stream,
	};
	assert.throws(() => validatePreviewConfig(config, "playground"), /non-production stream/);
});

test("Web links stay on official sibling previews of the same PR", () => {
	assert.deepEqual(webPreviewUrls("0042", "dimethyl"), {
		icons_preview_url: "https://pr-42-sketchi-icons.dimethyl.workers.dev",
		playground_preview_url: "https://pr-42-sketchi-studio.dimethyl.workers.dev",
	});
	assert.throws(() => webPreviewUrls(42, "https://dimethyl.workers.dev"), /subdomain/);
	assert.throws(() => webPreviewUrls(42, ""), /subdomain/);
});

const previewEntry = {
	type: "preview",
	version: 1,
	worker_name: "sketchi-web",
	preview_id: "preview-id",
	preview_name: "pr-42",
	preview_slug: "pr-42",
	preview_urls: ["https://pr-42-sketchi-web.dimethyl.workers.dev"],
	deployment_id: "deployment-id",
	deployment_urls: ["https://abcdef-sketchi-web.dimethyl.workers.dev"],
};

function wranglerOutput(entry = previewEntry) {
	return [{ type: "wrangler-session", version: 1 }, entry, { type: "command-failed", version: 1 }]
		.map((line) => JSON.stringify(line))
		.join("\n");
}

test("official URL extraction selects the stable Preview URL, not the immutable deploy URL", () => {
	assert.equal(
		officialPreviewUrl(wranglerOutput(), "sketchi-web", "pr-42"),
		previewEntry.preview_urls[0],
	);
});

test("official URL extraction rejects wrong PRs/Workers, disabled URLs, and production URLs", () => {
	assert.throws(
		() => officialPreviewUrl(wranglerOutput(), "sketchi-web", "pr-43"),
		/does not match/,
	);
	assert.throws(
		() => officialPreviewUrl(wranglerOutput(), "sketchi-studio", "pr-42"),
		/does not match/,
	);
	assert.throws(() => officialPreviewUrl("", "sketchi-web", "pr-42"), /does not match/);
	for (const urls of [
		[],
		["https://sketchi-web.dimethyl.workers.dev"],
		["https://pr-42-sketchi-studio.dimethyl.workers.dev"],
		["http://pr-42-sketchi-web.dimethyl.workers.dev"],
		["https://pr-42-sketchi-web.dimethyl.workers.dev.evil.example"],
	]) {
		assert.throws(
			() =>
				officialPreviewUrl(
					wranglerOutput({ ...previewEntry, preview_urls: urls }),
					"sketchi-web",
					"pr-42",
				),
			/No active/,
		);
	}
});

test("production URL extraction prefers the requested Worker", () => {
	const log = "https://sketchi-studio.account.workers.dev\nhttps://sketchi-web.account.workers.dev";
	assert.equal(
		extractPreviewUrl(log, "sketchi-studio"),
		"https://sketchi-studio.account.workers.dev",
	);
});

test("extractPreviewUrl fails closed for an unmatched explicit Worker", () => {
	const log = "https://other-worker.account.workers.dev\nhttps://last-worker.account.workers.dev";
	assert.equal(extractPreviewUrl(log, "sketchi-web"), null);
	assert.equal(extractPreviewUrl(log), "https://last-worker.account.workers.dev");
	assert.equal(extractPreviewUrl("no URL"), null);
});

test("previewCommentBody exposes project and Worker identities separately", () => {
	assert.equal(
		previewCommentBody({
			previewUrl: "https://pr-42-sketchi-studio.account.workers.dev",
			previewName: "pr-42",
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
			"- URL: https://pr-42-sketchi-studio.account.workers.dev",
			"- Preview: `pr-42`",
			"- Commit: `abcdef123456`",
			"- Workflow run: https://github.com/shpitdev/sketchi/actions/runs/1",
			"",
		].join("\n"),
	);
});

test("previewCommentBody keeps a still-reachable deleted Preview visible", () => {
	const body = previewCommentBody({
		previewName: "pr-42",
		previewUrl: "https://pr-42-sketchi-web.dimethyl.workers.dev",
		projectId: "web",
		status: "deletion-pending",
		workerName: "sketchi-web",
	});
	assert.match(body, /Status: `deletion-pending`/);
	assert.match(body, /- URL: https:\/\/pr-42-sketchi-web\.dimethyl\.workers\.dev/);
	assert.match(body, /still reachable[\s\S]*cloudflare\/workers-sdk#15945/);
});
