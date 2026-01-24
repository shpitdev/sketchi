import fs from "node:fs/promises";
import path from "node:path";

export interface ScenarioSummary {
  scenario: string;
  status: "passed" | "failed";
  warnings: string[];
  visualIssues?: string[];
  error?: string;
  baseUrl: string;
  env: string;
  startedAt: string;
  finishedAt: string;
}

export async function writeScenarioSummary(params: {
  outputDir: string;
  summary: ScenarioSummary;
}) {
  await fs.mkdir(params.outputDir, { recursive: true });
  const jsonlPath = path.join(params.outputDir, "e2e-run-summary.jsonl");
  const textPath = path.join(params.outputDir, "e2e-run-summary.txt");

  await fs.appendFile(jsonlPath, `${JSON.stringify(params.summary)}\n`);
  await fs.appendFile(textPath, `${formatSummaryLine(params.summary)}\n`);
}

function formatSummaryLine(summary: ScenarioSummary) {
  const warningCount = summary.warnings.length;
  const visualCount = summary.visualIssues?.length ?? 0;
  const errorText = summary.error
    ? ` error="${normalizeText(summary.error)}"`
    : "";
  return `${summary.startedAt} ${summary.status.toUpperCase()} ${summary.scenario} warnings=${warningCount} visual=${visualCount}${errorText}`;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
