export interface FlowchartReliabilityAssertions {
  readonly minDistinctCycleCount?: number;
  readonly minCycleDecisionCount: number;
  readonly minDecisionCount: number;
  readonly minEdgeCount: number;
  readonly minEndCount: number;
  readonly minNodeCount: number;
  readonly requiredCyclePaths?: readonly FlowchartRequiredCyclePath[];
  readonly requiredTerminalPaths?: readonly FlowchartRequiredTerminalPath[];
}

export interface FlowchartRequiredCyclePath {
  readonly branchLabels: readonly string[];
  readonly branchSourceNodeLabels: readonly string[];
  readonly cycleNodeLabelGroups: readonly (readonly string[])[];
}

export interface FlowchartRequiredTerminalPath {
  readonly branchLabels: readonly string[];
  readonly branchSourceNodeLabels: readonly string[];
  readonly terminalNodeLabelGroups: readonly (readonly string[])[];
}

export interface MindmapReliabilityAssertions {
  readonly minDepth: number;
  readonly minTopicCount: number;
}

interface ReliabilityScenarioBase {
  readonly description: string;
  readonly id: string;
  readonly prompt: string;
  readonly tags: readonly string[];
  readonly title: string;
}

export interface FlowchartReliabilityScenario extends ReliabilityScenarioBase {
  readonly assertions: FlowchartReliabilityAssertions;
  readonly diagramType: "flowchart";
}

export interface MindmapReliabilityScenario extends ReliabilityScenarioBase {
  readonly assertions: MindmapReliabilityAssertions;
  readonly diagramType: "mindmap";
}

export type GenerationReliabilityScenario =
  | FlowchartReliabilityScenario
  | MindmapReliabilityScenario;

export const generationReliabilityScenarios = [
  {
    id: "reliability-expense-resubmission-loop",
    title: "Expense resubmission loop",
    diagramType: "flowchart",
    description:
      "The verbatim production failure that requires rejection to remain retryable while reimbursement terminates.",
    prompt:
      'Employee expense approval workflow with at least 6 nodes, 7 edges, and 2 decisions: a start node, then a separate expense submission process, manager approval decision, finance audit decision, reimbursement, or rejection with a resubmission loop. Every rejection path must use an edge labeled "rejected" and loop through a resubmission process back to the expense submission process, never to the start node. The successful finance-audit edge must be labeled "approved" and reach a distinct end node labeled "reimbursed".',
    tags: ["reliability", "production-regression", "loop"],
    assertions: {
      minCycleDecisionCount: 1,
      minDecisionCount: 2,
      minEdgeCount: 7,
      minEndCount: 1,
      minNodeCount: 6,
      requiredCyclePaths: [
        {
          branchLabels: ["rejected"],
          branchSourceNodeLabels: [
            "manager approval",
            "manager approved",
            "manager decision",
            "manager review",
            "finance approval",
            "finance approved",
            "finance audit",
            "finance decision",
          ],
          cycleNodeLabelGroups: [
            [
              "expense submission",
              "submit expense",
              "submits expense",
              "expense submitted",
            ],
            ["resubmission", "resubmit"],
          ],
        },
      ],
      requiredTerminalPaths: [
        {
          branchLabels: ["approved"],
          branchSourceNodeLabels: [
            "finance approval",
            "finance approved",
            "finance audit",
            "finance decision",
            "finance review",
          ],
          terminalNodeLabelGroups: [["reimbursement", "reimbursed"]],
        },
      ],
    },
  },
  {
    id: "reliability-ecommerce-return-18-step",
    title: "Ecommerce returns with 18 steps",
    diagramType: "flowchart",
    description:
      "A production-scale return workflow with an explicit minimum step count and a fraud-review loop.",
    prompt:
      "End-to-end e-commerce return and refund process with at least 18 distinct steps: initiation, eligibility check, label generation, carrier pickup, warehouse receipt, inspection, restocking decision, refund method decision, partial refund path, exchange path, fraud review loop, customer notification at each stage, and final closure. The fraud review loop must traverse a distinct manual-review process before returning to the fraud decision.",
    tags: ["reliability", "production-regression", "large", "loop"],
    assertions: {
      minCycleDecisionCount: 1,
      minDecisionCount: 3,
      minEdgeCount: 18,
      minEndCount: 1,
      minNodeCount: 18,
    },
  },
  {
    id: "reliability-manuscript-interacting-loops",
    title: "Manuscript review interacting loops",
    diagramType: "flowchart",
    description:
      "Two interacting review and ethics loops with several distinct terminal outcomes.",
    prompt:
      'Manuscript peer review pipeline with at least 18 distinct steps and two interacting loops: submission, editorial triage decision (desk reject to end, or send to review), three parallel reviewer assignments, reviews-complete decision, revision-requested loop through author revision followed by a separate resubmission process (max two rounds tracked by a rounds-exhausted decision), plagiarism-flag decision that routes to an ethics investigation loop which can rejoin editorial triage or terminate in retraction, acceptance path with copyediting, typesetting, proof approval decision that can loop to typesetting, and final publication; include distinct end states for desk rejection, final rejection, retraction, and publication. The edge labeled "plagiarism flagged" must target the Ethics Investigation process, which must have a path back to Editorial Triage; never put that label on the retraction edge. Label the revision loop branch "revision requested", the desk-rejection branch "desk reject", and the publication branch "accepted".',
    tags: ["reliability", "nested-loops", "multiple-ends"],
    assertions: {
      minCycleDecisionCount: 2,
      minDecisionCount: 4,
      minEdgeCount: 18,
      minEndCount: 3,
      minNodeCount: 15,
      minDistinctCycleCount: 2,
      requiredCyclePaths: [
        {
          branchLabels: ["revision requested"],
          branchSourceNodeLabels: [
            "reviews complete",
            "review complete",
            "review decision",
            "revision needed",
            "revision decision",
            "revision requested",
          ],
          cycleNodeLabelGroups: [
            ["author revision", "revise manuscript", "author revises"],
            ["resubmission", "resubmit"],
          ],
        },
        {
          branchLabels: ["plagiarism flagged"],
          branchSourceNodeLabels: ["plagiarism flag", "plagiarism detected"],
          cycleNodeLabelGroups: [
            ["ethics investigation", "ethics review"],
            ["editorial triage", "editor triage"],
          ],
        },
      ],
      requiredTerminalPaths: [
        {
          branchLabels: ["desk reject"],
          branchSourceNodeLabels: [
            "editorial triage",
            "editor triage",
            "triage decision",
            "desk reject",
          ],
          terminalNodeLabelGroups: [["desk rejection", "desk reject"]],
        },
        {
          branchLabels: ["accepted"],
          branchSourceNodeLabels: [
            "editorial triage",
            "editor triage",
            "accepted",
            "acceptance decision",
            "final decision",
            "editorial decision",
            "manuscript decision",
            "accept manuscript",
          ],
          terminalNodeLabelGroups: [["publication", "published"]],
        },
      ],
    },
  },
  {
    id: "reliability-release-train-brutal",
    title: "Global release train",
    diagramType: "flowchart",
    description:
      "A near-limit flowchart with two recovery loops, five decisions, and independent stop states.",
    prompt:
      "Create a 22 to 24 node global software release train flowchart. Include intake, scope review, dependency analysis, build, unit tests, integration tests, security scan, change approval, canary deployment, regional rollout, observability checks, customer communication, and closure. Use at least five labeled decision nodes. Failed tests loop through remediation and rebuild; an unhealthy canary loops through rollback, incident review, and a new canary. Include separate end states for cancelled change, security rejection, rollback without retry, and successful release.",
    tags: ["reliability", "brutal", "near-limit", "nested-loops"],
    assertions: {
      minCycleDecisionCount: 2,
      minDecisionCount: 5,
      minEdgeCount: 24,
      minEndCount: 3,
      minNodeCount: 22,
    },
  },
  {
    id: "reliability-curriculum-depth-four",
    title: "Software engineering curriculum",
    diagramType: "mindmap",
    description:
      "The production truncation regression with 25 topics distributed across four hierarchy levels.",
    prompt:
      "Complete software engineering curriculum with at least 25 topics across 4 levels: fundamentals, languages, systems, and practices, each broken into concrete subtopics and sub-subtopics",
    tags: ["reliability", "production-regression", "large", "deep"],
    assertions: { minDepth: 3, minTopicCount: 25 },
  },
  {
    id: "reliability-immune-system-brutal",
    title: "Human immune system",
    diagramType: "mindmap",
    description:
      "A dense long-label hierarchy well beyond ordinary generation complexity.",
    prompt:
      "Exhaustive map of the human immune system with at least 35 topics and four levels of depth: innate branch (physical barriers, cellular components with neutrophils, macrophages, dendritic cells, NK cells, and their activation mechanisms), adaptive branch (humoral with B cell development, antibody classes and functions; cell-mediated with T cell subsets, MHC restriction, memory formation), complement system pathways, cytokine signaling families, and clinical topics covering hypersensitivity types, immunodeficiencies, and vaccines",
    tags: ["reliability", "brutal", "large", "deep", "long-labels"],
    assertions: { minDepth: 3, minTopicCount: 35 },
  },
  {
    id: "reliability-wedding-richness",
    title: "Wedding planning richness",
    diagramType: "mindmap",
    description: "The verbatim sparse-output production regression.",
    prompt: "Planning a wedding",
    tags: ["reliability", "production-regression", "sparse-guard"],
    assertions: { minDepth: 2, minTopicCount: 10 },
  },
  {
    id: "reliability-kubernetes-depth",
    title: "Kubernetes depth",
    diagramType: "mindmap",
    description:
      "The production depth regression with a hard three-level minimum.",
    prompt:
      "Kubernetes architecture, workloads, networking, storage, security, and operations with at least 18 topics across four hierarchy levels total: root, category, subtopic, and concrete detail (maximum depth at least 3)",
    tags: ["reliability", "production-regression", "depth"],
    assertions: { minDepth: 3, minTopicCount: 18 },
  },
] as const satisfies readonly GenerationReliabilityScenario[];

export function getGenerationReliabilityScenario(
  id: string,
): GenerationReliabilityScenario {
  const scenario = generationReliabilityScenarios.find(
    (candidate) => candidate.id === id,
  );
  if (!scenario) throw new Error(`Unknown reliability scenario "${id}".`);
  return scenario;
}
