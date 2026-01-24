import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runRoot = path.resolve(scriptDir, "..");
const artifactsDir = path.join(runRoot, "artifacts");
const summaryPath = path.join(artifactsDir, "e2e-run-summary.jsonl");

const scenarios = process.argv.slice(2);
if (scenarios.length === 0) {
  console.error(
    "Usage: bun run tests/e2e/scripts/run-scenarios.ts <scenario...>"
  );
  process.exit(1);
}

async function readSummaryLines() {
  try {
    const text = await fs.readFile(summaryPath, "utf8");
    return text.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function findSummary(lines: string[], scenario: string) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed?.scenario === scenario) {
        return parsed;
      }
    } catch {
      // ignore malformed lines
    }
  }
  return null;
}

async function runScenario(name: string) {
  const preLines = await readSummaryLines();
  const preCount = preLines.length;
  const exitCode = await new Promise<number>((resolve) => {
    const proc = spawn("bun", ["run", name], {
      cwd: runRoot,
      stdio: "inherit",
    });
    proc.on("exit", (code) => resolve(code ?? 1));
  });
  const postLines = await readSummaryLines();
  const newLines = postLines.slice(preCount);
  const summary = findSummary(newLines, name) ?? findSummary(postLines, name);

  if (!summary) {
    console.log(
      `Scenario ${name}: no summary found (exit ${exitCode ?? "unknown"}).`
    );
    return { name, status: "failed" as const, exitCode };
  }

  if (exitCode && exitCode !== 0 && summary.status === "passed") {
    console.log(
      `Scenario ${name} exited ${exitCode} but summary passed; continuing.`
    );
  }

  return {
    name,
    status: summary.status as "passed" | "failed",
    visualIssues: Array.isArray(summary.visualIssues)
      ? summary.visualIssues
      : [],
    exitCode,
  };
}

const results: Array<{
  name: string;
  status: "passed" | "failed";
  visualIssues?: string[];
  exitCode: number;
}> = [];

for (const scenario of scenarios) {
  results.push(await runScenario(scenario));
}

for (const result of results) {
  if (result.visualIssues && result.visualIssues.length > 0) {
    const details = result.visualIssues.map((issue) => `- ${issue}`).join("\n");
    console.log(`Visual issues (${result.name}):\n${details}`);
  }
}

const failures = results.filter((result) => result.status !== "passed");
const functionalPassed = results.filter(
  (result) => result.status === "passed"
).length;
const visualPassed = results.filter(
  (result) => (result.visualIssues ?? []).length === 0
).length;
console.log(
  `Functional: ${functionalPassed}/${results.length}, Visual: ${visualPassed}/${results.length}`
);
if (failures.length > 0) {
  console.log(
    `Failed scenarios: ${failures.map((result) => result.name).join(", ")}`
  );
  process.exit(1);
}
