import {
	assertWranglerWorkerIdentity,
	requireWorkerIdentity,
	workerProjectConfig,
	workerProjectIds,
	type WorkerProjectId,
} from "../../../build-config/workers";

// Preview tooling that belongs to no Nx project's build. A change to it previews every app.
const PREVIEW_TOOLING =
	/^(?:\.github\/workflows\/app-preview\.yml$|\.github\/actions\/|tools\/ops\/src\/(?:main|process|outputs|commands)\.ts$|tools\/ops\/src\/deploy\/)/;

/**
 * The Worker apps a preview run deploys: every app, one named app, or the apps the PR affects
 * (all of them when it changes the preview tooling).
 */
export function selectPreviewProjects(input: {
	readonly selection: string;
	readonly affected?: readonly string[];
	readonly changedFiles?: readonly string[];
}): WorkerProjectId[] {
	const { selection, affected = [], changedFiles = [] } = input;
	if (selection === "all") return [...workerProjectIds];
	if (selection !== "affected") return [workerProjectConfig(selection).projectId];
	if (changedFiles.some((file) => PREVIEW_TOOLING.test(file))) return [...workerProjectIds];
	return workerProjectIds.filter((project) => affected.includes(project));
}

const previewProjects: Record<
	WorkerProjectId,
	{ commentMarker: string; publicSurface: boolean; routePolicy: string; title: string }
> = {
	editor: {
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
	studio: {
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

export function previewProjectConfig(project: string | undefined) {
	const projectId = project?.trim() ?? "";
	const expected = `Expected one of ${Object.keys(previewProjects).join(", ")}.`;
	if (!projectId) throw new Error(`Preview project selection is required. ${expected}`);
	if (!Object.hasOwn(previewProjects, projectId)) {
		throw new Error(`Unknown preview project "${projectId}". ${expected}`);
	}
	const worker = workerProjectConfig(projectId);
	return { ...worker, ...previewProjects[worker.projectId] };
}

export function normalizePrNumber(value: string | number | undefined) {
	const input = String(value ?? "");
	const prNumber = Number(input);
	if (!input || /[^0-9]/.test(input) || !Number.isSafeInteger(prNumber) || prNumber < 1) {
		throw new Error("PR number must be a positive integer within the safe integer range.");
	}
	return prNumber;
}

/** The only Preview name a PR owns on each Worker. */
export function previewName(prNumber: string | number | undefined) {
	return `pr-${normalizePrNumber(prNumber)}`;
}

interface DataBindingSpec {
	readonly allowedKeys: readonly string[];
	readonly productionTargetKeys: readonly string[];
	readonly target: string;
	readonly declaredPreviewKey?: string;
}

// Keys Wrangler forwards for each Preview data binding. It also forwards the
// legacy Pipelines `pipeline` key, so Previews may only name a `stream`.
const previewDataBindings: Record<string, DataBindingSpec> = {
	pipelines: {
		allowedKeys: ["binding", "stream", "remote"],
		productionTargetKeys: ["stream", "pipeline"],
		target: "stream",
	},
	r2_buckets: {
		allowedKeys: ["binding", "bucket_name", "remote", "jurisdiction"],
		productionTargetKeys: ["bucket_name"],
		target: "bucket_name",
		declaredPreviewKey: "preview_bucket_name",
	},
	d1_databases: {
		allowedKeys: ["binding", "database_name", "database_id", "remote"],
		productionTargetKeys: ["database_id"],
		target: "database_id",
		declaredPreviewKey: "preview_database_id",
	},
};

type Binding = Record<string, unknown>;
const bindingList = (value: unknown): Binding[] => (Array.isArray(value) ? value : []);

/** Fails unless the generated config gives Previews runtime bindings and no production data. */
export function validatePreviewConfig(config: unknown, projectId: string | undefined) {
	const project = previewProjectConfig(projectId);
	assertWranglerWorkerIdentity(config, project.projectId, project.workerName);
	const fields = config as Record<string, unknown>;
	const previews = fields["previews"] as Record<string, unknown> | undefined;
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
		"durable_objects",
		"observability",
		"r2_buckets",
		"d1_databases",
		"pipelines",
	]);
	for (const field of Object.keys(previews)) {
		if (!allowed.has(field))
			throw new Error(`Review Preview isolation before adding previews.${field}.`);
	}
	// Wrangler gives every Preview its own Durable Object namespace, so these
	// bindings carry no production state and must match production exactly.
	for (const field of ["ai", "browser", "worker_loaders", "durable_objects"]) {
		const bindings = (value: unknown) =>
			field === "durable_objects"
				? ((value as { bindings?: unknown } | undefined)?.bindings ?? [])
				: value;
		const required = bindings(fields[field]);
		if (
			(Array.isArray(required) ? required.length > 0 : required) &&
			JSON.stringify(bindings(previews[field])) !== JSON.stringify(required)
		) {
			throw new Error(`Preview runtime binding ${field} must be configured explicitly.`);
		}
	}
	const surface = (vars: unknown) =>
		(vars as Record<string, unknown> | undefined)?.["SKETCHI_APP_SURFACE"];
	if (surface(previews["vars"]) !== surface(fields["vars"])) {
		throw new Error("Preview must retain the selected application surface.");
	}
	// Previews must bind every data binding production has, and none of them
	// may name a production bucket, database or stream.
	for (const [field, spec] of Object.entries(previewDataBindings)) {
		const production = bindingList(fields[field]);
		const preview = bindingList(previews[field]);
		const bindingNames = (list: Binding[]) =>
			list
				.map((binding) => String(binding["binding"]))
				.sort()
				.join();
		if (bindingNames(preview) !== bindingNames(production)) {
			throw new Error(`previews.${field} must bind exactly the production binding names.`);
		}
		const productionTargets = new Set(
			production.flatMap((binding) => spec.productionTargetKeys.map((key) => binding[key])),
		);
		for (const binding of preview) {
			const name = String(binding["binding"]);
			const unreviewed = Object.keys(binding).filter((key) => !spec.allowedKeys.includes(key));
			if (unreviewed.length > 0) {
				throw new Error(
					`Preview ${field} binding ${name} has unreviewed keys: ${unreviewed.join(", ")}.`,
				);
			}
			const target = binding[spec.target];
			const declared = spec.declaredPreviewKey
				? production.find((candidate) => candidate["binding"] === name)?.[spec.declaredPreviewKey]
				: undefined;
			if (
				typeof target !== "string" ||
				!target ||
				productionTargets.has(target) ||
				(declared && target !== declared)
			) {
				throw new Error(
					`Preview ${field} binding ${name} must target its non-production ${spec.target}.`,
				);
			}
		}
	}
	return project;
}

/** Sibling Preview URLs of the same PR that a Web Preview links to. */
export function webPreviewUrls(prNumber: string | number | undefined, subdomain: string) {
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)) {
		throw new Error(
			"A valid workers.dev account subdomain is required for Web preview navigation.",
		);
	}
	const name = previewName(prNumber);
	const url = (projectId: WorkerProjectId) =>
		`https://${name}-${previewProjectConfig(projectId).workerName}.${subdomain}.workers.dev`;
	return { icons_preview_url: url("icons"), studio_preview_url: url("studio") };
}

/**
 * The stable Preview URL from the `preview` entry Wrangler writes to WRANGLER_OUTPUT_FILE_PATH,
 * never a URL scraped from logs or a production URL.
 */
export function officialPreviewUrl(outputText: string, workerName: string, name: string) {
	const entry = outputText
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.findLast(({ type }) => type === "preview");
	if (
		entry?.["worker_name"] !== workerName ||
		entry["preview_name"] !== name ||
		entry["preview_slug"] !== name ||
		!entry["preview_id"] ||
		!entry["deployment_id"]
	) {
		throw new Error("Preview result does not match the requested Worker and PR preview.");
	}
	const urls = Array.isArray(entry["preview_urls"]) ? (entry["preview_urls"] as unknown[]) : [];
	const url = urls.find((value) => {
		if (typeof value !== "string" || !URL.canParse(value)) return false;
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
	});
	if (typeof url !== "string")
		throw new Error(
			"No active workers.dev Preview URL. Enable previews on the production Worker; do not deploy PR code to production.",
		);
	return url;
}

/** The last workers.dev URL in a production deploy log, the requested Worker's when named. */
export function extractWorkersDevUrl(logText: string, workerName = "") {
	const urls = [...logText.matchAll(/https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev\b/g)].map(
		([url]) => url,
	);
	if (workerName) return urls.findLast((url) => url.includes(`://${workerName}.`)) ?? null;
	return urls.at(-1) ?? null;
}

export interface PreviewCommentInput {
	readonly projectId: string;
	readonly workerName: string;
	readonly marker?: string | undefined;
	readonly status?: string | undefined;
	readonly runUrl?: string | undefined;
	readonly previewUrl?: string | undefined;
	readonly previewName?: string | undefined;
	readonly sha?: string | undefined;
}

export function previewCommentBody(input: PreviewCommentInput) {
	const project = previewProjectConfig(input.projectId);
	requireWorkerIdentity(project.projectId, input.workerName);
	const status = (input.status ?? "ready").trim().toLowerCase();
	const runUrl = input.runUrl?.trim();
	const previewUrl = input.previewUrl?.trim();
	const name = input.previewName?.trim();
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
	if (previewUrl) lines.push(`- URL: ${previewUrl}`);
	if (name) lines.push(`- Preview: \`${name}\``);
	if (sha) lines.push(`- Commit: \`${sha.slice(0, 12)}\``);
	if (runUrl) lines.push(`- Workflow run: ${runUrl}`);
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
