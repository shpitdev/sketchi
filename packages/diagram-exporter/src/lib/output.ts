import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const DEFAULT_OUTPUT_DIR = ".sketchi/sessions";
const DEFAULT_PNG_SUBDIR = "png";
const DEFAULT_SESSION_ID = "unknown-session";

interface ResolveOutputPathOptions {
  allowUnsafeOutputPath?: boolean;
}

function normalizeSessionIdForPath(sessionID: string): string {
  const trimmed = sessionID.trim();
  if (!trimmed) {
    return DEFAULT_SESSION_ID;
  }

  const normalized = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
  return normalized.length > 0 ? normalized : DEFAULT_SESSION_ID;
}

export function resolveSessionPngOutputRoot(
  baseDir: string,
  sessionID: string
): string {
  return resolve(
    baseDir,
    DEFAULT_OUTPUT_DIR,
    normalizeSessionIdForPath(sessionID),
    DEFAULT_PNG_SUBDIR
  );
}

function isPathWithinRoot(candidatePath: string, root: string): boolean {
  const relativePath = relative(root, candidatePath);
  if (relativePath === "") {
    return true;
  }

  return !(relativePath.startsWith("..") || isAbsolute(relativePath));
}

export function resolveOutputPath(
  path: string,
  baseDir: string,
  sessionID: string,
  options: ResolveOutputPathOptions = {}
): string {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    throw new Error("outputPath must not be empty.");
  }

  if (options.allowUnsafeOutputPath) {
    return resolve(baseDir, normalizedPath);
  }

  const outputRoot = resolveSessionPngOutputRoot(baseDir, sessionID);
  const resolvedPath = isAbsolute(normalizedPath)
    ? resolve(normalizedPath)
    : resolve(outputRoot, normalizedPath);

  if (!isPathWithinRoot(resolvedPath, outputRoot)) {
    throw new Error(
      `outputPath must stay within ${outputRoot}. Set SKETCHI_ALLOW_UNSAFE_OUTPUT_PATH=1 to allow paths outside this directory.`
    );
  }

  return resolvedPath;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function buildDefaultPngPath(
  prefix: string,
  baseDir: string,
  sessionID: string
): string {
  const folder = resolveSessionPngOutputRoot(baseDir, sessionID);
  const filename = `${prefix}-${formatTimestamp(new Date())}-${randomUUID().slice(0, 8)}.png`;
  return resolve(folder, filename);
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export async function writePng(
  outputPath: string,
  png: Buffer
): Promise<string> {
  await ensureDir(outputPath);
  await writeFile(outputPath, png);
  return outputPath;
}
