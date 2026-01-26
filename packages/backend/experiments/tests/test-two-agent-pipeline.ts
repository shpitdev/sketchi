/**
 * TEST SCENARIO: Two-Agent Pipeline E2E
 *
 * GIVEN: A natural language description of a diagram
 * WHEN: We run it through Agent 1 (Content Analyzer) then Agent 2 (Diagram Generator)
 * THEN: We get a valid Diagram with correct shapes and arrows
 */

import { analyzeContent } from "../agents/content-analyzer";
import {
  generateDiagram,
  generateDiagramDirect,
} from "../agents/diagram-generator";
import { printTestResults, type TestResult } from "../lib/ai-utils";

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
if (!AI_GATEWAY_API_KEY) {
  console.error("Missing AI_GATEWAY_API_KEY environment variable");
  process.exit(1);
}

async function testSimpleFlowchart(): Promise<TestResult> {
  const start = Date.now();
  const prompt = `Create a simple login flow: user enters credentials, system validates, 
  if valid show dashboard, if invalid show error message`;

  try {
    const analysis = await analyzeContent(prompt);
    const result = await generateDiagram(analysis.intermediate);

    const hasShapes = result.diagram.shapes.length >= 4;
    const hasArrows = result.diagram.arrows.length >= 3;
    const allArrowsValid = result.diagram.arrows.every(
      (a) =>
        result.diagram.shapes.some((s) => s.id === a.fromId) &&
        result.diagram.shapes.some((s) => s.id === a.toId)
    );

    return {
      name: "Two-agent pipeline - login flowchart",
      success: hasShapes && hasArrows && allArrowsValid,
      durationMs: Date.now() - start,
      tokens: (analysis.tokens ?? 0) + (result.tokens ?? 0),
      metadata: {
        chartType: analysis.intermediate.chartType,
        components: analysis.intermediate.components.length,
        relationships: analysis.intermediate.relationships.length,
        shapes: result.diagram.shapes.length,
        arrows: result.diagram.arrows.length,
        allArrowsValid,
      },
    };
  } catch (err) {
    return {
      name: "Two-agent pipeline - login flowchart",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testArchitectureDiagram(): Promise<TestResult> {
  const start = Date.now();
  const prompt = `Draw a microservices architecture: 
  - API Gateway receives requests
  - Routes to User Service, Product Service, or Order Service
  - All services connect to a shared PostgreSQL database
  - Redis cache sits between services and database`;

  try {
    const analysis = await analyzeContent(prompt);
    const result = await generateDiagram(analysis.intermediate);

    const hasExpectedComponents = result.diagram.shapes.length >= 5;
    const hasConnections = result.diagram.arrows.length >= 4;

    return {
      name: "Two-agent pipeline - microservices architecture",
      success: hasExpectedComponents && hasConnections,
      durationMs: Date.now() - start,
      tokens: (analysis.tokens ?? 0) + (result.tokens ?? 0),
      metadata: {
        chartType: analysis.intermediate.chartType,
        components: analysis.intermediate.components.map((c) => c.label),
        shapes: result.diagram.shapes.length,
        arrows: result.diagram.arrows.length,
      },
    };
  } catch (err) {
    return {
      name: "Two-agent pipeline - microservices architecture",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testDirectConversion(): Promise<TestResult> {
  const start = Date.now();
  const prompt = "Simple data flow: CSV file -> Parser -> Database";

  try {
    const analysis = await analyzeContent(prompt);
    const directDiagram = generateDiagramDirect(analysis.intermediate);

    const matchesComponents =
      directDiagram.shapes.length === analysis.intermediate.components.length;
    const matchesRelationships =
      directDiagram.arrows.length ===
      analysis.intermediate.relationships.length;

    return {
      name: "Direct conversion (no second AI call)",
      success: matchesComponents && matchesRelationships,
      durationMs: Date.now() - start,
      tokens: analysis.tokens,
      metadata: {
        chartType: analysis.intermediate.chartType,
        inputComponents: analysis.intermediate.components.length,
        outputShapes: directDiagram.shapes.length,
        inputRelationships: analysis.intermediate.relationships.length,
        outputArrows: directDiagram.arrows.length,
      },
    };
  } catch (err) {
    return {
      name: "Direct conversion (no second AI call)",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testComplexDecisionTree(): Promise<TestResult> {
  const start = Date.now();
  const prompt = `Create a customer support decision tree:
  1. Customer contacts support
  2. Is it a billing issue? 
     - Yes: Transfer to billing team
     - No: Is it a technical issue?
       - Yes: Create tech ticket
       - No: General inquiry, provide FAQ link
  3. All paths end with "Issue resolved"`;

  try {
    const analysis = await analyzeContent(prompt);
    const result = await generateDiagram(analysis.intermediate);

    const hasDecisionPoints = analysis.intermediate.components.some(
      (c) => c.shape === "diamond" || c.label.toLowerCase().includes("?")
    );
    const hasMultiplePaths = result.diagram.arrows.length >= 5;

    return {
      name: "Two-agent pipeline - decision tree",
      success: result.diagram.shapes.length >= 6 && hasMultiplePaths,
      durationMs: Date.now() - start,
      tokens: (analysis.tokens ?? 0) + (result.tokens ?? 0),
      metadata: {
        chartType: analysis.intermediate.chartType,
        hasDecisionPoints,
        components: analysis.intermediate.components.length,
        shapes: result.diagram.shapes.length,
        arrows: result.diagram.arrows.length,
      },
    };
  } catch (err) {
    return {
      name: "Two-agent pipeline - decision tree",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testMindMap(): Promise<TestResult> {
  const start = Date.now();
  const prompt = `Create a mind map about "Machine Learning":
  - Main topic: Machine Learning
  - Branches: Supervised Learning, Unsupervised Learning, Reinforcement Learning
  - Supervised has: Classification, Regression
  - Unsupervised has: Clustering, Dimensionality Reduction`;

  try {
    const analysis = await analyzeContent(prompt);
    const result = await generateDiagram(analysis.intermediate);

    const isMindmap = analysis.intermediate.chartType === "mindmap";
    const hasCentralTopic = analysis.intermediate.components.some((c) =>
      c.label.toLowerCase().includes("machine learning")
    );

    return {
      name: "Two-agent pipeline - mind map",
      success:
        result.diagram.shapes.length >= 7 && result.diagram.arrows.length >= 6,
      durationMs: Date.now() - start,
      tokens: (analysis.tokens ?? 0) + (result.tokens ?? 0),
      metadata: {
        chartType: analysis.intermediate.chartType,
        isMindmap,
        hasCentralTopic,
        shapes: result.diagram.shapes.length,
        arrows: result.diagram.arrows.length,
      },
    };
  } catch (err) {
    return {
      name: "Two-agent pipeline - mind map",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runAllTests() {
  console.log("=== Two-Agent Pipeline Test Suite ===\n");

  const results: TestResult[] = [];

  console.log("Running: Simple flowchart...");
  results.push(await testSimpleFlowchart());

  console.log("Running: Architecture diagram...");
  results.push(await testArchitectureDiagram());

  console.log("Running: Direct conversion...");
  results.push(await testDirectConversion());

  console.log("Running: Decision tree...");
  results.push(await testComplexDecisionTree());

  console.log("Running: Mind map...");
  results.push(await testMindMap());

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
