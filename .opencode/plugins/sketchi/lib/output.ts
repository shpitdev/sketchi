import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

export const DEFAULT_OUTPUT_DIR = "sketchi/png";

export function resolveOutputPath(path: string, baseDir: string): string {
  return resolve(baseDir, path);
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function buildDefaultPngPath(prefix: string, baseDir: string): string {
  const folder = resolve(baseDir, DEFAULT_OUTPUT_DIR);
  const filename = `${prefix}-${formatTimestamp(new Date())}-${randomUUID().slice(0, 8)}.png`;
  return resolve(folder, filename);
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export async function writePng(outputPath: string, png: Buffer): Promise<string> {
  await ensureDir(outputPath);
  await writeFile(outputPath, png);
  return outputPath;
}