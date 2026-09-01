import { pathToFileURL } from "node:url";

import { NodeRuntime } from "@effect/platform-node";
import { diagramGenerationPolicyDefaults } from "@sketchi/diagram-generation";
import {
  generationReliabilityScenarios,
  type GenerationReliabilityScenario,
} from "@sketchi/diagram-scenarios";
import { Clock, Effect, Schema } from "effect";

const DEFAULT_ENDPOINT = "https://playground.sketchi.app/api/v1/generate";
const DEFAULT_REPEATS = 3;
const REQUEST_TIMEOUT_MARGIN_MS = 30_000;

export function generationProbeRequestTimeoutMs(): number {
  const policy = diagramGenerationPolicyDefaults;
  const retryDelayBudgetMs = Array.from(
    { length: policy.maxRetries },
    (_, retryIndex) => policy.retryDelayMs * 2 ** retryIndex,
  ).reduce((total, delayMs) => total + delayMs, 0);
  const modelCallBudgetMs =
    (policy.maxRetries + 1) * policy.requestTimeoutMs + retryDelayBudgetMs;
  return (
    (policy.maxRepairAttempts + 1) * modelCallBudgetMs +
    REQUEST_TIMEOUT_MARGIN_MS
  );
}

const REQUEST_TIMEOUT_MS = generationProbeRequestTimeoutMs();

interface UnknownRecord {
  readonly [key: string]: unknown;
}

export interface StructuralFidelityResult {
  readonly details: Record<string, number>;
  readonly failures: readonly string[];
  readonly passed: boolean;
}

interface ProbeRunResult extends StructuralFidelityResult {
  readonly durationMs: number;
  readonly runNumber: number;
  readonly scenarioId: string;
  readonly statusCode: number;
}

export class GenerationProbeRequestError extends Schema.TaggedErrorClass<GenerationProbeRequestError>()(
  "GenerationProbeRequestError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function normalizedLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function labelMatches(
  value: string | undefined,
  expectedLabels: readonly string[],
): boolean {
  if (!value) return false;
  const normalizedValue = normalizedLabel(value);
  return expectedLabels.some((expected) =>
    normalizedValue.includes(normalizedLabel(expected)),
  );
}

function flowchartFidelity(
  scenario: Extract<
    GenerationReliabilityScenario,
    { diagramType: "flowchart" }
  >,
  spec: UnknownRecord,
): StructuralFidelityResult {
  const rawNodes = spec["nodes"];
  const rawEdges = spec["edges"];
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
    return {
      details: {},
      failures: ["Flowchart document omitted nodes or edges."],
      passed: false,
    };
  }
  const nodes = rawNodes.filter(isUnknownRecord);
  const edges = rawEdges.filter(isUnknownRecord);
  const decisions = nodes.filter((node) => node["kind"] === "decision");
  const ends = nodes.filter((node) => node["kind"] === "end");
  const nodesById = new Map(
    nodes.flatMap((node) => {
      const id = stringValue(node, "id");
      return id ? [[id, node] as const] : [];
    }),
  );
  const flowEdges = edges.flatMap((edge) => {
    const source = stringValue(edge, "source");
    const target = stringValue(edge, "target");
    return source && target
      ? [{ label: stringValue(edge, "label"), source, target }]
      : [];
  });
  const adjacency = new Map<string, string[]>();
  for (const edge of flowEdges) {
    adjacency.set(edge.source, [
      ...(adjacency.get(edge.source) ?? []),
      edge.target,
    ]);
  }
  const findPath = (
    start: string,
    destination: string,
  ): readonly string[] | undefined => {
    const pending: Array<{ id: string; path: readonly string[] }> = [
      { id: start, path: [start] },
    ];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      if (current.id === destination) return current.path;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      pending.push(
        ...(adjacency.get(current.id) ?? []).map((id) => ({
          id,
          path: [...current.path, id],
        })),
      );
    }
    return undefined;
  };
  const pathExists = (start: string, destination: string): boolean =>
    findPath(start, destination) !== undefined;
  const findPathIncludingLabelGroups = (
    start: string,
    destination: string,
    labelGroups: readonly (readonly string[])[],
    seedNodeIds: readonly string[] = [],
  ): readonly string[] | undefined => {
    const matchGroups = (
      nodeIds: readonly string[],
      matchedGroups: ReadonlySet<number>,
    ): ReadonlySet<number> => {
      const nextMatchedGroups = new Set(matchedGroups);
      for (const nodeId of nodeIds) {
        const label = stringValue(nodesById.get(nodeId) ?? {}, "label");
        labelGroups.forEach((group, index) => {
          if (labelMatches(label, group)) nextMatchedGroups.add(index);
        });
      }
      return nextMatchedGroups;
    };
    const initialMatchedGroups = matchGroups(seedNodeIds, new Set());
    const pending: Array<{
      id: string;
      matchedGroups: ReadonlySet<number>;
      path: readonly string[];
    }> = [
      {
        id: start,
        matchedGroups: matchGroups([start], initialMatchedGroups),
        path: [start],
      },
    ];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.shift();
      if (!current) continue;
      const stateKey = `${current.id}|${[...current.matchedGroups].sort().join(",")}`;
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      if (current.id === destination) {
        if (current.matchedGroups.size === labelGroups.length) {
          return current.path;
        }
        continue;
      }
      for (const id of adjacency.get(current.id) ?? []) {
        pending.push({
          id,
          matchedGroups: matchGroups([id], current.matchedGroups),
          path: [...current.path, id],
        });
      }
    }
    return undefined;
  };
  const cycleDecisionCount = decisions.filter((decision) => {
    const id = stringValue(decision, "id");
    return id
      ? (adjacency.get(id) ?? []).some((target) => pathExists(target, id))
      : false;
  }).length;
  const requiredCyclePaths = scenario.assertions.requiredCyclePaths ?? [];
  const requiredCycleFingerprints = requiredCyclePaths.map((required) => {
    for (const edge of flowEdges) {
      if (!labelMatches(edge.label, required.branchLabels)) continue;
      const branchSourceLabel = stringValue(
        nodesById.get(edge.source) ?? {},
        "label",
      );
      if (!labelMatches(branchSourceLabel, required.branchSourceNodeLabels)) {
        continue;
      }
      const returnPath = findPathIncludingLabelGroups(
        edge.target,
        edge.source,
        required.cycleNodeLabelGroups,
        [edge.source],
      );
      if (!returnPath) continue;
      const cycleNodeIds = new Set([edge.source, ...returnPath]);
      return [...cycleNodeIds].sort().join("|");
    }
    return undefined;
  });
  const requiredCyclePathCount = requiredCycleFingerprints.filter(
    (fingerprint) => fingerprint !== undefined,
  ).length;
  const distinctCycleCount = new Set(
    requiredCycleFingerprints.filter(
      (fingerprint) => fingerprint !== undefined,
    ),
  ).size;
  const endIds = ends.flatMap((node) => {
    const id = stringValue(node, "id");
    return id ? [id] : [];
  });
  const requiredTerminalPaths = scenario.assertions.requiredTerminalPaths ?? [];
  const requiredTerminalPathCount = requiredTerminalPaths.filter((required) =>
    flowEdges.some((edge) => {
      if (!labelMatches(edge.label, required.branchLabels)) return false;
      const branchSourceLabel = stringValue(
        nodesById.get(edge.source) ?? {},
        "label",
      );
      if (!labelMatches(branchSourceLabel, required.branchSourceNodeLabels)) {
        return false;
      }
      if (findPath(edge.target, edge.source)) return false;
      return endIds.some(
        (endId) =>
          findPathIncludingLabelGroups(
            edge.target,
            endId,
            required.terminalNodeLabelGroups,
          ) !== undefined,
      );
    }),
  ).length;
  const unlabeledDecisionBranches = decisions.reduce((count, decision) => {
    const id = stringValue(decision, "id");
    if (!id) return count + 1;
    return (
      count +
      edges
        .filter((edge) => edge["source"] === id)
        .filter((edge) => {
          const label = stringValue(edge, "label");
          return !label?.trim();
        }).length
    );
  }, 0);
  const details = {
    cycleDecisionCount,
    decisionCount: decisions.length,
    distinctCycleCount,
    edgeCount: edges.length,
    endCount: ends.length,
    nodeCount: nodes.length,
    requiredCyclePathCount,
    requiredTerminalPathCount,
    unlabeledDecisionBranches,
  };
  const failures = [
    ...(nodes.length < scenario.assertions.minNodeCount
      ? [`Expected >=${scenario.assertions.minNodeCount} nodes.`]
      : []),
    ...(edges.length < scenario.assertions.minEdgeCount
      ? [`Expected >=${scenario.assertions.minEdgeCount} edges.`]
      : []),
    ...(decisions.length < scenario.assertions.minDecisionCount
      ? [`Expected >=${scenario.assertions.minDecisionCount} decisions.`]
      : []),
    ...(ends.length < scenario.assertions.minEndCount
      ? [`Expected >=${scenario.assertions.minEndCount} ends.`]
      : []),
    ...(cycleDecisionCount < scenario.assertions.minCycleDecisionCount
      ? [
          `Expected >=${scenario.assertions.minCycleDecisionCount} decisions participating in cycles.`,
        ]
      : []),
    ...(requiredCyclePathCount < requiredCyclePaths.length
      ? [
          `Expected ${requiredCyclePaths.length} labeled cycle paths; found ${requiredCyclePathCount}.`,
        ]
      : []),
    ...(distinctCycleCount < (scenario.assertions.minDistinctCycleCount ?? 0)
      ? [
          `Expected >=${scenario.assertions.minDistinctCycleCount ?? 0} distinct labeled cycles; found ${distinctCycleCount}.`,
        ]
      : []),
    ...(requiredTerminalPathCount < requiredTerminalPaths.length
      ? [
          `Expected ${requiredTerminalPaths.length} labeled terminal paths; found ${requiredTerminalPathCount}.`,
        ]
      : []),
    ...(unlabeledDecisionBranches > 0
      ? [`Found ${unlabeledDecisionBranches} unlabeled decision branches.`]
      : []),
  ];
  return { details, failures, passed: failures.length === 0 };
}

function mindmapFidelity(
  scenario: Extract<GenerationReliabilityScenario, { diagramType: "mindmap" }>,
  spec: UnknownRecord,
): StructuralFidelityResult {
  const root = spec["root"];
  if (!isUnknownRecord(root)) {
    return {
      details: {},
      failures: ["Mindmap document omitted its nested root."],
      passed: false,
    };
  }
  let maxDepth = 0;
  let topicCount = 0;
  const pending: Array<{ depth: number; topic: UnknownRecord }> = [
    { depth: 0, topic: root },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    topicCount += 1;
    maxDepth = Math.max(maxDepth, current.depth);
    const children = current.topic["children"];
    if (Array.isArray(children)) {
      for (const child of children) {
        if (isUnknownRecord(child)) {
          pending.push({ depth: current.depth + 1, topic: child });
        }
      }
    }
  }
  const details = { maxDepth, topicCount };
  const failures = [
    ...(topicCount < scenario.assertions.minTopicCount
      ? [`Expected >=${scenario.assertions.minTopicCount} topics.`]
      : []),
    ...(maxDepth < scenario.assertions.minDepth
      ? [`Expected depth >=${scenario.assertions.minDepth}.`]
      : []),
  ];
  return { details, failures, passed: failures.length === 0 };
}

export function evaluateStructuralFidelity(
  scenario: GenerationReliabilityScenario,
  document: unknown,
): StructuralFidelityResult {
  if (!isUnknownRecord(document) || document["type"] !== scenario.diagramType) {
    return {
      details: {},
      failures: [
        `Response did not contain a ${scenario.diagramType} document.`,
      ],
      passed: false,
    };
  }
  const spec = document["spec"];
  if (!isUnknownRecord(spec)) {
    return {
      details: {},
      failures: ["Response document omitted its spec."],
      passed: false,
    };
  }
  return scenario.diagramType === "flowchart"
    ? flowchartFidelity(scenario, spec)
    : mindmapFidelity(scenario, spec);
}

export function selectProbeScenarios(
  scenarioId: string | undefined,
): readonly GenerationReliabilityScenario[] {
  const selectedId = scenarioId?.trim();
  return selectedId
    ? generationReliabilityScenarios.filter(
        (scenario) => scenario.id === selectedId,
      )
    : generationReliabilityScenarios;
}

const runProbe = Effect.fn("generationReliabilityProbe.run")(function* (
  endpoint: string,
  scenario: GenerationReliabilityScenario,
  runNumber: number,
) {
  const startedAt = yield* Clock.currentTimeMillis;
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(endpoint, {
        body: JSON.stringify({
          cacheMode: "fresh",
          prompt: scenario.prompt,
          type: scenario.diagramType,
        }),
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
          "X-Sketchi-Client": "generation-reliability-probe",
        },
        method: "POST",
        signal,
      }),
    catch: (cause) =>
      GenerationProbeRequestError.make({
        cause,
        message: `Request for ${scenario.id} failed.`,
      }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          GenerationProbeRequestError.make({
            cause: new Error("Request timed out."),
            message: `Request for ${scenario.id} timed out after ${REQUEST_TIMEOUT_MS} ms.`,
          }),
        ),
    }),
  );
  const body = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      GenerationProbeRequestError.make({
        cause,
        message: `Response for ${scenario.id} was not JSON.`,
      }),
  });
  const finishedAt = yield* Clock.currentTimeMillis;
  const durationMs = Math.round(finishedAt - startedAt);
  if (!response.ok || !isUnknownRecord(body) || body["ok"] !== true) {
    const status = isUnknownRecord(body) ? body["status"] : undefined;
    const issues = isUnknownRecord(body) ? body["issues"] : undefined;
    const message = Array.isArray(issues)
      ? issues
          .filter(isUnknownRecord)
          .map((issue) => stringValue(issue, "message"))
          .filter((value): value is string => Boolean(value))
          .slice(0, 3)
          .join(" | ")
      : "";
    return {
      details: {},
      durationMs,
      failures: [
        `HTTP ${response.status}; status=${String(status ?? "unknown")} ${message}`.trim(),
      ],
      passed: false,
      runNumber,
      scenarioId: scenario.id,
      statusCode: response.status,
    } satisfies ProbeRunResult;
  }
  const diagram = body["diagram"];
  const document = isUnknownRecord(diagram) ? diagram["document"] : undefined;
  return {
    ...evaluateStructuralFidelity(scenario, document),
    durationMs,
    runNumber,
    scenarioId: scenario.id,
    statusCode: response.status,
  } satisfies ProbeRunResult;
});

function repeatCount(): number {
  const configured = Number.parseInt(
    process.env["SKETCHI_PROBE_REPEATS"] ?? String(DEFAULT_REPEATS),
    10,
  );
  return Number.isInteger(configured) && configured >= DEFAULT_REPEATS
    ? configured
    : DEFAULT_REPEATS;
}

const main = Effect.gen(function* () {
  const endpoint =
    process.env["SKETCHI_GENERATE_ENDPOINT"]?.trim() || DEFAULT_ENDPOINT;
  const repeats = repeatCount();
  const scenarios = selectProbeScenarios(process.env["SKETCHI_PROBE_SCENARIO"]);
  if (scenarios.length === 0) {
    return yield* GenerationProbeRequestError.make({
      cause: new Error("Unknown generation reliability scenario."),
      message: `No generation reliability scenario matched ${process.env["SKETCHI_PROBE_SCENARIO"] ?? "the configured id"}.`,
    });
  }
  const inputs = scenarios.flatMap((scenario) =>
    Array.from({ length: repeats }, (_, index) => ({
      runNumber: index + 1,
      scenario,
    })),
  );
  const results = yield* Effect.forEach(
    inputs,
    ({ runNumber, scenario }) =>
      runProbe(endpoint, scenario, runNumber).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            details: {},
            durationMs: 0,
            failures: [error.message],
            passed: false,
            runNumber,
            scenarioId: scenario.id,
            statusCode: 0,
          } satisfies ProbeRunResult),
        ),
      ),
    { concurrency: 1 },
  );
  for (const result of results) {
    console.log(
      `${result.scenarioId} run ${result.runNumber}: ${result.passed ? "PASS" : "FAIL"} (${result.durationMs} ms) ${JSON.stringify(result.passed ? result.details : result.failures)}`,
    );
  }
  console.log("\n| Scenario | Passed | Runs | Pass rate |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const scenario of scenarios) {
    const matching = results.filter(
      (result) => result.scenarioId === scenario.id,
    );
    const passed = matching.filter((result) => result.passed).length;
    console.log(
      `| ${scenario.id} | ${passed} | ${matching.length} | ${Math.round((passed / matching.length) * 100)}% |`,
    );
  }
  const passed = results.filter((result) => result.passed).length;
  console.log(
    `| **Total** | **${passed}** | **${results.length}** | **${Math.round((passed / results.length) * 100)}%** |`,
  );
  console.log(`\nEndpoint: ${endpoint}`);
  if (passed !== results.length) process.exitCode = 1;
});

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  NodeRuntime.runMain(main);
}
