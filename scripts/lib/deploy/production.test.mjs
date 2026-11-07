import assert from "node:assert/strict";
import { globSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { posix } from "node:path";
import test from "node:test";

import {
	productionDomainWranglerConfig,
	productionProjectConfig,
	selectProductionProjects,
} from "./production.mjs";
import { workerProjectConfig, workerProjectIds } from "../worker-apps.mjs";

const require = createRequire(import.meta.resolve("nx/package.json"));
const yaml = require("@zkochan/js-yaml");
const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const workflow = yaml.load(read(".github/workflows/app-production-deploy.yml"));

test("productionProjectConfig returns project-scoped domain metadata", () => {
	assert.deepEqual(productionProjectConfig("web"), {
		...workerProjectConfig("web"),
		domainPatterns: ["sketchi.app", "www.sketchi.app"],
		publicSurface: true,
		routePolicy: "sketchi.app and www.sketchi.app product surface",
		title: "Sketchi Web",
	});
});

test("playground project preserves the Studio production Worker", () => {
	assert.deepEqual(productionProjectConfig("playground"), {
		...workerProjectConfig("playground"),
		domainPatterns: ["playground.sketchi.app"],
		publicSurface: true,
		routePolicy: "playground.sketchi.app product surface; authenticated Studio remains unexposed",
		title: "Sketchi Playground / Studio",
	});
});

test("internal projects stay off public domains", () => {
	assert.deepEqual(productionProjectConfig("excalidraw"), {
		...workerProjectConfig("excalidraw"),
		domainPatterns: [],
		publicSurface: false,
		routePolicy: "internal canvas workspace; no public product domain",
		title: "Sketchi Excalidraw Workspace",
	});
});

test("production project selection is explicit and closed", () => {
	assert.throws(() => productionProjectConfig(), /Production project selection is required/);
	assert.throws(() => productionProjectConfig("studio"), /Unknown production project "studio"/);
});

test("productionDomainWranglerConfig adds only approved manual domains", () => {
	const domainConfig = productionDomainWranglerConfig(
		{
			name: "sketchi-icons",
			route: "icons.sketchi.app/*",
			routes: ["icons.sketchi.app/*"],
			domains: [{ pattern: "icons.sketchi.app" }],
			custom_domain: true,
			vars: {
				SKETCHI_APP_SURFACE: "icons",
			},
			r2_buckets: [
				{
					binding: "SKETCHI_ARTIFACTS",
					bucket_name: "sketchi-studio-codemode-artifacts-production",
					preview_bucket_name: "sketchi-studio-codemode-artifacts-preview",
				},
			],
		},
		{ projectId: "icons", workerName: "sketchi-icons" },
	);

	assert.equal(domainConfig.name, "sketchi-icons");
	assert.equal(domainConfig.topLevelName, "sketchi-icons");
	assert.equal(domainConfig.workers_dev, true);
	assert.deepEqual(domainConfig.routes, [
		{
			pattern: "icons.sketchi.app",
			custom_domain: true,
		},
	]);
	assert.equal(domainConfig.route, undefined);
	assert.equal(domainConfig.domains, undefined);
	assert.equal(domainConfig.custom_domain, undefined);
	assert.deepEqual(domainConfig.vars, {
		SKETCHI_APP_SURFACE: "icons",
	});
	assert.deepEqual(domainConfig.r2_buckets, [
		{
			binding: "SKETCHI_ARTIFACTS",
			bucket_name: "sketchi-studio-codemode-artifacts-production",
			preview_bucket_name: "sketchi-studio-codemode-artifacts-preview",
		},
	]);
});

test("playground domain attach preserves Studio runtime identity and contracts", () => {
	const domainConfig = productionDomainWranglerConfig(
		{
			name: "sketchi-studio",
			routes: ["playground.sketchi.app/*"],
			vars: {
				SKETCHI_APP_SURFACE: "studio",
			},
		},
		{ projectId: "playground", workerName: "sketchi-studio" },
	);

	assert.equal(domainConfig.name, "sketchi-studio");
	assert.deepEqual(domainConfig.routes, [
		{
			pattern: "playground.sketchi.app",
			custom_domain: true,
		},
	]);
	assert.deepEqual(domainConfig.vars, {
		SKETCHI_APP_SURFACE: "studio",
	});
});

test("domain attach fails closed on project or source Worker mismatch", () => {
	assert.throws(
		() =>
			productionDomainWranglerConfig(
				{ name: "sketchi-studio" },
				{ projectId: "playground", workerName: "sketchi-playground" },
			),
		/Worker identity mismatch for project "playground"/,
	);
	assert.throws(
		() =>
			productionDomainWranglerConfig(
				{ name: "sketchi-playground" },
				{ projectId: "playground", workerName: "sketchi-studio" },
			),
		/Wrangler name mismatch for project "playground"/,
	);
});

test("internal projects emit no public routes", () => {
	const domainConfig = productionDomainWranglerConfig(
		{
			name: "sketchi-excalidraw",
			routes: ["excalidraw.sketchi.app/*"],
			vars: {
				SKETCHI_APP_SURFACE: "excalidraw",
			},
		},
		{ projectId: "excalidraw", workerName: "sketchi-excalidraw" },
	);

	assert.equal(domainConfig.name, "sketchi-excalidraw");
	assert.deepEqual(domainConfig.routes, []);
	assert.deepEqual(domainConfig.vars, {
		SKETCHI_APP_SURFACE: "excalidraw",
	});
});

test("a production push deploys the Worker apps whose build it reaches", () => {
	assert.deepEqual(
		selectProductionProjects({
			selection: "affected",
			affected: ["diagram-core", "playground", "excalidraw", "sketchi-cli"],
		}),
		["excalidraw", "playground"],
	);
	assert.deepEqual(selectProductionProjects({ selection: "affected", affected: [] }), []);
	assert.deepEqual(selectProductionProjects({ selection: "all" }), workerProjectIds);
	assert.deepEqual(selectProductionProjects({ selection: "web" }), ["web"]);
	assert.throws(() => selectProductionProjects({ selection: "studio" }), /Unknown Worker project/);
});

test("production deploys only the selected apps, and a dispatch selects all or one", () => {
	const select = workflow.jobs.select.steps.find(({ id }) => id === "projects");
	assert.equal(select.run, "node scripts/09-select-production-projects.mjs");
	assert.equal(select.env.PRODUCTION_SELECTION, "${{ inputs.project || 'affected' }}");
	assert.equal(select.env.BASE_SHA, "${{ github.event.before }}");
	assert.equal(select.env.HEAD_SHA, "${{ github.sha }}");
	const [first, ...apps] = workflow.on.workflow_dispatch.inputs.project.options;
	assert.equal(first, "all");
	assert.deepEqual(apps.toSorted(), workerProjectIds.toSorted());
	const deploy = workflow.jobs.deploy;
	assert.equal(deploy.needs, "select");
	assert.match(deploy.if, /needs\.select\.outputs\.projects != '\[\]'/);
	assert.equal(deploy.strategy.matrix.project, "${{ fromJSON(needs.select.outputs.projects) }}");
	assert.doesNotMatch(JSON.stringify(deploy.steps), /inputs\.project/);
	// The script reads the Nx graph task by task, so a test-only change reaches no build.
	assert.match(read("scripts/09-select-production-projects.mjs"), /NX_LEGACY_AFFECTED: "false"/);
	assert.match(read("scripts/09-select-production-projects.mjs"), /--withTarget=build/);
});

test("the production push filter covers every workspace package and shared build input", () => {
	const paths = workflow.on.push.paths;
	const workspace = yaml.load(read("pnpm-workspace.yaml")).packages;
	for (const glob of workspace) {
		assert.ok(paths.includes(`${glob.split("/")[0]}/**`), `${glob} must start a deploy run`);
	}
	const sharedGlobals = JSON.parse(read("nx.json")).namedInputs.sharedGlobals;
	for (const input of sharedGlobals) {
		assert.ok(paths.includes(input.replace("{workspaceRoot}/", "")), `${input} is a build input`);
	}
	for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
		assert.ok(paths.includes(file), file);
	}
});

const repoRoot = new URL("../../../", import.meta.url);

// A GitHub `paths` filter entry: `dir/**` covers everything under dir; anything else is one file.
const pathFilterCovers = (paths, file) =>
	paths.some((path) => (path.endsWith("/**") ? file.startsWith(path.slice(0, -2)) : path === file));

// Workspace package roots and names. A package reaches a build through Nx's `^production`.
const workspacePackages = new Map(
	yaml
		.load(read("pnpm-workspace.yaml"))
		.packages.flatMap((glob) => globSync(`${glob}/package.json`, { cwd: repoRoot }))
		.map((manifest) => [posix.dirname(manifest), JSON.parse(read(manifest)).name]),
);
const packageRootOf = (path) =>
	[...workspacePackages.keys()].find((root) => path.startsWith(`${root}/`));

/**
 * The local paths a project's build configs reach outside the project, following the imports of
 * every module they reach outside workspace packages. A specifier resolves to its file the way
 * Vite would; a directory or asset path is kept as written.
 */
function externalBuildPaths(projectRoot, configs) {
	const resolveModule = (path) =>
		["", ".ts", ".mts", ".mjs", ".js", "/index.ts"]
			.map((suffix) => `${path}${suffix}`)
			.find((candidate) =>
				statSync(new URL(candidate, repoRoot), { throwIfNoEntry: false })?.isFile(),
			);
	const found = new Set();
	const queue = configs.map((config) => `${projectRoot}/${config}`);
	for (let file = queue.shift(); file; file = queue.shift()) {
		for (const [, specifier] of read(file).matchAll(/["'](\.{1,2}\/[^"'`$]*)["']/g)) {
			const target = posix.normalize(posix.join(posix.dirname(file), specifier));
			if (target.startsWith(`${projectRoot}/`) || target.startsWith("node_modules/")) continue;
			const module = resolveModule(target);
			const path = module ?? target;
			if (found.has(path)) continue;
			found.add(path);
			if (module && /\.[mc]?[jt]s$/.test(module) && !packageRootOf(module)) queue.push(module);
		}
	}
	return [...found];
}

test("every file a Worker build reaches outside its project redeploys that app", () => {
	const paths = workflow.on.push.paths;
	for (const projectId of workerProjectIds) {
		const { projectRoot } = workerProjectConfig(projectId);
		const manifest = JSON.parse(read(`${projectRoot}/package.json`));
		const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
		const inputs = JSON.parse(read(`${projectRoot}/project.json`)).targets.build.inputs ?? [];
		const external = externalBuildPaths(projectRoot, ["vite.config.ts", "wrangler.jsonc"]);
		assert.ok(external.length > 0, `${projectId}: the scan must see the config's imports`);
		for (const path of external) {
			const owner = packageRootOf(path);
			if (owner) {
				const name = workspacePackages.get(owner);
				assert.ok(name in dependencies, `${projectId} must depend on ${name} to build ${path}`);
				continue;
			}
			assert.ok(
				inputs.includes(`{workspaceRoot}/${path}`),
				`${projectId}: ${path} must be a build input`,
			);
			assert.ok(pathFilterCovers(paths, path), `${path} must start a production deploy run`);
		}
	}
});
