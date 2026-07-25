import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Worker hostnames are an implementation detail. Once one reaches a user it is
 * copied into an agent config we cannot reach, so moving the product off
 * Cloudflare would silently break every install. Production strings must
 * therefore only ever name public `sketchi.app` hosts.
 *
 * PR preview deployments are the deliberate exception: a preview Worker has no
 * custom domain, so `workers.dev` genuinely is its hostname. Preview code paths
 * opt out with an explicit marker so that the exception is always visible in
 * review rather than assumed.
 */
const PREVIEW_EXCEPTION_MARKER = "sketchi-allow-workers-dev";

/** How many lines above a match the marker may sit (comment above the code). */
const MARKER_LOOKBEHIND_LINES = 4;

const WORKER_HOSTNAME = /workers\.dev/;

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

/** Trees whose contents are shipped to or pasted by users. */
const SCANNED_ROOTS = [
  ".agents",
  "apps/excalidraw/src",
  "apps/icons/src",
  "apps/playground/src",
  "apps/web/src",
  "plugins",
];

const SCANNED_EXTENSIONS = [
  ".json",
  ".jsonc",
  ".md",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
];

/**
 * Tests and stories are fixtures, not user-facing output, and they need
 * preview hostnames to prove the preview path still resolves.
 */
const FIXTURE_FILE = /\.(?:test|browser\.test|stories)\.[a-z]+$/;

function sourceFiles(root: string): string[] {
  const absoluteRoot = join(repoRoot, root);
  let entries: ReturnType<typeof readdirSync>;

  try {
    entries = readdirSync(absoluteRoot, {
      recursive: true,
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        SCANNED_EXTENSIONS.some((extension) =>
          entry.name.endsWith(extension),
        ) &&
        !FIXTURE_FILE.test(entry.name),
    )
    .map((entry) => join(entry.parentPath, entry.name));
}

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function unmarkedWorkerHostnames(file: string): Offence[] {
  const lines = readFileSync(file, "utf8").split("\n");

  return lines.flatMap((text, index) => {
    if (!WORKER_HOSTNAME.test(text)) {
      return [];
    }

    const marked = lines
      .slice(Math.max(0, index - MARKER_LOOKBEHIND_LINES), index + 1)
      .some((candidate) => candidate.includes(PREVIEW_EXCEPTION_MARKER));

    return marked
      ? []
      : [
          {
            file: relative(repoRoot, file),
            line: index + 1,
            text: text.trim(),
          },
        ];
  });
}

describe("public surface URLs", () => {
  it("never names a Worker hostname outside an annotated preview path", () => {
    const offences = SCANNED_ROOTS.flatMap(sourceFiles).flatMap(
      unmarkedWorkerHostnames,
    );

    expect(
      offences.map(
        (offence) => `${offence.file}:${offence.line} ${offence.text}`,
      ),
    ).toEqual([]);
  });

  it("keeps the preview exception reachable rather than dead", () => {
    const marked = SCANNED_ROOTS.flatMap(sourceFiles).filter((file) =>
      readFileSync(file, "utf8").includes(PREVIEW_EXCEPTION_MARKER),
    );

    expect(marked.length).toBeGreaterThan(0);
  });

  it("ships agent configs that point at the public MCP endpoint", () => {
    const configs = [
      ".agents/mcp_config.json",
      "plugins/sketchi-code-mode-claude/.mcp.json",
      "plugins/sketchi-code-mode-codex/.mcp.json",
    ];

    for (const config of configs) {
      const contents = readFileSync(join(repoRoot, config), "utf8");
      expect(contents).toContain("https://playground.sketchi.app/mcp");
      expect(contents).not.toContain("workers.dev");
    }
  });
});
