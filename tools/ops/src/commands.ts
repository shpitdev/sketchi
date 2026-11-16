import { Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { GateFailed, HELP, runGate } from "./ci-local/gate";
import {
	cloudflareCredentials,
	deletePreview,
	detachProductionDomains,
	requireActiveZone,
	requireCloudflareCredentials,
	workersSubdomain,
} from "./deploy/cloudflare";
import { upsertPreviewComment } from "./deploy/github";
import {
	extractWorkersDevUrl,
	officialPreviewUrl,
	previewName,
	selectPreviewProjects,
	validatePreviewConfig,
	webPreviewUrls,
} from "./deploy/preview";
import {
	productionDomainWranglerConfig,
	productionProjectConfig,
	productionSummary,
	selectProductionProjects,
} from "./deploy/production";
import { runWithAssetsUploadRetry } from "./deploy/wrangler-retry";
import { optionalEnv, requiredEnv, writeOutputs } from "./outputs";
import { attempt, opsError, output, runInherited } from "./process";
import { DEFAULT_ENDPOINT, runSanity } from "./sanity";
import { printResources, provision } from "./telemetry/catalog";
import { openDuckdb } from "./telemetry/db";
import { workerProjectConfig, workerProjectIds } from "./workers";

/** Sets the exit code a command reports without failing it. */
export class ExitCode extends Schema.TaggedError<ExitCode, { readonly brand: unique symbol }>()(
	"ExitCode",
	{
		code: Schema.Number,
	},
) {}

const exitWith = (code: number) => (code === 0 ? Effect.void : Effect.fail(new ExitCode({ code })));

const project = Flag.String("project").pipe(Flag.withDescription("Worker app (Nx project id)."));
const prNumber = Flag.String("pr-number").pipe(Flag.withDescription("Pull request number."));
const workerName = Flag.String("worker-name");

const readJsonFile = Effect.fn("ops.readJsonFile")(function* (file: string) {
	const fs = yield* FileSystem.FileSystem;
	return yield* fs.readFileString(file).pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))),
		Effect.mapError(() => opsError(`Cannot read JSON from ${file}.`)),
	);
});

const ciLocal = Command.make(
	"ci-local",
	{
		signoff: Flag.Boolean("signoff").pipe(
			Flag.withDefault(true),
			Flag.withDescription("Post the local-ci status on the PR head (--no-signoff skips it)."),
		),
		all: Flag.Boolean("all").pipe(
			Flag.withDefault(false),
			Flag.withDescription("Run every project and sampled routing."),
		),
		base: Flag.String("base").pipe(
			Flag.withDescription("Git commit/ref to compare with (default origin/main)."),
			Flag.optional,
		),
	},
	(options) => Effect.scoped(runGate(options)),
).pipe(
	Command.withDescription(HELP),
	Command.withShortDescription("Run the local CI gate and sign off the PR head."),
);

const workerResolve = Command.make("resolve", { project }, (input) =>
	Effect.gen(function* () {
		const config = yield* attempt(() => workerProjectConfig(input.project));
		yield* writeOutputs({
			build_output_path: config.buildOutputPath,
			project_id: config.projectId,
			worker_config_path: config.generatedWranglerConfigPath,
			worker_name: config.workerName,
		});
	}),
).pipe(Command.withDescription("Write the Worker identity and build paths of one app."));

const previewSelect = Command.make("select", {}, () =>
	Effect.gen(function* () {
		const selection = Option.getOrElse(yield* optionalEnv("PREVIEW_SELECTION"), () => "affected");
		let affected: string[] = [];
		let changedFiles: string[] = [];
		if (selection === "affected") {
			const base = yield* requiredEnv("BASE_SHA");
			const head = yield* requiredEnv("HEAD_SHA");
			const mergeBase = (yield* output("git", ["merge-base", base, head])).trim();
			changedFiles = (yield* output("git", ["diff", "--name-only", mergeBase, head]))
				.split("\n")
				.filter(Boolean);
			const json = yield* output("pnpm", [
				"--silent",
				"nx",
				"show",
				"projects",
				"--affected",
				`--base=${mergeBase}`,
				`--head=${head}`,
				"--json",
			]);
			affected = yield* Schema.decodeUnknownEffect(
				Schema.fromJsonString(Schema.Array(Schema.String)),
			)(json).pipe(
				Effect.map((projects) => [...projects]),
				Effect.mapError(() => opsError(`nx show projects returned ${json}`)),
			);
		}
		const projects = yield* attempt(() =>
			selectPreviewProjects({ selection, affected, changedFiles }),
		);
		yield* Console.log(`Preview projects (${selection}): ${projects.join(", ") || "none"}`);
		yield* writeOutputs({ projects: JSON.stringify(projects) });
	}),
).pipe(Command.withDescription("Write the Worker apps this preview run deploys."));

const previewSettings = Command.make(
	"settings",
	{ project, prNumber, config: Flag.String("config") },
	(input) =>
		Effect.gen(function* () {
			const name = yield* attempt(() => previewName(input.prNumber));
			const config = yield* readJsonFile(input.config);
			const validated = yield* attempt(() => validatePreviewConfig(config, input.project));
			const outputs: Record<string, string> = { preview_name: name };
			const credentials = yield* cloudflareCredentials;
			// Web links its sibling Previews of the same PR on the account's workers.dev subdomain.
			if (validated.projectId === "web" && Option.isSome(credentials)) {
				const subdomain = yield* workersSubdomain(credentials.value);
				Object.assign(outputs, yield* attempt(() => webPreviewUrls(input.prNumber, subdomain)));
			}
			yield* writeOutputs(outputs);
		}),
).pipe(
	Command.withDescription(
		"Validate the generated Preview config and write the Preview name (and Web's sibling URLs).",
	),
);

const previewUrl = Command.make(
	"url",
	{
		output: Argument.String("wrangler-output"),
		workerName,
		previewName: Flag.String("preview-name"),
	},
	(input) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const content = yield* fs
				.readFileString(input.output)
				.pipe(Effect.mapError(() => opsError(`Cannot read ${input.output}.`)));
			const url = yield* attempt(() =>
				officialPreviewUrl(content, input.workerName, input.previewName),
			);
			yield* writeOutputs({ preview_url: url });
		}),
).pipe(Command.withDescription("Write the stable Preview URL from Wrangler's output file."));

const previewComment = Command.make("comment", {}, () => upsertPreviewComment()).pipe(
	Command.withDescription("Create or update this app's sticky Preview comment on the PR."),
);

const previewDelete = Command.make("delete", { project, prNumber }, (input) =>
	deletePreview({ project: input.project, prNumber: input.prNumber }),
).pipe(Command.withDescription("Delete this PR's Preview of one Worker app."));

const preview = Command.make("preview").pipe(
	Command.withShortDescription("Per-PR Worker Previews."),
	Command.withSubcommands([
		previewSelect,
		previewSettings,
		previewUrl,
		previewComment,
		previewDelete,
	]),
);

const productionSelect = Command.make(
	"select",
	{ selection: Flag.String("project").pipe(Flag.withDefault("all")) },
	(input) =>
		Effect.gen(function* () {
			const projects = yield* attempt(() => selectProductionProjects(input.selection));
			yield* Console.log(`Production projects (${input.selection}): ${projects.join(", ")}`);
			yield* writeOutputs({ projects: JSON.stringify(projects) });
		}),
).pipe(Command.withDescription("Write the Worker apps this production dispatch deploys."));

const productionUrl = Command.make(
	"url",
	{ log: Argument.String("deploy-log"), workerName },
	(input) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const content = yield* fs
				.readFileString(input.log)
				.pipe(Effect.mapError(() => opsError(`Cannot read ${input.log}.`)));
			const url = extractWorkersDevUrl(content, input.workerName);
			if (!url) return yield* opsError(`Failed to parse the workers.dev URL from ${input.log}.`);
			yield* writeOutputs({ preview_url: url });
		}),
).pipe(Command.withDescription("Write the workers.dev URL from a production deploy log."));

const productionSummaryCommand = Command.make("summary", { project, workerName }, (input) =>
	attempt(() => productionSummary(input.project, input.workerName)).pipe(
		Effect.flatMap(Console.log),
	),
).pipe(Command.withDescription("Print the step-summary lines of a deployed production Worker."));

const productionDomains = Command.make(
	"domains",
	{
		project,
		config: Flag.String("config").pipe(Flag.optional),
		out: Flag.String("out").pipe(Flag.optional),
	},
	(input) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const config = yield* attempt(() => productionProjectConfig(input.project));
			yield* requireActiveZone(yield* requireCloudflareCredentials);
			const source = Option.getOrElse(input.config, () => config.generatedWranglerConfigPath);
			const target = Option.getOrElse(input.out, () => config.productionDomainWranglerConfigPath);
			const sourceConfig = yield* readJsonFile(source);
			const domainConfig = yield* attempt(() =>
				productionDomainWranglerConfig(sourceConfig, {
					projectId: config.projectId,
					workerName: config.workerName,
				}),
			);
			yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie);
			yield* fs
				.writeFileString(target, `${JSON.stringify(domainConfig, null, 2)}\n`)
				.pipe(Effect.mapError(() => opsError(`Cannot write ${target}.`)));
			yield* writeOutputs({
				domain_config_path: target,
				domain_patterns: config.domainPatterns.join(","),
				project_id: config.projectId,
				source_config_path: source,
				worker_name: config.workerName,
			});
		}),
).pipe(
	Command.withDescription(
		"Require the active sketchi.app zone and write a Wrangler config with only the app's approved domains.",
	),
);

const productionDetach = Command.make(
	"detach",
	{ project, apply: Flag.Boolean("apply").pipe(Flag.withDefault(false)) },
	(input) =>
		Effect.gen(function* () {
			const config = yield* attempt(() => productionProjectConfig(input.project));
			const detachments = yield* detachProductionDomains(input);
			if (detachments.length === 0) {
				yield* Console.log(
					`No approved domains are attached for project ${config.projectId} and Worker ${config.workerName}.`,
				);
				return;
			}
			for (const domain of detachments) {
				yield* Console.log(
					`${input.apply ? "detached" : "would detach"}: ${domain.hostname} from ${domain.service}`,
				);
			}
		}),
).pipe(Command.withDescription("Detach the app's approved custom domains from its Worker."));

const production = Command.make("production").pipe(
	Command.withShortDescription("Production Worker deploys and custom domains."),
	Command.withSubcommands([
		productionSelect,
		productionUrl,
		productionSummaryCommand,
		productionDomains,
		productionDetach,
	]),
);

const wranglerRetry = Command.make(
	"wrangler-retry",
	{ command: Argument.String("command").pipe(Argument.variadic({ min: 1 })) },
	(input) =>
		Effect.gen(function* () {
			const [file, ...args] = input.command;
			if (!file) return yield* opsError("Usage: ops wrangler-retry -- <command> [args...]");
			return yield* exitWith(yield* runWithAssetsUploadRetry(file, args));
		}),
).pipe(
	Command.withDescription(
		"Run a deploy command, retrying Cloudflare's assets-upload-session 10013 failure.",
	),
);

const dryRun = Command.make("dry-run", {}, () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		for (const projectId of workerProjectIds) {
			const config = workerProjectConfig(projectId);
			if (!(yield* fs.exists(config.generatedWranglerConfigPath).pipe(Effect.orDie))) {
				return yield* opsError(
					`Missing generated Wrangler config for ${projectId}: ${config.generatedWranglerConfigPath}. Run the app builds first.`,
				);
			}
			const outDir = `.memory/wrangler-dry-runs/${projectId}/`;
			yield* fs.makeDirectory(outDir, { recursive: true }).pipe(Effect.orDie);
			yield* Console.log(
				`Dry-running ${config.projectId} -> ${config.workerName} with ${config.generatedWranglerConfigPath}`,
			);
			const code = yield* runInherited("node_modules/.bin/wrangler", [
				"deploy",
				"--dry-run",
				"--config",
				config.generatedWranglerConfigPath,
				"--outdir",
				outDir,
			]);
			if (code !== 0) {
				return yield* opsError(`Wrangler dry-run failed for ${projectId} with status ${code}.`);
			}
		}
	}),
).pipe(Command.withDescription("Dry-run every built Worker app's Wrangler deploy."));

const sanity = Command.make(
	"sanity",
	{
		endpoint: Flag.String("endpoint").pipe(Flag.withDefault(DEFAULT_ENDPOINT)),
		checks: Argument.String("check").pipe(Argument.variadic()),
	},
	(input) =>
		runSanity(input.endpoint, input.checks).pipe(
			Effect.flatMap((failed) => exitWith(failed > 0 ? 1 : 0)),
		),
).pipe(Command.withDescription("Run end-to-end sanity checks against a deployed Studio."));

const db = Command.make(
	"db",
	{ args: Argument.String("duckdb-args").pipe(Argument.variadic()) },
	(input) => openDuckdb(input.args),
).pipe(
	Command.withDescription(
		"Open DuckDB on the span catalogs. Pass --preview for previews; other arguments go to DuckDB.",
	),
);

const environment = Argument.String("environment").pipe(Argument.withDefault("all"));
const telemetry = Command.make("telemetry").pipe(
	Command.withShortDescription("Span storage resources."),
	Command.withSubcommands([
		Command.make("resources", { environment }, (input) => printResources(input.environment)).pipe(
			Command.withDescription("Print each environment's span storage resources."),
		),
		Command.make("provision", { environment }, (input) => provision(input.environment)).pipe(
			Command.withDescription(
				"Create missing span storage resources and apply catalog maintenance.",
			),
		),
	]),
);

const worker = Command.make("worker").pipe(
	Command.withShortDescription("Worker app identities."),
	Command.withSubcommands([workerResolve]),
);

export const ops = Command.make("ops").pipe(
	Command.withDescription("Sketchi operator commands."),
	Command.withSubcommands([
		ciLocal,
		worker,
		preview,
		production,
		wranglerRetry,
		dryRun,
		sanity,
		db,
		telemetry,
	]),
);

export { GateFailed };
