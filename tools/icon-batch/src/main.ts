/**
 * Draw the icon catalog by hand: `draw` runs the draw service's engine over
 * every catalog mark without a recipe, `sheets` lays the results out for
 * review, `summary` writes the ledger, and `promote` turns recognized marks
 * into catalog recipes. See README.md.
 */
/* oxlint-disable no-restricted-imports -- The Node command host loads local catalog, review notes and ledger files before and after a run. */
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
/* oxlint-enable no-restricted-imports */
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { getIconSourceFile, iconManifest, nodeLogoIcons } from "@sketchi/icon-catalog/catalog";
import { iconAuthorModel, type IconAuthorModel } from "@sketchi/icon-draw";

import { attemptCeilingUsd, drawMark, REVIEW_NOTE_MAX_BYTES, reviewNoteFits } from "./draw-mark";
import { promote } from "./promote";
import { readRecipe, type SheetTheme, writeRecipeSheets } from "./recipe-sheets";
import { BatchWriteError, runBatch } from "./runner";
import { marksToDraw } from "./selection";
import { writeSheets } from "./sheets";
import { RunStore } from "./store";
import { ledgerCsv, summaryMarkdown } from "./summary";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const catalogRoot = join(workspaceRoot, "packages/icons/catalog");
const recipesDir = join(catalogRoot, "recipes");

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		run: { type: "string", default: "catalog" },
		sample: { type: "string" },
		slugs: { type: "string" },
		concurrency: { type: "string", default: "4" },
		cap: { type: "string", default: "60" },
		author: { type: "string", default: "source" },
		retry: { type: "string", default: "claude-opus-5-5" },
		reject: { type: "string" },
		replace: { type: "boolean", default: false },
		collection: { type: "string" },
		notes: { type: "string" },
		theme: { type: "string", default: "light" },
	},
});
const command = positionals[0];
const store = new RunStore(join(workspaceRoot, ".memory/icon-batch", values.run));

async function loadSvg(slug: string): Promise<string | undefined> {
	const file = getIconSourceFile(slug);
	return file === undefined ? undefined : readFile(join(catalogRoot, "svg", file), "utf8");
}

function author(value: string): IconAuthorModel {
	const model = iconAuthorModel(value);
	if (!model) throw new Error(`${value} is not an icon author model.`);
	return model;
}

function positiveNumber(value: string, flag: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0)
		throw new Error(`--${flag} must be a positive number.`);
	return number;
}

function reviewNotes(file: string | undefined): Map<string, string> {
	const notes = new Map<string, string>();
	if (file === undefined) return notes;
	const value: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("--notes expects an object mapping mark slugs to reviewer notes.");
	}
	for (const [slug, note] of Object.entries(value)) {
		if (typeof note !== "string" || !reviewNoteFits(note)) {
			throw new Error(
				`--notes: ${slug} needs a text note of at most ${REVIEW_NOTE_MAX_BYTES} UTF-8 bytes.`,
			);
		}
		notes.set(slug, note);
	}
	return notes;
}

const recipeSlugs = () =>
	new Set(
		readdirSync(recipesDir)
			.filter((file) => file.endsWith(".json"))
			.map((file) => file.slice(0, -".json".length)),
	);

async function writeLedger() {
	const records = await store.records();
	const remaining = marksToDraw(nodeLogoIcons, recipeSlugs()).filter(
		(mark) => !records.some((record) => record.slug === mark.slug && record.status !== undefined),
	).length;
	await writeFile(join(store.root, "ledger.csv"), ledgerCsv(records), "utf8");
	const markdown = summaryMarkdown(records, { remaining });
	await writeFile(join(store.root, "summary.md"), markdown, "utf8");
	return markdown;
}

switch (command) {
	case "draw": {
		// @effect-diagnostics-next-line processEnv:off -- The Node command host reads the gateway credential from its invoking environment.
		const { CF_AIG_TOKEN: token, CLOUDFLARE_ACCOUNT_ID } = process.env;
		const accountId = CLOUDFLARE_ACCOUNT_ID?.trim();
		if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required.");
		if (!token) throw new Error("Set CF_AIG_TOKEN to Sketchi's AI Gateway token.");
		const marks = marksToDraw(nodeLogoIcons, recipeSlugs(), {
			...(values.slugs ? { slugs: values.slugs.split(",").map((slug) => slug.trim()) } : {}),
			...(values.sample ? { sample: positiveNumber(values.sample, "sample") } : {}),
		});
		const notes = reviewNotes(values.notes);
		await mkdir(store.root, { recursive: true });
		const access = { accountId, token };
		const runId = values.run;
		const outcome = await runBatch({
			marks,
			store,
			concurrency: positiveNumber(values.concurrency, "concurrency"),
			spendCapUsd: positiveNumber(values.cap, "cap"),
			authors: {
				first: values.author === "source" ? "source" : author(values.author),
				retry: author(values.retry),
			},
			ceilingUsd: (model, mark) => attemptCeilingUsd(model, notes.get(mark.slug)),
			draw: (mark, model, attempt) => {
				const note = notes.get(mark.slug);
				return drawMark(access, {
					slug: mark.slug,
					name: mark.name,
					author: model,
					traceId: `icon-batch-${runId}-${mark.slug}-${attempt}`,
					loadCatalogSvg: loadSvg,
					...(note === undefined ? {} : { note }),
				});
			},
			log: (line) => process.stdout.write(`${line}\n`),
		}).catch((error: unknown) => {
			if (!(error instanceof BatchWriteError)) throw error;
			process.stderr.write(`${error.message}\n`);
			for (const record of error.unwritten) {
				process.stderr.write(
					`${join(store.marksDir, `${record.slug}.json`)}:\n${JSON.stringify(record)}\n`,
				);
			}
			return undefined;
		});
		if (outcome === undefined) {
			process.exitCode = 1;
			break;
		}
		if (outcome.unresolved.length > 0) {
			process.stderr.write(
				`Unresolved attempts (ceiling charged; not replayed): ${outcome.unresolved.join(", ")}. Reconcile their mark records before retrying them.\n`,
			);
		}
		process.stdout.write(
			`${outcome.settled} settled, ${outcome.pending} pending, $${outcome.spentUsd.toFixed(2)} accounted${outcome.capped ? " (stopped at the spend cap)" : ""}.\n`,
		);
		process.stdout.write(await writeLedger());
		break;
	}
	case "sheets": {
		const written = await writeSheets(store, loadSvg, join(store.root, "sheets"));
		process.stdout.write(`${written.join("\n")}\n`);
		break;
	}
	case "recipe-sheets": {
		const theme = values.theme;
		if (theme !== "light" && theme !== "dark") throw new Error("--theme must be light or dark.");
		const drawn = recipeSlugs();
		const icons = values.slugs
			? values.slugs.split(",").map((slug) => slug.trim())
			: iconManifest.icons
					.filter((icon) => icon.collection === values.collection && drawn.has(icon.slug))
					.map((icon) => icon.slug);
		if (icons.length === 0) throw new Error("Name a --collection with recipes, or --slugs.");
		const marks = await Promise.all(
			icons.map(async (slug) => ({
				slug,
				name: iconManifest.icons.find((icon) => icon.slug === slug)?.name ?? slug,
				svg: await loadSvg(slug),
				recipe: await readRecipe(recipesDir, slug),
			})),
		);
		const label = values.collection ?? "recipes";
		const written = await writeRecipeSheets(
			marks,
			theme satisfies SheetTheme,
			join(workspaceRoot, ".memory/icon-batch/recipe-sheets"),
			label,
		);
		process.stdout.write(`${written.join("\n")}\n`);
		break;
	}
	case "summary": {
		process.stdout.write(await writeLedger());
		break;
	}
	case "promote": {
		const rejected = new Set(
			values.reject
				? readFileSync(values.reject, "utf8")
						.split(/[\s,]+/u)
						.filter(Boolean)
				: [],
		);
		const { written, skipped } = await promote(await store.records(), recipesDir, rejected, {
			replace: values.replace,
		});
		process.stdout.write(`Wrote ${written.length} recipes to ${recipesDir}.\n`);
		for (const { slug, reason } of skipped) process.stdout.write(`skipped ${slug}: ${reason}\n`);
		break;
	}
	default:
		process.stderr.write(
			"Usage: icon-batch <draw|sheets|summary|promote|recipe-sheets> [--run name] [--sample n | --slugs a,b] [--concurrency 4] [--cap 60] [--author source] [--retry claude-opus-5-5] [--reject file] [--replace] [--notes notes.json] [--collection c] [--theme light|dark]\n",
		);
		process.exitCode = 2;
}
