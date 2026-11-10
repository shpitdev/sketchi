import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { MarkAttempt } from "./draw-mark.js";
import type { CatalogMark } from "./selection.js";

/** Recognized: the judge picked the drawing's source out of its look-alikes. */
export type MarkStatus = "recognized" | "unrecognized" | "failed";

/** An attempt as the ledger keeps it; its previews are PNG files beside the record. */
export type StoredAttempt = Omit<MarkAttempt, "previews">;

export interface MarkRecord extends CatalogMark {
	/** Absent until the mark is settled; a run resumes a mark without one. */
	readonly status?: MarkStatus;
	readonly attempts: readonly StoredAttempt[];
	/** The attempt whose drawing stands for the mark: the recognized one, else the last drawn. */
	readonly chosen?: number;
}

/** Spend of one attempt: the gateway's price when known, else the estimate. */
export function attemptCost(attempt: StoredAttempt): number {
	return attempt.costUsd ?? attempt.estimatedCostUsd;
}

export function recordCost(record: MarkRecord): number {
	return record.attempts.reduce((sum, attempt) => sum + attemptCost(attempt), 0);
}

/**
 * One run's files: a JSON record per mark under `marks/`, the chosen and
 * retried drawings' previews under `previews/`. Every write replaces a whole
 * file, so a run stopped at any point resumes from what is on disk.
 */
export class RunStore {
	readonly marksDir: string;
	readonly previewsDir: string;

	constructor(readonly root: string) {
		this.marksDir = join(root, "marks");
		this.previewsDir = join(root, "previews");
	}

	async records(): Promise<MarkRecord[]> {
		await mkdir(this.marksDir, { recursive: true });
		const files = (await readdir(this.marksDir)).filter((file) => file.endsWith(".json")).sort();
		const records: MarkRecord[] = [];
		for (const file of files) {
			records.push(JSON.parse(await readFile(join(this.marksDir, file), "utf8")) as MarkRecord);
		}
		return records;
	}

	async save(record: MarkRecord): Promise<void> {
		await mkdir(this.marksDir, { recursive: true });
		const path = join(this.marksDir, `${record.slug}.json`);
		await writeFile(`${path}.tmp`, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
		await rename(`${path}.tmp`, path);
	}

	previewPath(slug: string, attempt: number, size: 28 | 112): string {
		return join(this.previewsDir, `${slug}.${attempt}.${size}.png`);
	}

	async savePreviews(
		slug: string,
		attempt: number,
		previews: { readonly png28: string; readonly png112: string },
	): Promise<void> {
		await mkdir(this.previewsDir, { recursive: true });
		await writeFile(this.previewPath(slug, attempt, 28), Buffer.from(previews.png28, "base64"));
		await writeFile(this.previewPath(slug, attempt, 112), Buffer.from(previews.png112, "base64"));
	}
}
