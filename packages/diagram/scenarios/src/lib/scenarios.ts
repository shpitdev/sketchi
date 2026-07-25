import {
  type FlowchartDiagram,
  type FlowchartNodeKind,
  SKETCHI_DIAGRAM_STYLE,
  parseFlowchartDiagram,
} from "@sketchi/diagram-core";

export interface FlowchartScenarioAssertions {
  minEdgeCount: number;
  minNodeCount: number;
  requiredBranchLabels: string[];
  requiredEdges: FlowchartScenarioRequiredEdge[];
  requiredNodeKinds: FlowchartNodeKind[];
  requiredNodeLabels: string[];
}

export interface FlowchartScenarioRequiredEdge {
  label?: string;
  sourceLabel: string;
  targetLabel: string;
}

export type DiagramScenarioDifficulty = "smoke" | "standard" | "challenge";

export interface DiagramScenario {
  assertions: FlowchartScenarioAssertions;
  description: string;
  diagramType: "flowchart";
  difficulty: DiagramScenarioDifficulty;
  expectedDiagram: FlowchartDiagram;
  id: string;
  prompt: string;
  tags: string[];
  title: string;
}

type FlowchartNodeDefinition = readonly [
  id: string,
  label: string,
  kind: FlowchartNodeKind,
];

type FlowchartEdgeDefinition = readonly [
  id: string,
  source: string,
  target: string,
  label?: string,
];

interface FlowchartScenarioDefinition {
  description: string;
  diagramId?: string;
  difficulty: DiagramScenarioDifficulty;
  edges: readonly FlowchartEdgeDefinition[];
  id: string;
  nodes: readonly FlowchartNodeDefinition[];
  prompt: string;
  tags: readonly string[];
  title: string;
}

const DEFAULT_STYLE = SKETCHI_DIAGRAM_STYLE;
const FLOWCHART_NODE_KIND_ORDER: readonly FlowchartNodeKind[] = [
  "start",
  "process",
  "decision",
  "end",
];

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim().toLowerCase();

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(value);
    }
  }

  return result;
}

function buildExpectedDiagram(
  definition: FlowchartScenarioDefinition,
): FlowchartDiagram {
  return parseFlowchartDiagram({
    id: definition.diagramId ?? definition.id,
    title: definition.title,
    type: "flowchart",
    nodes: definition.nodes.map(([id, label, kind]) => ({ id, label, kind })),
    edges: definition.edges.map(([id, source, target, label]) => ({
      id,
      source,
      target,
      ...(label ? { label } : {}),
    })),
    layout: {
      direction: "TB",
      edgeRouting: "orthogonal",
    },
    style: DEFAULT_STYLE,
  });
}

function buildAssertions(
  diagram: FlowchartDiagram,
): FlowchartScenarioAssertions {
  const nodeKinds = new Set(diagram.nodes.map((node) => node.kind));
  const requiredNodeKinds = FLOWCHART_NODE_KIND_ORDER.filter((kind) =>
    nodeKinds.has(kind),
  );
  const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]));

  return {
    minEdgeCount: diagram.edges.length,
    minNodeCount: diagram.nodes.length,
    requiredBranchLabels: unique(
      diagram.edges
        .map((edge) => edge.label)
        .filter((label): label is string => Boolean(label)),
    ),
    requiredEdges: diagram.edges.map((edge) => {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);

      if (!source || !target) {
        throw new Error(
          `Scenario "${diagram.id}" has unresolved assertion edge "${edge.id}".`,
        );
      }

      return {
        sourceLabel: source.label,
        targetLabel: target.label,
        ...(edge.label ? { label: edge.label } : {}),
      };
    }),
    requiredNodeKinds,
    requiredNodeLabels: diagram.nodes.map((node) => node.label),
  };
}

function defineFlowchartScenario(
  definition: FlowchartScenarioDefinition,
): DiagramScenario {
  const expectedDiagram = buildExpectedDiagram(definition);

  return {
    assertions: buildAssertions(expectedDiagram),
    description: definition.description,
    diagramType: "flowchart",
    difficulty: definition.difficulty,
    expectedDiagram,
    id: definition.id,
    prompt: definition.prompt,
    tags: [...definition.tags],
    title: definition.title,
  };
}

const flowchartScenarioDefinitions = [
  {
    id: "sketchi-onboarding-decision-flow",
    diagramId: "onboarding-flow",
    title: "Sketchi onboarding decision flow",
    difficulty: "smoke",
    tags: ["baseline", "decision", "two-branch"],
    description:
      "A compact decision flow that exercises start/process/decision/end semantics and yes/no branch labels.",
    prompt:
      "Create a flowchart for a Sketchi diagram request. The flow starts when a prompt is received, extracts requirements, asks whether the scope is clear, drafts typed IR when clear, and otherwise moves to review. End at review.",
    nodes: [
      ["prompt", "Prompt received", "start"],
      ["requirements", "Extract requirements", "process"],
      ["clear", "Scope clear?", "decision"],
      ["draft", "Draft typed IR", "process"],
      ["review", "Review diagram", "end"],
    ],
    edges: [
      ["prompt-requirements", "prompt", "requirements"],
      ["requirements-clear", "requirements", "clear"],
      ["clear-draft", "clear", "draft", "yes"],
      ["clear-review", "clear", "review", "no"],
      ["draft-review", "draft", "review"],
    ],
  },
  {
    id: "pharma-batch-disposition",
    title: "Pharma batch disposition",
    difficulty: "challenge",
    tags: ["regulated", "multi-branch", "loop"],
    description:
      "A decision-heavy regulated workflow with multi-way branches and a loop back into final review.",
    prompt:
      "Create a flowchart for pharma batch disposition. A batch is received, QA reviews the Certificate of Analysis, and then decides whether it passes specs. Passing goes to QA Manager final review and packaging. Retest goes through investigation and returns to final review. Reject ends at reject batch.",
    nodes: [
      ["batch-received", "Batch received", "start"],
      ["qa-review", "QA reviews Certificate of Analysis", "process"],
      ["passes-specs", "Passes specs?", "decision"],
      ["final-review", "QA Manager final review", "process"],
      ["packaging", "Send to packaging", "end"],
      ["investigate", "Investigate retesting", "process"],
      ["reject", "Reject batch", "end"],
    ],
    edges: [
      ["batch-qa", "batch-received", "qa-review"],
      ["qa-specs", "qa-review", "passes-specs"],
      ["specs-pass", "passes-specs", "final-review", "yes"],
      ["specs-investigate", "passes-specs", "investigate", "retest"],
      ["specs-reject", "passes-specs", "reject", "reject"],
      ["review-packaging", "final-review", "packaging"],
      ["investigate-review", "investigate", "final-review"],
    ],
  },
  {
    id: "repo-package-interaction-flow",
    title: "Repo package interaction flow",
    difficulty: "standard",
    tags: ["repo", "packages", "harness", "code-mode", "vague-prompt"],
    description:
      "A vague package-interaction request recast as a directed flowchart so harnesses preserve concrete package boundaries instead of inventing a Mermaid dependency report.",
    prompt:
      "Create a diagram that showcases how the various packages in this repo interact. Show the high-level path from an app request through the agent, core diagram model, renderer, Excalidraw export, and hosted artifact response.",
    nodes: [
      ["app-request", "App or MCP request", "start"],
      ["diagram-agent", "diagram-agent orchestrates", "process"],
      ["diagram-core", "diagram-core validates IR", "process"],
      ["diagram-renderer", "diagram-renderer lays out scene", "process"],
      ["diagram-excalidraw", "diagram-excalidraw exports file", "process"],
      ["artifact-store", "Artifact store saves formats", "process"],
      ["studio-api", "Studio API returns artifact URLs", "end"],
    ],
    edges: [
      ["request-agent", "app-request", "diagram-agent"],
      ["agent-core", "diagram-agent", "diagram-core"],
      ["core-renderer", "diagram-core", "diagram-renderer"],
      ["renderer-excalidraw", "diagram-renderer", "diagram-excalidraw"],
      ["excalidraw-store", "diagram-excalidraw", "artifact-store"],
      ["store-api", "artifact-store", "studio-api"],
    ],
  },
  {
    id: "support-ticket-triage",
    title: "Support ticket triage",
    difficulty: "standard",
    tags: ["support", "escalation", "nested-decision"],
    description:
      "Routes incoming support tickets through outage detection, known-fix handling, and engineering escalation.",
    prompt:
      "Create a support ticket triage flowchart. A ticket is received, the team classifies it, decides if it is a production outage, and pages on-call for outages. Paged outages end when the outage is resolved. Non-outages check whether a known fix exists. Known fixes are sent to the customer and end as customer resolved. Unknown fixes escalate to engineering and end as engineering resolved.",
    nodes: [
      ["ticket-received", "Ticket received", "start"],
      ["classify-ticket", "Classify ticket", "process"],
      ["production-outage", "Production outage?", "decision"],
      ["page-on-call", "Page on-call", "process"],
      ["known-fix", "Known fix exists?", "decision"],
      ["send-fix", "Send fix to customer", "process"],
      ["outage-resolved", "Outage resolved", "end"],
      ["escalate-engineering", "Escalate to engineering", "process"],
      ["customer-resolved", "Customer resolved", "end"],
      ["engineering-resolved", "Engineering resolved", "end"],
    ],
    edges: [
      ["ticket-classify", "ticket-received", "classify-ticket"],
      ["classify-outage", "classify-ticket", "production-outage"],
      ["outage-page", "production-outage", "page-on-call", "yes"],
      ["outage-known-fix", "production-outage", "known-fix", "no"],
      ["page-resolved", "page-on-call", "outage-resolved"],
      ["known-send", "known-fix", "send-fix", "yes"],
      ["known-escalate", "known-fix", "escalate-engineering", "no"],
      ["send-resolved", "send-fix", "customer-resolved"],
      ["escalate-resolved", "escalate-engineering", "engineering-resolved"],
    ],
  },
  {
    id: "ecommerce-return-authorization",
    title: "Ecommerce return authorization",
    difficulty: "standard",
    tags: ["commerce", "authorization", "inspection"],
    description:
      "Exercises eligibility checks, item inspection, and separate refund/rejection endings.",
    prompt:
      "Create a return authorization flowchart for an ecommerce order. A return request starts the flow, the system verifies the return window, and decides if the return is eligible. Eligible returns get a return label and item inspection. Inspection decides whether the item condition is acceptable. Acceptable items are refunded. Ineligible or unacceptable returns end as rejected returns.",
    nodes: [
      ["return-request", "Return request received", "start"],
      ["verify-window", "Verify return window", "process"],
      ["eligible", "Return eligible?", "decision"],
      ["issue-label", "Issue return label", "process"],
      ["inspect-item", "Inspect returned item", "process"],
      ["condition-ok", "Condition acceptable?", "decision"],
      ["refund", "Refund customer", "end"],
      ["reject-return", "Reject return", "end"],
    ],
    edges: [
      ["request-window", "return-request", "verify-window"],
      ["window-eligible", "verify-window", "eligible"],
      ["eligible-label", "eligible", "issue-label", "yes"],
      ["eligible-reject", "eligible", "reject-return", "no"],
      ["label-inspect", "issue-label", "inspect-item"],
      ["inspect-condition", "inspect-item", "condition-ok"],
      ["condition-refund", "condition-ok", "refund", "yes"],
      ["condition-reject", "condition-ok", "reject-return", "no"],
    ],
  },
  {
    id: "incident-escalation",
    title: "Incident escalation",
    difficulty: "challenge",
    tags: ["incident", "severity", "escalation"],
    description:
      "A severity routing flow with direct resolution, triage, and incident bridge paths.",
    prompt:
      "Create an incident escalation flowchart. Monitoring creates an alert and the responder acknowledges it. A severity decision sends high severity incidents to an incident bridge, medium severity incidents to a triage queue, and low severity incidents to monitoring. The bridge mitigates impact, sends customer communications, and resolves the incident. Triage checks whether there is a fix. If yes, resolve the incident. If no, escalate to the incident bridge. Monitoring low severity incidents ends as resolved.",
    nodes: [
      ["alert-created", "Alert created", "start"],
      ["acknowledge", "Responder acknowledges", "process"],
      ["severity", "Severity?", "decision"],
      ["incident-bridge", "Open incident bridge", "process"],
      ["mitigate", "Mitigate impact", "process"],
      ["customer-comms", "Send customer comms", "process"],
      ["triage-queue", "Triage queue", "process"],
      ["fix-found", "Fix available?", "decision"],
      ["monitor", "Monitor low severity", "process"],
      ["resolved", "Incident resolved", "end"],
    ],
    edges: [
      ["alert-ack", "alert-created", "acknowledge"],
      ["ack-severity", "acknowledge", "severity"],
      ["severity-high", "severity", "incident-bridge", "high"],
      ["severity-medium", "severity", "triage-queue", "medium"],
      ["severity-low", "severity", "monitor", "low"],
      ["bridge-mitigate", "incident-bridge", "mitigate"],
      ["mitigate-comms", "mitigate", "customer-comms"],
      ["comms-resolved", "customer-comms", "resolved"],
      ["triage-fix", "triage-queue", "fix-found"],
      ["fix-resolved", "fix-found", "resolved", "yes"],
      ["fix-bridge", "fix-found", "incident-bridge", "no"],
      ["monitor-resolved", "monitor", "resolved"],
    ],
  },
  {
    id: "incident-response-code-mode-proof",
    title: "Incident response Code Mode proof",
    difficulty: "challenge",
    tags: ["incident", "code-mode", "dense-routing", "fan-in", "loop"],
    description:
      "Recovered from the Claude Code Mode browser-run proof: a dense incident flow with multi-way decisions, fan-out, fan-in into stability checks, and an escalation loop.",
    prompt:
      "Create an incident response escalation flow. An alert is received, triaged, and checked for whether it is a real incident. False alarms close. Real incidents are declared, stakeholders are notified, logs and deploy evidence are collected, then root cause is classified as deploy, code, or provider. Deploy issues roll back, code issues prepare a hotfix, and provider issues escalate to the provider. Rollback and hotfix paths both check whether the service is stable. Stable service goes to monitoring and then resolved. Unstable service escalates and loops back to collect fresh evidence.",
    nodes: [
      ["alert", "Alert received", "start"],
      ["triage", "Triage signal", "process"],
      ["confirmed", "Real incident?", "decision"],
      ["false-alarm", "Close as false alarm", "end"],
      ["declare", "Declare incident", "process"],
      ["notify", "Notify stakeholders", "process"],
      ["collect-evidence", "Collect logs and deploy evidence", "process"],
      ["root-cause", "Root cause known?", "decision"],
      ["rollback", "Rollback release", "process"],
      ["hotfix", "Prepare hotfix", "process"],
      ["vendor-escalation", "Escalate to provider", "end"],
      ["stable", "Service stable?", "decision"],
      ["monitor", "Monitor recovery", "process"],
      ["resolved-success", "Resolved", "end"],
      ["escalate-failure", "Escalate", "process"],
    ],
    edges: [
      ["alert-triage", "alert", "triage"],
      ["triage-confirmed", "triage", "confirmed"],
      ["confirmed-false-alarm", "confirmed", "false-alarm", "no"],
      ["confirmed-declare", "confirmed", "declare", "yes"],
      ["declare-notify", "declare", "notify"],
      ["notify-evidence", "notify", "collect-evidence"],
      ["evidence-root-cause", "collect-evidence", "root-cause"],
      ["root-cause-rollback", "root-cause", "rollback", "deploy"],
      ["root-cause-hotfix", "root-cause", "hotfix", "code"],
      ["root-cause-vendor", "root-cause", "vendor-escalation", "provider"],
      ["rollback-stable", "rollback", "stable"],
      ["hotfix-stable", "hotfix", "stable"],
      ["stable-monitor", "stable", "monitor", "yes"],
      ["stable-escalate", "stable", "escalate-failure", "no"],
      ["monitor-resolved", "monitor", "resolved-success"],
      [
        "escalate-recollect",
        "escalate-failure",
        "collect-evidence",
        "reassess",
      ],
    ],
  },
  {
    id: "invoice-approval",
    title: "Invoice approval",
    difficulty: "challenge",
    tags: ["finance", "approval", "exception"],
    description:
      "A finance approval process with PO matching, exception resolution, and threshold approval.",
    prompt:
      "Create an invoice approval flowchart. An invoice is received and matched to a purchase order. If it does not match, route it to exception review and decide whether the exception is resolved. Unresolved exceptions reject the invoice. Resolved or matched invoices decide whether the amount is over the approval threshold. Amounts over threshold require director approval before payment. Amounts under threshold schedule payment directly.",
    nodes: [
      ["invoice-received", "Invoice received", "start"],
      ["match-po", "Match purchase order", "process"],
      ["po-matches", "PO matches?", "decision"],
      ["exception-review", "Exception review", "process"],
      ["exception-resolved", "Exception resolved?", "decision"],
      ["threshold", "Amount over threshold?", "decision"],
      ["director-approval", "Director approval", "process"],
      ["schedule-payment", "Schedule payment", "end"],
      ["reject-invoice", "Reject invoice", "end"],
    ],
    edges: [
      ["invoice-match", "invoice-received", "match-po"],
      ["match-decision", "match-po", "po-matches"],
      ["po-threshold", "po-matches", "threshold", "yes"],
      ["po-exception", "po-matches", "exception-review", "no"],
      ["exception-decision", "exception-review", "exception-resolved"],
      ["exception-threshold", "exception-resolved", "threshold", "yes"],
      ["exception-reject", "exception-resolved", "reject-invoice", "no"],
      ["threshold-director", "threshold", "director-approval", "yes"],
      ["threshold-payment", "threshold", "schedule-payment", "no"],
      ["director-payment", "director-approval", "schedule-payment"],
    ],
  },
  {
    id: "feature-flag-rollout",
    title: "Feature flag rollout",
    difficulty: "standard",
    tags: ["release", "progressive-delivery", "rollback"],
    description:
      "A progressive delivery flow with internal, beta, ramp, and rollback branches.",
    prompt:
      "Create a feature flag rollout flowchart. A flag is ready, then enabled internally. If internal checks are healthy, enable the beta cohort. If internal checks fail, roll back the feature. Beta also checks health. Healthy beta results ramp to all users and completes rollout. Unhealthy beta rolls back the feature.",
    nodes: [
      ["flag-ready", "Flag ready", "start"],
      ["enable-internal", "Enable internal users", "process"],
      ["internal-healthy", "Internal healthy?", "decision"],
      ["enable-beta", "Enable beta cohort", "process"],
      ["beta-healthy", "Beta healthy?", "decision"],
      ["ramp-all", "Ramp to all users", "process"],
      ["complete", "Rollout complete", "end"],
      ["rollback", "Rollback feature", "end"],
    ],
    edges: [
      ["ready-internal", "flag-ready", "enable-internal"],
      ["internal-check", "enable-internal", "internal-healthy"],
      ["internal-beta", "internal-healthy", "enable-beta", "yes"],
      ["internal-rollback", "internal-healthy", "rollback", "no"],
      ["beta-check", "enable-beta", "beta-healthy"],
      ["beta-ramp", "beta-healthy", "ramp-all", "yes"],
      ["beta-rollback", "beta-healthy", "rollback", "no"],
      ["ramp-complete", "ramp-all", "complete"],
    ],
  },
  {
    id: "patient-intake-scheduling",
    title: "Patient intake scheduling",
    difficulty: "standard",
    tags: ["healthcare", "triage", "scheduling"],
    description:
      "A scheduling flow that separates urgent symptoms, insurance checks, and billing referral.",
    prompt:
      "Create a patient intake scheduling flowchart. A patient requests an appointment, the clinic collects intake information, and asks whether there are urgent symptoms. Urgent symptoms go to nurse triage and then a same-day appointment. Non-urgent requests check whether insurance is valid. Valid insurance schedules a routine appointment. Invalid insurance asks if the patient accepts self-pay. Self-pay schedules routine care; otherwise refer to billing.",
    nodes: [
      ["patient-request", "Patient requests appointment", "start"],
      ["collect-info", "Collect intake information", "process"],
      ["urgent", "Urgent symptoms?", "decision"],
      ["nurse-triage", "Nurse triage", "process"],
      ["same-day", "Same-day appointment", "end"],
      ["insurance-valid", "Insurance valid?", "decision"],
      ["self-pay", "Accepts self-pay?", "decision"],
      ["routine", "Schedule routine appointment", "end"],
      ["billing", "Refer to billing", "end"],
    ],
    edges: [
      ["request-info", "patient-request", "collect-info"],
      ["info-urgent", "collect-info", "urgent"],
      ["urgent-triage", "urgent", "nurse-triage", "yes"],
      ["urgent-insurance", "urgent", "insurance-valid", "no"],
      ["triage-same-day", "nurse-triage", "same-day"],
      ["insurance-routine", "insurance-valid", "routine", "yes"],
      ["insurance-self-pay", "insurance-valid", "self-pay", "no"],
      ["self-pay-routine", "self-pay", "routine", "yes"],
      ["self-pay-billing", "self-pay", "billing", "no"],
    ],
  },
  {
    id: "content-moderation",
    title: "Content moderation",
    difficulty: "challenge",
    tags: ["trust-safety", "moderation", "multi-end"],
    description:
      "A trust and safety flow with severe harm, policy violation, human review, and restore paths.",
    prompt:
      "Create a content moderation flowchart. A report is received and an automated scan runs. If severe harm is detected, remove the content and escalate to safety. If not severe, decide whether there is a policy violation. No violation restores content. Violations go to human review, then decide whether action is needed. Needed action limits content; otherwise restore content.",
    nodes: [
      ["report-received", "Report received", "start"],
      ["automated-scan", "Automated scan", "process"],
      ["severe-harm", "Severe harm?", "decision"],
      ["remove-content", "Remove content", "process"],
      ["safety-escalation", "Safety escalation", "end"],
      ["policy-violation", "Policy violation?", "decision"],
      ["human-review", "Human review", "process"],
      ["action-needed", "Action needed?", "decision"],
      ["limit-content", "Limit content", "end"],
      ["restore-content", "Restore content", "end"],
    ],
    edges: [
      ["report-scan", "report-received", "automated-scan"],
      ["scan-severe", "automated-scan", "severe-harm"],
      ["severe-remove", "severe-harm", "remove-content", "yes"],
      ["severe-policy", "severe-harm", "policy-violation", "no"],
      ["remove-escalate", "remove-content", "safety-escalation"],
      ["policy-review", "policy-violation", "human-review", "yes"],
      ["policy-restore", "policy-violation", "restore-content", "no"],
      ["review-action", "human-review", "action-needed"],
      ["action-limit", "action-needed", "limit-content", "yes"],
      ["action-restore", "action-needed", "restore-content", "no"],
    ],
  },
  {
    id: "data-import-validation",
    title: "Data import validation",
    difficulty: "standard",
    tags: ["data", "validation", "dedupe"],
    description:
      "A data import pipeline with parse, schema, duplicate handling, and rejection branches.",
    prompt:
      "Create a data import validation flowchart. A file is uploaded and parsed. If parsing fails, reject the file. If parsing succeeds, validate the schema. Invalid schema returns mapping errors. Valid schema deduplicates records. If duplicates are found, merge duplicates before importing. If not, import records directly.",
    nodes: [
      ["file-uploaded", "File uploaded", "start"],
      ["parse-file", "Parse file", "process"],
      ["parse-success", "Parse successful?", "decision"],
      ["validate-schema", "Validate schema", "process"],
      ["schema-valid", "Schema valid?", "decision"],
      ["deduplicate", "Deduplicate records", "process"],
      ["duplicates-found", "Duplicates found?", "decision"],
      ["merge-duplicates", "Merge duplicates", "process"],
      ["import-records", "Import records", "end"],
      ["reject-file", "Reject file", "end"],
      ["mapping-errors", "Return mapping errors", "end"],
    ],
    edges: [
      ["upload-parse", "file-uploaded", "parse-file"],
      ["parse-decision", "parse-file", "parse-success"],
      ["parse-schema", "parse-success", "validate-schema", "yes"],
      ["parse-reject", "parse-success", "reject-file", "no"],
      ["schema-decision", "validate-schema", "schema-valid"],
      ["schema-dedupe", "schema-valid", "deduplicate", "yes"],
      ["schema-errors", "schema-valid", "mapping-errors", "no"],
      ["dedupe-duplicates", "deduplicate", "duplicates-found"],
      ["duplicates-merge", "duplicates-found", "merge-duplicates", "yes"],
      ["duplicates-import", "duplicates-found", "import-records", "no"],
      ["merge-import", "merge-duplicates", "import-records"],
    ],
  },
  {
    id: "password-reset-security",
    title: "Password reset security",
    difficulty: "standard",
    tags: ["auth", "security", "risk-check"],
    description:
      "A security-sensitive reset flow with generic responses, token expiry, and step-up verification.",
    prompt:
      "Create a password reset security flowchart. A reset is requested. If the account does not exist, show a generic response. If it exists, send the reset email and wait for the link click. If the link is not clicked, expire the token. If clicked, run a risk check. High risk requires step-up verification before resetting the password. Low risk resets the password directly.",
    nodes: [
      ["reset-requested", "Reset requested", "start"],
      ["account-exists", "Account exists?", "decision"],
      ["generic-response", "Show generic response", "end"],
      ["send-email", "Send reset email", "process"],
      ["link-clicked", "Link clicked?", "decision"],
      ["expire-token", "Expire token", "end"],
      ["risk-check", "Run risk check", "process"],
      ["risk-high", "Risk high?", "decision"],
      ["step-up", "Step-up verification", "process"],
      ["reset-password", "Reset password", "end"],
    ],
    edges: [
      ["request-account", "reset-requested", "account-exists"],
      ["account-email", "account-exists", "send-email", "yes"],
      ["account-generic", "account-exists", "generic-response", "no"],
      ["email-link", "send-email", "link-clicked"],
      ["link-risk", "link-clicked", "risk-check", "yes"],
      ["link-expire", "link-clicked", "expire-token", "no"],
      ["risk-decision", "risk-check", "risk-high"],
      ["risk-step-up", "risk-high", "step-up", "yes"],
      ["risk-reset", "risk-high", "reset-password", "no"],
      ["step-up-reset", "step-up", "reset-password"],
    ],
  },
  {
    id: "warehouse-reorder",
    title: "Warehouse reorder",
    difficulty: "standard",
    tags: ["operations", "inventory", "procurement"],
    description:
      "An inventory reorder flow with supplier fallback and monitor/no-op branch.",
    prompt:
      "Create a warehouse reorder flowchart. A stock count is updated, then the system decides whether inventory is below the reorder point. If not, monitor stock. If yes, check supplier availability. Available suppliers create a purchase order and await delivery. Unavailable suppliers use a substitute supplier before creating the purchase order.",
    nodes: [
      ["stock-updated", "Stock count updated", "start"],
      ["below-reorder", "Below reorder point?", "decision"],
      ["monitor-stock", "Monitor stock", "end"],
      ["check-supplier", "Check supplier availability", "process"],
      ["supplier-available", "Supplier available?", "decision"],
      ["substitute-supplier", "Use substitute supplier", "process"],
      ["purchase-order", "Create purchase order", "process"],
      ["await-delivery", "Await delivery", "end"],
    ],
    edges: [
      ["stock-below", "stock-updated", "below-reorder"],
      ["below-check", "below-reorder", "check-supplier", "yes"],
      ["below-monitor", "below-reorder", "monitor-stock", "no"],
      ["check-available", "check-supplier", "supplier-available"],
      ["available-po", "supplier-available", "purchase-order", "yes"],
      [
        "available-substitute",
        "supplier-available",
        "substitute-supplier",
        "no",
      ],
      ["substitute-po", "substitute-supplier", "purchase-order"],
      ["po-delivery", "purchase-order", "await-delivery"],
    ],
  },
  {
    id: "loan-application-underwriting",
    title: "Loan application underwriting",
    difficulty: "challenge",
    tags: ["finance", "underwriting", "exception"],
    description:
      "A loan application flow with identity verification, credit review, manual underwriting, and exception approval.",
    prompt:
      "Create a loan application underwriting flowchart. An application is submitted and identity is verified. Failed identity verification declines the application. Verified identity goes to credit review. Acceptable credit moves to income verification. Unacceptable credit goes to manual underwriting, where an exception approval decision either continues to income verification or declines. Income verification approves the loan.",
    nodes: [
      ["application-submitted", "Application submitted", "start"],
      ["verify-identity", "Verify identity", "process"],
      ["identity-verified", "Identity verified?", "decision"],
      ["credit-review", "Credit review", "process"],
      ["credit-acceptable", "Credit acceptable?", "decision"],
      ["manual-underwrite", "Manual underwriting", "process"],
      ["exception-approved", "Exception approved?", "decision"],
      ["income-verification", "Income verification", "process"],
      ["approve-loan", "Approve loan", "end"],
      ["decline-application", "Decline application", "end"],
    ],
    edges: [
      ["application-identity", "application-submitted", "verify-identity"],
      ["identity-decision", "verify-identity", "identity-verified"],
      ["identity-credit", "identity-verified", "credit-review", "yes"],
      ["identity-decline", "identity-verified", "decline-application", "no"],
      ["credit-decision", "credit-review", "credit-acceptable"],
      ["credit-income", "credit-acceptable", "income-verification", "yes"],
      ["credit-manual", "credit-acceptable", "manual-underwrite", "no"],
      ["manual-exception", "manual-underwrite", "exception-approved"],
      ["exception-income", "exception-approved", "income-verification", "yes"],
      ["exception-decline", "exception-approved", "decline-application", "no"],
      ["income-approve", "income-verification", "approve-loan"],
    ],
  },
  {
    id: "customer-offboarding-retention",
    title: "Customer offboarding retention",
    difficulty: "standard",
    tags: ["customer-success", "retention", "cancellation"],
    description:
      "A cancellation flow with retention eligibility, offer acceptance, and account closure.",
    prompt:
      "Create a customer offboarding retention flowchart. A customer requests cancellation and the team collects a cancellation reason. If the customer is eligible for a save offer, present the offer and decide whether it is accepted. Accepted offers retain the customer. Declined offers confirm cancellation and close the account. If the customer is not eligible for a save offer, confirm cancellation directly and close the account.",
    nodes: [
      ["cancel-request", "Cancellation requested", "start"],
      ["collect-reason", "Collect cancellation reason", "process"],
      ["save-eligible", "Save offer eligible?", "decision"],
      ["present-offer", "Present save offer", "process"],
      ["offer-accepted", "Offer accepted?", "decision"],
      ["retain-customer", "Retain customer", "end"],
      ["confirm-cancel", "Confirm cancellation", "process"],
      ["close-account", "Close account", "end"],
    ],
    edges: [
      ["cancel-reason", "cancel-request", "collect-reason"],
      ["reason-eligible", "collect-reason", "save-eligible"],
      ["eligible-offer", "save-eligible", "present-offer", "yes"],
      ["eligible-confirm", "save-eligible", "confirm-cancel", "no"],
      ["offer-decision", "present-offer", "offer-accepted"],
      ["accepted-retain", "offer-accepted", "retain-customer", "yes"],
      ["accepted-confirm", "offer-accepted", "confirm-cancel", "no"],
      ["confirm-close", "confirm-cancel", "close-account"],
    ],
  },
  {
    id: "bug-report-routing",
    title: "Bug report routing",
    difficulty: "challenge",
    tags: ["engineering", "triage", "security"],
    description:
      "An engineering triage flow with reproducibility, security impact, priority routing, and release outcomes.",
    prompt:
      "Create a bug report routing flowchart. A bug is filed and the team tries to reproduce it. If it cannot be reproduced, request more details. If reproduced, decide whether it has security impact. Security issues go to security triage, then a hotfix branch, then release fix. Non-security issues decide whether priority is high. High priority goes to the sprint backlog and releases a fix. Low priority goes to the regular backlog.",
    nodes: [
      ["bug-filed", "Bug filed", "start"],
      ["reproduce", "Reproduce issue", "process"],
      ["reproduced", "Reproduced?", "decision"],
      ["request-details", "Request more details", "end"],
      ["security-impact", "Security impact?", "decision"],
      ["security-triage", "Security triage", "process"],
      ["hotfix-branch", "Hotfix branch", "process"],
      ["priority-high", "Priority high?", "decision"],
      ["sprint-backlog", "Sprint backlog", "process"],
      ["regular-backlog", "Regular backlog", "end"],
      ["release-fix", "Release fix", "end"],
    ],
    edges: [
      ["bug-reproduce", "bug-filed", "reproduce"],
      ["reproduce-decision", "reproduce", "reproduced"],
      ["reproduced-security", "reproduced", "security-impact", "yes"],
      ["reproduced-details", "reproduced", "request-details", "no"],
      ["security-triage-edge", "security-impact", "security-triage", "yes"],
      ["security-priority", "security-impact", "priority-high", "no"],
      ["triage-hotfix", "security-triage", "hotfix-branch"],
      ["hotfix-release", "hotfix-branch", "release-fix"],
      ["priority-sprint", "priority-high", "sprint-backlog", "yes"],
      ["priority-regular", "priority-high", "regular-backlog", "no"],
      ["sprint-release", "sprint-backlog", "release-fix"],
    ],
  },
  {
    id: "expense-reimbursement",
    title: "Expense reimbursement",
    difficulty: "standard",
    tags: ["finance", "policy", "approval"],
    description:
      "An expense reimbursement flow with missing receipt, policy exception, and approval outcomes.",
    prompt:
      "Create an expense reimbursement flowchart. An expense is submitted. If the receipt is missing, request a receipt. If attached, run a policy check. Expenses within policy go to manager approval and then payment. Out-of-policy expenses go to finance exception review. Approved exceptions go to manager approval; rejected exceptions reject the expense.",
    nodes: [
      ["expense-submitted", "Expense submitted", "start"],
      ["receipt-attached", "Receipt attached?", "decision"],
      ["request-receipt", "Request receipt", "end"],
      ["policy-check", "Policy check", "process"],
      ["within-policy", "Within policy?", "decision"],
      ["finance-exception", "Finance exception review", "process"],
      ["exception-approved", "Exception approved?", "decision"],
      ["manager-approval", "Manager approval", "process"],
      ["approve-payment", "Approve payment", "end"],
      ["reject-expense", "Reject expense", "end"],
    ],
    edges: [
      ["expense-receipt", "expense-submitted", "receipt-attached"],
      ["receipt-policy", "receipt-attached", "policy-check", "yes"],
      ["receipt-request", "receipt-attached", "request-receipt", "no"],
      ["policy-decision", "policy-check", "within-policy"],
      ["policy-manager", "within-policy", "manager-approval", "yes"],
      ["policy-exception", "within-policy", "finance-exception", "no"],
      ["exception-decision", "finance-exception", "exception-approved"],
      ["exception-manager", "exception-approved", "manager-approval", "yes"],
      ["exception-reject", "exception-approved", "reject-expense", "no"],
      ["manager-payment", "manager-approval", "approve-payment"],
    ],
  },
  {
    id: "restaurant-waitlist",
    title: "Restaurant waitlist",
    difficulty: "challenge",
    tags: ["operations", "loop", "customer-response"],
    description:
      "A waitlist flow with customer response and a loop while a table is not ready.",
    prompt:
      "Create a restaurant waitlist flowchart. A party arrives, the host quotes a wait time, and checks whether a table is available. If available, seat the party. If not, add the party to the waitlist. When notified, decide whether the party responds. No response removes the party from the list. If they respond, check whether the table is ready. Ready seats the party; not ready keeps waiting and checks response again.",
    nodes: [
      ["party-arrives", "Party arrives", "start"],
      ["quote-wait", "Quote wait time", "process"],
      ["table-available", "Table available?", "decision"],
      ["seat-party", "Seat party", "end"],
      ["add-waitlist", "Add to waitlist", "process"],
      ["party-responds", "Party responds?", "decision"],
      ["remove-list", "Remove from list", "end"],
      ["table-ready", "Table ready?", "decision"],
      ["keep-waiting", "Keep waiting", "process"],
    ],
    edges: [
      ["arrives-quote", "party-arrives", "quote-wait"],
      ["quote-available", "quote-wait", "table-available"],
      ["available-seat", "table-available", "seat-party", "yes"],
      ["available-waitlist", "table-available", "add-waitlist", "no"],
      ["waitlist-response", "add-waitlist", "party-responds"],
      ["responds-ready", "party-responds", "table-ready", "yes"],
      ["responds-remove", "party-responds", "remove-list", "no"],
      ["ready-seat", "table-ready", "seat-party", "yes"],
      ["ready-waiting", "table-ready", "keep-waiting", "no"],
      ["waiting-response", "keep-waiting", "party-responds"],
    ],
  },
  {
    id: "ci-release-gate",
    title: "CI release gate",
    difficulty: "standard",
    tags: ["devops", "release", "quality-gate"],
    description:
      "A release pipeline with tests, build, security scan, canary, promote, and rollback paths.",
    prompt:
      "Create a CI release gate flowchart. A commit is merged and the test suite runs. Failed tests block release. Passing tests build an artifact and run a security scan. A failed scan blocks release. A clean scan deploys a canary. If the canary is healthy, promote to production. If not, roll back the canary.",
    nodes: [
      ["commit-merged", "Commit merged", "start"],
      ["run-tests", "Run test suite", "process"],
      ["tests-pass", "Tests pass?", "decision"],
      ["block-release", "Block release", "end"],
      ["build-artifact", "Build artifact", "process"],
      ["scan-clean", "Security scan clean?", "decision"],
      ["deploy-canary", "Deploy canary", "process"],
      ["canary-healthy", "Canary healthy?", "decision"],
      ["promote-production", "Promote production", "end"],
      ["rollback-canary", "Rollback canary", "end"],
    ],
    edges: [
      ["commit-tests", "commit-merged", "run-tests"],
      ["tests-decision", "run-tests", "tests-pass"],
      ["tests-build", "tests-pass", "build-artifact", "yes"],
      ["tests-block", "tests-pass", "block-release", "no"],
      ["build-scan", "build-artifact", "scan-clean"],
      ["scan-canary", "scan-clean", "deploy-canary", "yes"],
      ["scan-block", "scan-clean", "block-release", "no"],
      ["canary-decision", "deploy-canary", "canary-healthy"],
      ["canary-promote", "canary-healthy", "promote-production", "yes"],
      ["canary-rollback", "canary-healthy", "rollback-canary", "no"],
    ],
  },
  {
    id: "procurement-vendor-approval",
    title: "Procurement vendor approval",
    difficulty: "challenge",
    tags: ["procurement", "legal", "loop"],
    description:
      "A procurement workflow with preferred vendor routing, risk assessment, legal review, and renegotiation loop.",
    prompt:
      "Create a procurement vendor approval flowchart. A business need is identified and quotes are collected. If there is a preferred vendor, go to risk assessment. If not, run a competitive bid first and then risk assessment. Risk that is not acceptable rejects the vendor. Acceptable risk goes to legal review. If legal approves, create the contract. If legal does not approve, renegotiate terms and repeat legal review.",
    nodes: [
      ["need-identified", "Need identified", "start"],
      ["collect-quotes", "Collect quotes", "process"],
      ["preferred-vendor", "Preferred vendor?", "decision"],
      ["competitive-bid", "Competitive bid", "process"],
      ["risk-assessment", "Risk assessment", "process"],
      ["risk-acceptable", "Risk acceptable?", "decision"],
      ["legal-review", "Legal review", "process"],
      ["legal-approved", "Legal approved?", "decision"],
      ["renegotiate", "Renegotiate terms", "process"],
      ["create-contract", "Create contract", "end"],
      ["reject-vendor", "Reject vendor", "end"],
    ],
    edges: [
      ["need-quotes", "need-identified", "collect-quotes"],
      ["quotes-preferred", "collect-quotes", "preferred-vendor"],
      ["preferred-risk", "preferred-vendor", "risk-assessment", "yes"],
      ["preferred-bid", "preferred-vendor", "competitive-bid", "no"],
      ["bid-risk", "competitive-bid", "risk-assessment"],
      ["risk-decision", "risk-assessment", "risk-acceptable"],
      ["risk-legal", "risk-acceptable", "legal-review", "yes"],
      ["risk-reject", "risk-acceptable", "reject-vendor", "no"],
      ["legal-decision", "legal-review", "legal-approved"],
      ["legal-contract", "legal-approved", "create-contract", "yes"],
      ["legal-renegotiate", "legal-approved", "renegotiate", "no"],
      ["renegotiate-legal", "renegotiate", "legal-review"],
    ],
  },
  {
    id: "subscription-renewal-dunning",
    title: "Subscription renewal dunning",
    difficulty: "challenge",
    tags: ["billing", "dunning", "loop"],
    description:
      "A billing retry flow with payment update loops, grace period decisions, renewal, and pause outcomes.",
    prompt:
      "Create a subscription renewal dunning flowchart. A renewal is due and the system charges payment. If payment succeeds, renew the subscription. If payment fails, send a reminder and decide whether payment was updated. Updated payment retries the charge. If not updated, decide whether the grace period has expired. Expired grace pauses the subscription; otherwise send another reminder.",
    nodes: [
      ["renewal-due", "Renewal due", "start"],
      ["charge-payment", "Charge payment", "process"],
      ["payment-succeeded", "Payment succeeded?", "decision"],
      ["renew-subscription", "Renew subscription", "end"],
      ["send-reminder", "Send reminder", "process"],
      ["payment-updated", "Payment updated?", "decision"],
      ["grace-expired", "Grace period expired?", "decision"],
      ["pause-subscription", "Pause subscription", "end"],
    ],
    edges: [
      ["renewal-charge", "renewal-due", "charge-payment"],
      ["charge-decision", "charge-payment", "payment-succeeded"],
      ["payment-renew", "payment-succeeded", "renew-subscription", "yes"],
      ["payment-reminder", "payment-succeeded", "send-reminder", "no"],
      ["reminder-updated", "send-reminder", "payment-updated"],
      ["updated-charge", "payment-updated", "charge-payment", "yes"],
      ["updated-grace", "payment-updated", "grace-expired", "no"],
      ["grace-pause", "grace-expired", "pause-subscription", "yes"],
      ["grace-reminder", "grace-expired", "send-reminder", "no"],
    ],
  },
] satisfies readonly FlowchartScenarioDefinition[];

export const flowchartScenarios = flowchartScenarioDefinitions.map(
  defineFlowchartScenario,
);

export type FlowchartScenarioId =
  (typeof flowchartScenarioDefinitions)[number]["id"];

export function getScenario(id: string): DiagramScenario {
  const scenario = flowchartScenarios.find((candidate) => candidate.id === id);

  if (!scenario) {
    throw new Error(`Unknown scenario "${id}".`);
  }

  return scenario;
}
