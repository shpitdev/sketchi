import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

interface VitestSummary {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: Array<{
    assertionResults: Array<{
      fullName: string;
      status: string;
      duration?: number;
    }>;
    name: string;
  }>;
  startTime?: number;
  success?: boolean;
}

const outputDir = join(process.cwd(), "test-results");
const vitestPath = join(outputDir, "vitest.json");
const shareLinksPath = join(outputDir, "excalidraw-share-links.json");
const summaryPath = join(outputDir, "summary.md");

function formatDuration(ms?: number) {
  if (!ms || Number.isNaN(ms)) return "-";
  return `${ms.toFixed(0)}ms`;
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const vitest = await readJsonIfExists<VitestSummary>(vitestPath);
const shareLinks = await readJsonIfExists<{
  scenario: string;
  shareId: string;
  url: string;
  elementsCount: number;
  elementTypes?: string[];
  appStateKeys: string[];
  createdAt: string;
}>(shareLinksPath);

await mkdir(outputDir, { recursive: true });

const lines: string[] = [];
lines.push("# Test Summary");
lines.push("");

if (vitest) {
  lines.push("## Vitest Results");
  lines.push("");
  lines.push(
    `- Total: ${vitest.numTotalTests} | Passed: ${vitest.numPassedTests} | Failed: ${vitest.numFailedTests} | Pending: ${vitest.numPendingTests}`
  );
  lines.push("");
  lines.push("| Test | Status | Duration |");
  lines.push("| --- | --- | --- |");

  for (const file of vitest.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      lines.push(
        `| ${test.fullName} | ${test.status} | ${formatDuration(test.duration)} |`
      );
    }
  }
  lines.push("");
}

if (shareLinks) {
  lines.push("## Excalidraw Share Link");
  lines.push("");
  lines.push(`- Scenario: ${shareLinks.scenario}`);
  lines.push(`- Share ID: ${shareLinks.shareId}`);
  lines.push(`- URL: ${shareLinks.url}`);
  lines.push(`- Elements: ${shareLinks.elementsCount}`);
  if (shareLinks.elementTypes?.length) {
    lines.push(`- Element types: ${shareLinks.elementTypes.join(", ")}`);
  }
  lines.push(
    `- AppState keys: ${shareLinks.appStateKeys.join(", ") || "none"}`
  );
  lines.push(`- Created: ${shareLinks.createdAt}`);
  lines.push("");
}

if (!vitest && !shareLinks) {
  lines.push("No test results found.");
  lines.push("");
}

await writeFile(summaryPath, lines.join("\n"));
