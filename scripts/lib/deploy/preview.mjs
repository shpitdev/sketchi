import {
	assertWranglerWorkerIdentity,
	requireWorkerIdentity,
	workerProjectConfig,
} from "../worker-apps.mjs";

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
		routePolicy: "playground.sketchi.app product surface; authenticated Studio remains unexposed",
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
	const input = String(value ?? "");
	const prNumber = Number(input);

	if (!input || /[^0-9]/.test(input) || !Number.isSafeInteger(prNumber) || prNumber < 1) {
		throw new Error("PR number must be a positive integer within the safe integer range.");
	}

	return prNumber;
}

export function previewName(prNumber) {
	return `pr-${normalizePrNumber(prNumber)}`;
}

// Keys Wrangler forwards for each Preview data binding. It also forwards the
// legacy Pipelines `pipeline` key, so Previews may only name a `stream`.
const previewDataBindings = {
	pipelines: {
		allowedKeys: ["binding", "stream", "remote"],
		productionTargetKeys: ["stream", "pipeline"],
		target: "stream",
	},
	r2_buckets: {
		allowedKeys: ["binding", "bucket_name", "remote", "jurisdiction"],
		productionTargetKeys: ["bucket_name"],
		target: "bucket_name",
	},
};

export function validatePreviewConfig(config, projectId) {
	const project = previewProjectConfig(projectId);
	assertWranglerWorkerIdentity(config, projectId, project.workerName);
	const previews = config.previews;
	if (!previews || typeof previews !== "object") {
		throw new Error(
			"Explicit previews settings are required; production bindings must not be inherited.",
		);
	}
	const allowed = new Set([
		"vars",
		"ai",
		"browser",
		"worker_loaders",
		"observability",
		"r2_buckets",
		"pipelines",
	]);
	for (const field of Object.keys(previews)) {
		if (!allowed.has(field))
			throw new Error(`Review Preview isolation before adding previews.${field}.`);
	}
	for (const field of ["ai", "browser", "worker_loaders"]) {
		const required = config[field];
		if (
			(Array.isArray(required) ? required.length > 0 : required) &&
			JSON.stringify(previews[field]) !== JSON.stringify(required)
		) {
			throw new Error(`Preview runtime binding ${field} must be configured explicitly.`);
		}
	}
	if (previews.vars?.SKETCHI_APP_SURFACE !== config.vars?.SKETCHI_APP_SURFACE) {
		throw new Error("Preview must retain the selected application surface.");
	}
	// Previews must bind every data binding production has, and none of them
	// may name a production bucket or stream.
	for (const [field, spec] of Object.entries(previewDataBindings)) {
		const production = config[field] ?? [];
		const preview = previews[field] ?? [];
		const bindingNames = (list) =>
			list
				.map(({ binding }) => binding)
				.sort()
				.join();
		if (bindingNames(preview) !== bindingNames(production)) {
			throw new Error(`previews.${field} must bind exactly the production binding names.`);
		}
		const productionTargets = new Set(
			production.flatMap((b) => spec.productionTargetKeys.map((key) => b[key])),
		);
		for (const binding of preview) {
			const unreviewed = Object.keys(binding).filter((key) => !spec.allowedKeys.includes(key));
			if (unreviewed.length > 0) {
				throw new Error(
					`Preview ${field} binding ${binding.binding} has unreviewed keys: ${unreviewed.join(", ")}.`,
				);
			}
			const target = binding[spec.target];
			const declared = production.find((b) => b.binding === binding.binding)?.preview_bucket_name;
			if (
				typeof target !== "string" ||
				!target ||
				productionTargets.has(target) ||
				(declared && target !== declared)
			) {
				throw new Error(
					`Preview ${field} binding ${binding.binding} must target its non-production ${spec.target}.`,
				);
			}
		}
	}
	return project;
}

export function webPreviewUrls(prNumber, subdomain) {
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain ?? "")) {
		throw new Error(
			"A valid workers.dev account subdomain is required for Web preview navigation.",
		);
	}
	const name = previewName(prNumber);
	return Object.fromEntries(
		[
			["icons_preview_url", "icons"],
			["playground_preview_url", "playground"],
		].map(([key, projectId]) => [
			key,
			`https://${name}-${previewProjectConfig(projectId).workerName}.${subdomain}.workers.dev`,
		]),
	);
}

// Read the `preview` entry Wrangler writes to WRANGLER_OUTPUT_FILE_PATH,
// never a URL scraped from logs or a production URL.
export function officialPreviewUrl(outputText, workerName, name) {
	const entry = outputText
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line))
		.findLast(({ type }) => type === "preview");
	if (
		entry?.worker_name !== workerName ||
		entry.preview_name !== name ||
		entry.preview_slug !== name ||
		!entry.preview_id ||
		!entry.deployment_id
	) {
		throw new Error("Preview result does not match the requested Worker and PR preview.");
	}
	const url = entry.preview_urls?.find((value) => {
		try {
			const parsed = new URL(value);
			return (
				parsed.protocol === "https:" &&
				parsed.hostname.startsWith(`${name}-${workerName}.`) &&
				parsed.hostname.endsWith(".workers.dev") &&
				parsed.pathname === "/" &&
				!parsed.search &&
				!parsed.hash &&
				!parsed.username &&
				!parsed.password
			);
		} catch {
			return false;
		}
	});
	if (!url)
		throw new Error(
			"No active workers.dev Preview URL. Enable previews on the production Worker; do not deploy PR code to production.",
		);
	return url;
}

export function extractPreviewUrl(logText, workerName = "") {
	const urls = [...logText.matchAll(/https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev\b/g)].map(
		([url]) => url,
	);
	if (workerName) {
		return urls.findLast((url) => url.includes(`://${workerName}.`)) ?? null;
	}

	return urls.at(-1) ?? null;
}

export function previewCommentBody(input) {
	const project = previewProjectConfig(input.projectId);
	requireWorkerIdentity(project.projectId, input.workerName);
	const status = (input.status ?? "ready").trim().toLowerCase();
	const runUrl = input.runUrl?.trim();
	const previewUrl = input.previewUrl?.trim();
	const previewName = input.previewName?.trim();
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
		lines.push(`- Preview: \`${previewName}\``);
	}

	if (sha) {
		lines.push(`- Commit: \`${sha.slice(0, 12)}\``);
	}

	if (runUrl) {
		lines.push(`- Workflow run: ${runUrl}`);
	}

	if (status === "unconfigured") {
		lines.push(
			"",
			"Preview deploy is wired, but Cloudflare credentials are not configured for this repository yet.",
		);
	}

	if (status === "deletion-pending") {
		lines.push(
			"",
			"Deletion pending: Cloudflare deleted this Preview, but its URL is still reachable and serves this PR's code ([cloudflare/workers-sdk#15945](https://github.com/cloudflare/workers-sdk/issues/15945)). The cleanup job failed so this stays visible.",
		);
	}

	return `${lines.join("\n")}\n`;
}
