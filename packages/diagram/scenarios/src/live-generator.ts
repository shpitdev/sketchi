import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface CandidateSummary {
  diagramValid: boolean;
  error?: string;
  text: string;
}

interface GenerateScenarioOutput {
  candidates: CandidateSummary[];
  scenarioId: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value.trim();
}

function endpointUrl(baseUrl: string): string {
  return new URL("/api/scenario-candidates", baseUrl).toString();
}

function optionalPositiveInt(name: string, fallback: number): number {
  const value = process.env[name];
  const parsed = value ? Number.parseInt(value, 10) : fallback;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function responseFileStem(scenarioId: string): string {
  const repeat = optionalPositiveInt("SKETCHI_SCENARIO_REPEAT", 1);
  const runNumber = optionalPositiveInt("SKETCHI_SCENARIO_RUN_NUMBER", 1);

  return repeat > 1
    ? `${scenarioId}.run-${String(runNumber).padStart(3, "0")}`
    : scenarioId;
}

function pickCandidate(
  candidates: readonly CandidateSummary[],
): CandidateSummary | undefined {
  return (
    candidates.find(
      (candidate) => candidate.diagramValid && !candidate.error,
    ) ?? candidates.find((candidate) => candidate.text.trim().length > 0)
  );
}

async function writeResponseSidecar(
  response: GenerateScenarioOutput,
): Promise<void> {
  const resultDir = process.env.SKETCHI_LIVE_RESULT_DIR;

  if (!resultDir || resultDir.trim().length === 0) {
    return;
  }

  const outPath = path.join(
    resultDir,
    `${responseFileStem(response.scenarioId)}.response.json`,
  );
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(response, null, 2)}\n`);
}

async function main() {
  await readStdin();

  const scenarioId = requiredEnv("SKETCHI_SCENARIO_ID");
  const playgroundUrl = requiredEnv("SKETCHI_PLAYGROUND_URL");
  const cacheMode = process.env.SKETCHI_SCENARIO_CACHE_MODE ?? "fresh";
  const response = await fetch(endpointUrl(playgroundUrl), {
    body: JSON.stringify({
      cacheMode,
      providers: ["cloudflare-google-ai-studio"],
      scenarioId,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const data = (await response.json()) as
    | GenerateScenarioOutput
    | {
        error?: string;
      };

  if (!response.ok) {
    throw new Error(
      "error" in data && data.error
        ? data.error
        : `Scenario generation failed with HTTP ${response.status}.`,
    );
  }

  const generationOutput = data as GenerateScenarioOutput;
  await writeResponseSidecar(generationOutput);

  const candidate = pickCandidate(generationOutput.candidates);

  if (!candidate) {
    throw new Error(`No candidate text returned for ${scenarioId}.`);
  }

  process.stdout.write(`${candidate.text.trim()}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
