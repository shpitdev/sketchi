/**
 * TEST SCENARIO: Targeted Diagram Optimization
 *
 * GIVEN: Chart-type specific scenarios of increasing complexity
 * WHEN: We generate, render, and grade using type-specific criteria
 * THEN: We can measure quality and iterate until scores plateau
 */

import { analyzeContent } from "../agents/content-analyzer";
import { generateDiagramDirect } from "../agents/diagram-generator";
import { printTestResults, type TestResult } from "../lib/ai-utils";
import { gradeByChartType } from "../lib/grading";
import { createOutputSession, type OutputSession } from "../lib/output";
import { closeBrowser, renderDiagramToPng } from "../lib/render-png";

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
if (!AI_GATEWAY_API_KEY) {
  console.error("Missing AI_GATEWAY_API_KEY environment variable");
  process.exit(1);
}

type ChartType = "flowchart" | "architecture" | "decision-tree" | "mindmap";

interface TestScenario {
  name: string;
  prompt: string;
  chartType: ChartType;
  complexity: "simple" | "medium" | "complex";
  minScore: number;
}

const FLOWCHART_SCENARIOS: TestScenario[] = [
  {
    name: "Flowchart: Simple (3 nodes)",
    prompt: "Create a flowchart: Start -> Process Data -> End",
    chartType: "flowchart",
    complexity: "simple",
    minScore: 80,
  },
  {
    name: "Flowchart: Medium (with decision)",
    prompt: `Create a flowchart for order processing:
1. Receive Order
2. Check Inventory (decision point)
3. If in stock: Process Order -> Ship Order -> Complete
4. If out of stock: Notify Customer -> End`,
    chartType: "flowchart",
    complexity: "medium",
    minScore: 70,
  },
  {
    name: "Flowchart: Complex (multiple decisions)",
    prompt: `Create a flowchart for loan approval:
1. Receive Application
2. Verify Identity (decision: valid?)
3. If invalid: Reject -> End
4. If valid: Check Credit Score (decision: score > 700?)
5. If low score: Manual Review (decision: approved?)
6. If high score: Auto Approve
7. Manual Review can approve or reject
8. Approved: Generate Documents -> Send to Customer -> Complete
9. Rejected: Send Rejection Letter -> End`,
    chartType: "flowchart",
    complexity: "complex",
    minScore: 60,
  },
];

const ARCHITECTURE_SCENARIOS: TestScenario[] = [
  {
    name: "Architecture: Simple (4 layers)",
    prompt:
      "Create an architecture diagram with 4 layers: Client -> Load Balancer -> API Server -> Database",
    chartType: "architecture",
    complexity: "simple",
    minScore: 80,
  },
  {
    name: "Architecture: Medium (10 components)",
    prompt: `Create a microservices architecture:
- Frontend: Web App, Mobile App
- Gateway: API Gateway, Auth Service
- Services: User Service, Order Service, Payment Service, Inventory Service
- Data: PostgreSQL, Redis Cache`,
    chartType: "architecture",
    complexity: "medium",
    minScore: 70,
  },
  {
    name: "Architecture: Complex (20+ components)",
    prompt: `Create a complete e-commerce platform architecture:

Presentation Layer:
- Web Application (React)
- Mobile Apps (iOS, Android)
- Admin Dashboard
- CDN

API Layer:
- API Gateway
- GraphQL Server
- WebSocket Server

Service Layer:
- User Service
- Product Catalog Service
- Cart Service
- Order Service
- Payment Service
- Notification Service
- Search Service
- Recommendation Engine
- Analytics Service

Data Layer:
- PostgreSQL (primary)
- MongoDB (products)
- Redis (cache/sessions)
- Elasticsearch (search)
- Kafka (events)

External:
- Stripe, SendGrid, Twilio, AWS S3`,
    chartType: "architecture",
    complexity: "complex",
    minScore: 60,
  },
];

const DECISION_TREE_SCENARIOS: TestScenario[] = [
  {
    name: "Decision Tree: Simple (1 decision)",
    prompt:
      "Create a decision tree: Is it raining? If yes: Take umbrella. If no: Enjoy the sun.",
    chartType: "decision-tree",
    complexity: "simple",
    minScore: 80,
  },
  {
    name: "Decision Tree: Medium (nested)",
    prompt: `Create a decision tree for tech support:
1. Is the device on? 
   - No: Turn it on -> Problem solved?
     - Yes: Done
     - No: Continue to step 2
   - Yes: Continue to step 2
2. Is there an error message?
   - Yes: Look up error -> Follow instructions -> Done
   - No: Restart device -> Problem solved?
     - Yes: Done
     - No: Contact support`,
    chartType: "decision-tree",
    complexity: "medium",
    minScore: 70,
  },
  {
    name: "Decision Tree: Complex (5+ decisions, varied depth)",
    prompt: `Create a decision tree for hiring process:
1. Resume screen: Meets requirements?
   - No: Reject
   - Yes: Phone screen
2. Phone screen: Good communication?
   - No: Reject
   - Yes: Technical interview
3. Technical interview: Passes coding?
   - No: Reject
   - Yes: System design (for senior) or Culture fit (for junior)
4. System design (senior path): Strong architecture skills?
   - No: Consider for lower level
   - Yes: Final round
5. Culture fit (junior path): Team alignment?
   - No: Reject
   - Yes: Final round
6. Final round: Unanimous approval?
   - No: Discuss concerns -> Resolve? -> Hire or Reject
   - Yes: Make offer
7. Offer: Accepted?
   - No: Negotiate or Close
   - Yes: Hire -> Onboard`,
    chartType: "decision-tree",
    complexity: "complex",
    minScore: 55,
  },
];

const MINDMAP_SCENARIOS: TestScenario[] = [
  {
    name: "Mind Map: Simple (center + 3 branches)",
    prompt:
      "Create a mind map with 'Healthy Living' in the center and 3 branches: Exercise, Nutrition, Sleep",
    chartType: "mindmap",
    complexity: "simple",
    minScore: 75,
  },
  {
    name: "Mind Map: Medium (2 levels deep)",
    prompt: `Create a mind map about 'Web Development':
Center: Web Development
Main branches:
- Frontend (HTML, CSS, JavaScript, Frameworks)
- Backend (Languages, Databases, APIs)
- DevOps (CI/CD, Cloud, Containers)
- Testing (Unit, Integration, E2E)`,
    chartType: "mindmap",
    complexity: "medium",
    minScore: 65,
  },
  {
    name: "Mind Map: Complex (20+ nodes, 3 levels)",
    prompt: `Create a comprehensive mind map about 'Software Engineering':
Center: Software Engineering
Level 1 branches (6):
- Architecture, Development, Testing, Deployment, Monitoring, Security

Level 2 for Architecture: Microservices, Monolith, Serverless, Event-driven
Level 2 for Development: Languages, Frameworks, IDEs, Version Control
Level 2 for Testing: Unit, Integration, E2E, Performance, Security
Level 2 for Deployment: CI/CD, Containers, Kubernetes, Cloud
Level 2 for Monitoring: Logging, Metrics, Tracing, Alerting
Level 2 for Security: Auth, Encryption, OWASP, Compliance`,
    chartType: "mindmap",
    complexity: "complex",
    minScore: 55,
  },
];

const ALL_SCENARIOS = [
  ...FLOWCHART_SCENARIOS,
  ...ARCHITECTURE_SCENARIOS,
  ...DECISION_TREE_SCENARIOS,
  ...MINDMAP_SCENARIOS,
];

async function runScenario(
  scenario: TestScenario,
  session: OutputSession
): Promise<TestResult> {
  const start = Date.now();
  const safeName = scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  try {
    console.log("  [1/4] Analyzing prompt...");
    const analysis = await analyzeContent(scenario.prompt);

    console.log("  [2/4] Generating diagram...");
    const diagram = generateDiagramDirect(analysis.intermediate);

    await session.saveJson(`${safeName}-intermediate`, analysis.intermediate);
    await session.saveJson(`${safeName}-diagram`, diagram);

    console.log("  [3/4] Rendering PNG...");
    const renderResult = await renderDiagramToPng(diagram, {
      chartType: scenario.chartType,
    });

    const pngPath = await session.savePng(safeName, renderResult.png);
    console.log(`        Saved: ${pngPath} (${renderResult.durationMs}ms)`);

    console.log("  [4/4] Grading with vision LLM...");
    const { grading } = await gradeByChartType(
      scenario.chartType,
      scenario.prompt,
      pngPath
    );

    await session.saveJson(`${safeName}-grading`, grading);

    const score = (grading as { score: number }).score;
    const passed = score >= scenario.minScore;

    return {
      name: scenario.name,
      success: passed,
      durationMs: Date.now() - start,
      metadata: {
        chartType: scenario.chartType,
        complexity: scenario.complexity,
        score,
        minScore: scenario.minScore,
        passed,
        renderDurationMs: renderResult.durationMs,
        shareUrl: renderResult.shareUrl,
        grading,
      },
    };
  } catch (err) {
    return {
      name: scenario.name,
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      metadata: {
        chartType: scenario.chartType,
        complexity: scenario.complexity,
      },
    };
  }
}

async function runAllTests() {
  console.log("=== Diagram Optimization Test Suite ===\n");

  const session = await createOutputSession("optimization");
  console.log(`Output directory: ${session.dir}\n`);

  const results: TestResult[] = [];
  const scoresByType: Record<string, number[]> = {};

  for (const scenario of ALL_SCENARIOS) {
    console.log(`\nRunning: ${scenario.name}`);
    const result = await runScenario(scenario, session);
    results.push(result);

    const score = (result.metadata as { score?: number })?.score ?? 0;
    const chartType = scenario.chartType;

    if (!scoresByType[chartType]) {
      scoresByType[chartType] = [];
    }
    scoresByType[chartType].push(score);

    console.log(
      `  Result: ${result.success ? "PASS" : "FAIL"} (score: ${score}/${scenario.minScore})`
    );
  }

  await closeBrowser();

  printTestResults(results);

  console.log("\n=== Scores by Chart Type ===");
  for (const [chartType, scores] of Object.entries(scoresByType)) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    console.log(`${chartType}: avg=${avg.toFixed(1)}, min=${min}, max=${max}`);
  }

  await session.saveJson("summary", {
    timestamp: session.timestamp,
    results: results.map((r) => ({
      name: r.name,
      success: r.success,
      durationMs: r.durationMs,
      score: (r.metadata as { score?: number })?.score,
      error: r.error,
    })),
    scoresByType,
    passRate: `${results.filter((r) => r.success).length}/${results.length}`,
  });

  console.log(`\nResults saved to: ${session.dir}`);

  return { success: results.every((r) => r.success), results };
}

runAllTests().then((result) => {
  process.exit(result.success ? 0 : 1);
});
