import {
  type FlowchartDiagram,
  type IntermediateDiagram,
  parseFlowchartDiagram,
} from "@sketchi/diagram-core";
import {
  convertSceneToExcalidraw,
  validateExcalidrawScene,
  type ExcalidrawScene,
  type ExcalidrawSceneValidationResult,
} from "@sketchi/diagram-excalidraw";
import {
  renderIntermediateDiagram,
  type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";
import { termTokens } from "@sketchi/icon-catalog";

import type { DiagramScenario, DiagramScenarioLogo } from "./scenarios.js";

export interface ScenarioCheck {
  id: string;
  message: string;
  passed: boolean;
}

export interface ScenarioEvaluation {
  checks: ScenarioCheck[];
  diagram: IntermediateDiagram;
  excalidrawScene: ExcalidrawScene;
  excalidrawValidation: ExcalidrawSceneValidationResult;
  ok: boolean;
  scenarioId: string;
  scene: RenderedDiagramScene;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function hasLabel(labels: readonly string[], expected: string): boolean {
  const normalized = normalizeLabel(expected);
  return labels.some((label) => normalizeLabel(label).includes(normalized));
}

function edgeMatchesExpected(
  diagram: FlowchartDiagram,
  expected: DiagramScenario["assertions"]["requiredEdges"][number],
): boolean {
  const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]));
  const expectedSourceLabel = normalizeLabel(expected.sourceLabel);
  const expectedTargetLabel = normalizeLabel(expected.targetLabel);
  const expectedBranchLabel = expected.label
    ? normalizeLabel(expected.label)
    : null;

  return diagram.edges.some((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);

    if (!source || !target) {
      return false;
    }

    const sourceMatches = normalizeLabel(source.label).includes(
      expectedSourceLabel,
    );
    const targetMatches = normalizeLabel(target.label).includes(
      expectedTargetLabel,
    );
    const branchMatches =
      expectedBranchLabel === null
        ? true
        : normalizeLabel(edge.label ?? "").includes(expectedBranchLabel);

    return sourceMatches && targetMatches && branchMatches;
  });
}

/** What logo checks need from a scenario. */
export interface ScenarioLogoExpectations {
  readonly logos: readonly DiagramScenarioLogo[];
  readonly requiredIconSlugs: readonly string[];
}

/** The label contains one of the logo's names as whole words. */
function labelNamesLogo(label: string, logo: DiagramScenarioLogo): boolean {
  const words = ` ${termTokens(label).join(" ")} `;
  return [logo.slug.replaceAll("-", " "), logo.name, ...(logo.aliases ?? [])]
    .map((term) => termTokens(term).join(" "))
    .some((phrase) => phrase !== "" && words.includes(` ${phrase} `));
}

/**
 * Logo checks on the model's own diagram, before generation places, drops, or
 * grounds its logos, so they measure the model rather than the repair:
 * recall for each named technology, precision against the prompt, and
 * whether each logo sits on the step that names it. A logo on a generic or
 * unnamed step ("Sync order", "Run the test suite") fails the last check.
 */
export function scenarioLogoChecks(
  expected: ScenarioLogoExpectations,
  modelDiagram: FlowchartDiagram,
): ScenarioCheck[] {
  const offered = new Map(expected.logos.map((logo) => [logo.slug, logo]));
  const icons = modelDiagram.nodes.flatMap((node) =>
    node.icon ? [{ label: node.label, slug: node.icon.slug }] : [],
  );
  const ungrounded = icons.filter((icon) => !offered.has(icon.slug));
  const misplaced = icons.filter((icon) => {
    const logo = offered.get(icon.slug);
    return !logo || !labelNamesLogo(icon.label, logo);
  });
  return [
    ...expected.requiredIconSlugs.map((slug) => ({
      id: `icon:${slug}`,
      passed: icons.some((icon) => icon.slug === slug),
      message: `Expected the model to draw the "${slug}" logo.`,
    })),
    {
      id: "icons-grounded",
      passed: ungrounded.length === 0,
      message:
        ungrounded.length === 0
          ? "Every logo is a technology the prompt names."
          : `Logos the prompt does not name: ${ungrounded
              .map((icon) => icon.slug)
              .join(", ")}.`,
    },
    {
      id: "icons-on-named-steps",
      passed: misplaced.length === 0,
      message:
        misplaced.length === 0
          ? "Every logo sits on a step that names its technology."
          : `Logos on steps that do not name them: ${misplaced
              .map((icon) => `"${icon.label}" (${icon.slug})`)
              .join(", ")}.`,
    },
  ];
}

function flowchartChecks(
  scenario: DiagramScenario,
  diagram: FlowchartDiagram,
): ScenarioCheck[] {
  const nodeLabels = diagram.nodes.map((node) => node.label);
  const branchLabels = diagram.edges
    .map((edge) => edge.label)
    .filter((label): label is string => Boolean(label));
  const nodeKinds = new Set(diagram.nodes.map((node) => node.kind));

  return [
    {
      id: "min-node-count",
      passed: diagram.nodes.length >= scenario.assertions.minNodeCount,
      message: `Expected at least ${scenario.assertions.minNodeCount} nodes.`,
    },
    {
      id: "min-edge-count",
      passed: diagram.edges.length >= scenario.assertions.minEdgeCount,
      message: `Expected at least ${scenario.assertions.minEdgeCount} edges.`,
    },
    ...scenario.assertions.requiredNodeKinds.map((kind) => ({
      id: `node-kind:${kind}`,
      passed: nodeKinds.has(kind),
      message: `Expected at least one ${kind} node.`,
    })),
    ...scenario.assertions.requiredNodeLabels.map((label) => ({
      id: `node-label:${label}`,
      passed: hasLabel(nodeLabels, label),
      message: `Expected a node label like "${label}".`,
    })),
    ...scenario.assertions.requiredBranchLabels.map((label) => ({
      id: `branch-label:${label}`,
      passed: hasLabel(branchLabels, label),
      message: `Expected a decision branch label like "${label}".`,
    })),
    ...scenario.assertions.requiredEdges.map((edge) => ({
      id: `edge:${edge.sourceLabel}->${edge.targetLabel}${
        edge.label ? `:${edge.label}` : ""
      }`,
      passed: edgeMatchesExpected(diagram, edge),
      message: `Expected an edge from "${edge.sourceLabel}" to "${
        edge.targetLabel
      }"${edge.label ? ` labeled like "${edge.label}"` : ""}.`,
    })),
  ];
}

export function extractJsonCandidate(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    const firstBrace = output.indexOf("{");
    const lastBrace = output.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Model output did not contain a JSON object.");
    }

    return JSON.parse(output.slice(firstBrace, lastBrace + 1));
  }
}

/**
 * Evaluate the diagram generation returns. Pass the model's own diagram from
 * before candidate enforcement as `modelCandidate` so logo checks score the
 * model; it defaults to the returned diagram for unrepaired output.
 */
export function evaluateScenarioDiagram(
  scenario: DiagramScenario,
  candidate: unknown,
  modelCandidate: unknown = candidate,
): ScenarioEvaluation {
  const diagram = parseFlowchartDiagram(candidate);
  const modelDiagram =
    modelCandidate === candidate
      ? diagram
      : parseFlowchartDiagram(modelCandidate);
  const scene = renderIntermediateDiagram(diagram);
  const excalidrawScene = convertSceneToExcalidraw(scene);
  const excalidrawValidation = validateExcalidrawScene(excalidrawScene);
  const checks = [
    ...flowchartChecks(scenario, diagram),
    ...scenarioLogoChecks(
      {
        logos: scenario.logos,
        requiredIconSlugs: scenario.assertions.requiredIconSlugs,
      },
      modelDiagram,
    ),
    {
      id: "excalidraw-scene",
      passed: excalidrawValidation.ok,
      message:
        excalidrawValidation.issues.length === 0
          ? "Excalidraw scene has bound arrows, non-overlapping routes, and fitting text."
          : `${excalidrawValidation.issues.length} Excalidraw validation issue(s).`,
    },
  ];

  return {
    checks,
    diagram,
    excalidrawScene,
    excalidrawValidation,
    ok: checks.every((check) => check.passed),
    scenarioId: scenario.id,
    scene,
  };
}

export function evaluateScenarioOutput(
  scenario: DiagramScenario,
  output: string,
): ScenarioEvaluation {
  return evaluateScenarioDiagram(scenario, extractJsonCandidate(output));
}

export function evaluateScenarioFixture(
  scenario: DiagramScenario,
): ScenarioEvaluation {
  return evaluateScenarioDiagram(scenario, scenario.expectedDiagram);
}
