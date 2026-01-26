/**
 * TEST SCENARIO: Harder Diagram Generation
 *
 * GIVEN: Complex diagram requirements (sequence, mindmap, state, large)
 * WHEN: We run them through the two-agent pipeline
 * THEN: We get valid diagrams with appropriate structure
 */

import { analyzeContent } from "../agents/content-analyzer";
import { generateDiagramDirect } from "../agents/diagram-generator";
import { printTestResults, type TestResult } from "../lib/ai-utils";

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
if (!AI_GATEWAY_API_KEY) {
  console.error("Missing AI_GATEWAY_API_KEY environment variable");
  process.exit(1);
}

async function testSequenceDiagram(): Promise<TestResult> {
  const start = Date.now();
  const prompt = `Create a sequence diagram for user authentication:
1. User sends login request to Frontend
2. Frontend forwards credentials to Auth Service  
3. Auth Service validates with Database
4. Database returns user record
5. Auth Service generates JWT token
6. Auth Service returns token to Frontend
7. Frontend stores token and shows dashboard`;

  try {
    const analysis = await analyzeContent(prompt);
    const diagram = generateDiagramDirect(analysis.intermediate);

    const isSequence =
      analysis.intermediate.graphOptions?.diagramType === "sequence";
    const hasParticipants = analysis.intermediate.nodes.length >= 4;
    const hasMessages = analysis.intermediate.edges.length >= 6;

    return {
      name: "Sequence diagram - auth flow",
      success: hasParticipants && hasMessages,
      durationMs: Date.now() - start,
      tokens: analysis.tokens,
      metadata: {
        chartType: analysis.intermediate.graphOptions?.diagramType,
        isSequence,
        participants: analysis.intermediate.nodes.map((c) => c.label),
        messageCount: analysis.intermediate.edges.length,
        shapes: diagram.shapes.length,
        arrows: diagram.arrows.length,
      },
    };
  } catch (err) {
    return {
      name: "Sequence diagram - auth flow",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testMindMapRadial(): Promise<TestResult> {
  const start = Date.now();
  const prompt = `Create a mind map about "Software Development":
  
Central topic: Software Development

Main branches:
1. Frontend (HTML, CSS, JavaScript, React, Vue)
2. Backend (Node.js, Python, Go, Databases)  
3. DevOps (CI/CD, Docker, Kubernetes, Cloud)
4. Testing (Unit, Integration, E2E, Performance)
5. Security (Auth, Encryption, OWASP, Compliance)

Each main branch should have its sub-topics listed.`;

  try {
    const analysis = await analyzeContent(prompt);
    const diagram = generateDiagramDirect(analysis.intermediate);

    const isMindmap =
      analysis.intermediate.graphOptions?.diagramType === "mindmap";
    const hasCentralTopic = analysis.intermediate.nodes.some(
      (c) =>
        c.label.toLowerCase().includes("software") ||
        c.label.toLowerCase().includes("development")
    );
    const hasMainBranches = analysis.intermediate.nodes.length >= 6;
    const hasSubTopics = analysis.intermediate.nodes.length >= 15;

    return {
      name: "Mind map - software development (radial)",
      success: hasMainBranches && analysis.intermediate.edges.length >= 5,
      durationMs: Date.now() - start,
      tokens: analysis.tokens,
      metadata: {
        chartType: analysis.intermediate.graphOptions?.diagramType,
        isMindmap,
        hasCentralTopic,
        hasSubTopics,
        componentCount: analysis.intermediate.nodes.length,
        relationshipCount: analysis.intermediate.edges.length,
        shapes: diagram.shapes.length,
        arrows: diagram.arrows.length,
      },
    };
  } catch (err) {
    return {
      name: "Mind map - software development (radial)",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testStateMachine(): Promise<TestResult> {
  const start = Date.now();
  const prompt = `Create a state diagram for an order lifecycle:

States:
- Created (initial state)
- Pending Payment
- Payment Failed  
- Paid
- Processing
- Shipped
- Delivered
- Cancelled
- Refunded

Transitions:
- Created -> Pending Payment (checkout)
- Pending Payment -> Paid (payment success)
- Pending Payment -> Payment Failed (payment error)
- Payment Failed -> Pending Payment (retry)
- Payment Failed -> Cancelled (give up)
- Paid -> Processing (start fulfillment)
- Processing -> Shipped (dispatch)
- Shipped -> Delivered (confirm delivery)
- Paid -> Cancelled (cancel before ship)
- Delivered -> Refunded (refund request)`;

  try {
    const analysis = await analyzeContent(prompt);
    const diagram = generateDiagramDirect(analysis.intermediate);

    const isState = analysis.intermediate.graphOptions?.diagramType === "state";
    const hasAllStates = analysis.intermediate.nodes.length >= 8;
    const hasTransitions = analysis.intermediate.edges.length >= 8;
    const hasLabels = analysis.intermediate.edges.some((r) => r.label);

    return {
      name: "State machine - order lifecycle",
      success: hasAllStates && hasTransitions,
      durationMs: Date.now() - start,
      tokens: analysis.tokens,
      metadata: {
        chartType: analysis.intermediate.graphOptions?.diagramType,
        isState,
        stateCount: analysis.intermediate.nodes.length,
        transitionCount: analysis.intermediate.edges.length,
        hasLabels,
        shapes: diagram.shapes.length,
        arrows: diagram.arrows.length,
      },
    };
  } catch (err) {
    return {
      name: "State machine - order lifecycle",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testLargeDiagram(): Promise<TestResult> {
  const start = Date.now();
  const prompt = `Create an architecture diagram for a complete e-commerce platform:

Frontend Layer:
- Web App (React)
- Mobile App (React Native)
- Admin Dashboard
- CDN

API Gateway Layer:
- Kong API Gateway
- Rate Limiter
- Auth Middleware

Microservices:
- User Service
- Product Service  
- Inventory Service
- Order Service
- Payment Service
- Notification Service
- Search Service
- Recommendation Service

Data Layer:
- PostgreSQL (users, orders)
- MongoDB (products, reviews)
- Redis (sessions, cache)
- Elasticsearch (search index)

External Services:
- Stripe (payments)
- SendGrid (emails)
- Twilio (SMS)
- AWS S3 (storage)

Show connections between all related components.`;

  try {
    const analysis = await analyzeContent(prompt);
    const diagram = generateDiagramDirect(analysis.intermediate);

    const hasLargeComponentCount = analysis.intermediate.nodes.length >= 20;
    const hasManyConnections = analysis.intermediate.edges.length >= 15;
    const hasLayers = analysis.intermediate.nodes.some(
      (c) =>
        c.group ||
        c.label.toLowerCase().includes("layer") ||
        c.label.toLowerCase().includes("service")
    );

    return {
      name: "Large diagram - e-commerce architecture (20+ elements)",
      success: hasLargeComponentCount && hasManyConnections,
      durationMs: Date.now() - start,
      tokens: analysis.tokens,
      metadata: {
        chartType: analysis.intermediate.graphOptions?.diagramType,
        componentCount: analysis.intermediate.nodes.length,
        relationshipCount: analysis.intermediate.edges.length,
        hasLayers,
        shapes: diagram.shapes.length,
        arrows: diagram.arrows.length,
        components: analysis.intermediate.nodes.map((c) => c.label),
      },
    };
  } catch (err) {
    return {
      name: "Large diagram - e-commerce architecture (20+ elements)",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testFishboneDiagram(): Promise<TestResult> {
  const start = Date.now();
  const prompt = `Create a fishbone (Ishikawa) diagram analyzing "Website Performance Issues":

Problem (head): Slow Website Load Times

Main categories (bones):
1. People: Lack of training, understaffing, poor communication
2. Process: No optimization workflow, missing performance budget, no monitoring
3. Technology: Outdated framework, no CDN, large bundle size, no caching
4. Environment: Slow servers, network latency, third-party scripts
5. Measurement: No metrics, no alerts, no profiling tools`;

  try {
    const analysis = await analyzeContent(prompt);
    const diagram = generateDiagramDirect(analysis.intermediate);

    const isFishbone =
      analysis.intermediate.graphOptions?.diagramType === "fishbone";
    const hasMainProblem = analysis.intermediate.nodes.some(
      (c) =>
        c.label.toLowerCase().includes("slow") ||
        c.label.toLowerCase().includes("performance") ||
        c.label.toLowerCase().includes("load")
    );
    const hasCategories = analysis.intermediate.nodes.length >= 6;

    return {
      name: "Fishbone diagram - performance analysis",
      success: hasCategories && analysis.intermediate.edges.length >= 5,
      durationMs: Date.now() - start,
      tokens: analysis.tokens,
      metadata: {
        chartType: analysis.intermediate.graphOptions?.diagramType,
        isFishbone,
        hasMainProblem,
        componentCount: analysis.intermediate.nodes.length,
        relationshipCount: analysis.intermediate.edges.length,
        shapes: diagram.shapes.length,
        arrows: diagram.arrows.length,
      },
    };
  } catch (err) {
    return {
      name: "Fishbone diagram - performance analysis",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testSWOTAnalysis(): Promise<TestResult> {
  const start = Date.now();
  const prompt = `Create a SWOT analysis diagram for a startup entering the AI market:

Strengths:
- Strong technical team
- Innovative product
- Agile development
- Low overhead costs

Weaknesses:
- Limited funding
- No brand recognition
- Small customer base
- Limited resources

Opportunities:
- Growing AI market
- Enterprise demand
- Partnership potential
- Government grants

Threats:
- Big tech competition
- Rapid tech changes
- Regulatory uncertainty
- Economic downturn`;

  try {
    const analysis = await analyzeContent(prompt);
    const diagram = generateDiagramDirect(analysis.intermediate);

    const isSWOT = analysis.intermediate.graphOptions?.diagramType === "swot";
    const hasFourQuadrants = analysis.intermediate.nodes.length >= 4;
    const hasItems = analysis.intermediate.nodes.length >= 10;

    return {
      name: "SWOT analysis - AI startup",
      success: hasFourQuadrants,
      durationMs: Date.now() - start,
      tokens: analysis.tokens,
      metadata: {
        chartType: analysis.intermediate.graphOptions?.diagramType,
        isSWOT,
        componentCount: analysis.intermediate.nodes.length,
        hasItems,
        shapes: diagram.shapes.length,
        arrows: diagram.arrows.length,
      },
    };
  } catch (err) {
    return {
      name: "SWOT analysis - AI startup",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runAllTests() {
  console.log("=== Harder Diagrams Test Suite ===\n");

  const results: TestResult[] = [];

  console.log("Running: Sequence diagram...");
  results.push(await testSequenceDiagram());

  console.log("Running: Mind map (radial)...");
  results.push(await testMindMapRadial());

  console.log("Running: State machine...");
  results.push(await testStateMachine());

  console.log("Running: Large diagram (20+ elements)...");
  results.push(await testLargeDiagram());

  console.log("Running: Fishbone diagram...");
  results.push(await testFishboneDiagram());

  console.log("Running: SWOT analysis...");
  results.push(await testSWOTAnalysis());

  printTestResults(results);

  for (const result of results) {
    if (result.metadata) {
      console.log(`\n${result.name}:`);
      console.log(JSON.stringify(result.metadata, null, 2));
    }
  }

  const allPassed = results.every((r) => r.success);
  return { success: allPassed, results };
}

runAllTests().then((result) => {
  process.exit(result.success ? 0 : 1);
});
