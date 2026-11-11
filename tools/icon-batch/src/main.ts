/**
 * Draw the icon catalog by hand: `draw` runs the draw service's engine over
 * every catalog mark without a recipe, `sheets` lays the results out for
 * review, `summary` writes the ledger, and `promote` turns recognized marks
 * into catalog recipes. See README.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { getIconSourceFile, iconManifest, nodeLogoIcons } from "@sketchi/icon-catalog/catalog";
import { iconAuthorModel, type IconAuthorModel } from "@sketchi/icon-draw";

import { drawMark } from "./draw-mark.js";
import { SKETCHI_ACCOUNT_ID } from "./gateway.js";
import { promote } from "./promote.js";
import { readRecipe, type SheetTheme, writeRecipeSheets } from "./recipe-sheets.js";
import { runBatch } from "./runner.js";
import { marksToDraw } from "./selection.js";
import { writeSheets } from "./sheets.js";
import { RunStore } from "./store.js";
import { ledgerCsv, summaryMarkdown } from "./summary.js";

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
		const token = process.env["CF_AIG_TOKEN"];
		if (!token) throw new Error("Set CF_AIG_TOKEN to Sketchi's AI Gateway token.");
		const marks = marksToDraw(nodeLogoIcons, recipeSlugs(), {
			...(values.slugs ? { slugs: values.slugs.split(",").map((slug) => slug.trim()) } : {}),
			...(values.sample ? { sample: positiveNumber(values.sample, "sample") } : {}),
		});
		await mkdir(store.root, { recursive: true });
		const access = { accountId: SKETCHI_ACCOUNT_ID, token };
		// Reviewer notes by slug, for redrawing marks a review rejected.
		const notes = values.notes
			? (JSON.parse(readFileSync(values.notes, "utf8")) as Record<string, string>)
			: {};
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
			draw: async (mark, model, attempt) => {
				const svg = await loadSvg(mark.slug);
				if (svg === undefined) throw new Error(`${mark.slug} has no source SVG.`);
				return drawMark(access, {
					slug: mark.slug,
					name: mark.name,
					svg,
					author: model,
					traceId: `icon-batch-${runId}-${mark.slug}-${attempt}`,
					loadCatalogSvg: loadSvg,
					...(Object.hasOwn(notes, mark.slug) ? { note: notes[mark.slug] } : {}),
				});
			},
			log: (line) => process.stdout.write(`${line}\n`),
		});
		process.stdout.write(
			`${outcome.settled} settled, ${outcome.pending} pending, $${outcome.spentUsd.toFixed(2)} spent${outcome.capped ? " (stopped at the spend cap)" : ""}.\n`,
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
