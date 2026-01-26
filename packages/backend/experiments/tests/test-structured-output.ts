/**
 * TEST SCENARIO: Structured Output with Fixed Schemas
 *
 * GIVEN: Simplified schemas without discriminated unions at root level
 * WHEN: We use generateObject with DiagramSchema (separate shapes/arrows arrays)
 * THEN: Gemini should successfully generate valid structured output
 *
 * GIVEN: IntermediateFormatSchema for two-agent architecture
 * WHEN: We use generateObject with a document analysis prompt
 * THEN: The model should correctly identify chart type, components, and relationships
 */

import {
  generateObjectWithRetry,
  getModel,
  printTestResults,
  type TestResult,
} from "../lib/ai-utils";
import {
  convertIntermediateToDiagram,
  type Diagram,
  DiagramSchema,
  type IntermediateFormat,
  IntermediateFormatSchema,
} from "../lib/schemas";

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
if (!AI_GATEWAY_API_KEY) {
  console.error("Missing AI_GATEWAY_API_KEY environment variable");
  process.exit(1);
}

async function testDiagramSchema(): Promise<TestResult> {
  const start = Date.now();

  try {
    const result = await generateObjectWithRetry({
      model: getModel(),
      schema: DiagramSchema,
      prompt: `Create a simple flowchart with these elements:
- A rectangle "Start" 
- A rectangle "Process" 
- A rectangle "End"
- An arrow from Start to Process
- An arrow from Process to End`,
      timeoutMs: 60_000,
      maxRetries: 2,
    });

    const diagram = result.object as Diagram;
    const hasShapes = diagram.shapes.length >= 3;
    const hasArrows = diagram.arrows.length >= 2;
    const shapeIds = diagram.shapes.map((s) => s.id);
    const arrowsValid = diagram.arrows.every(
      (a) => shapeIds.includes(a.fromId) && shapeIds.includes(a.toId)
    );

    return {
      name: "DiagramSchema - simple flowchart",
      success: hasShapes && hasArrows && arrowsValid,
      durationMs: Date.now() - start,
      tokens: result.usage?.totalTokens,
      metadata: {
        shapeCount: diagram.shapes.length,
        arrowCount: diagram.arrows.length,
        arrowsValid,
      },
    };
  } catch (err) {
    return {
      name: "DiagramSchema - simple flowchart",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testDiagramSchemaWithColors(): Promise<TestResult> {
  const start = Date.now();

  try {
    const result = await generateObjectWithRetry({
      model: getModel(),
      schema: DiagramSchema,
      prompt: `Create an architecture diagram:
- A blue (#a5d8ff) rectangle "Frontend"
- A green (#b2f2bb) rectangle "API"
- A purple (#d0bfff) rectangle "Database"
- Arrow from Frontend to API
- Arrow from API to Database`,
      timeoutMs: 60_000,
      maxRetries: 2,
    });

    const diagram = result.object as Diagram;
    const hasColors = diagram.shapes.some((s) => s.backgroundColor);

    return {
      name: "DiagramSchema - with colors",
      success: diagram.shapes.length >= 3 && diagram.arrows.length >= 2,
      durationMs: Date.now() - start,
      tokens: result.usage?.totalTokens,
      metadata: {
        shapeCount: diagram.shapes.length,
        arrowCount: diagram.arrows.length,
        hasColors,
        colors: diagram.shapes.map((s) => s.backgroundColor).filter(Boolean),
      },
    };
  } catch (err) {
    return {
      name: "DiagramSchema - with colors",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testIntermediateFormat(): Promise<TestResult> {
  const start = Date.now();

  try {
    const result = await generateObjectWithRetry({
      model: getModel(),
      schema: IntermediateFormatSchema,
      prompt: `Analyze this system description and create a diagram specification:

"Our e-commerce platform has a React frontend that talks to a Node.js API. 
The API connects to PostgreSQL for data and Redis for caching. 
All traffic goes through an Nginx load balancer."

Identify all components and their relationships.`,
      timeoutMs: 60_000,
      maxRetries: 2,
    });

    const format = result.object as IntermediateFormat;
    const hasComponents = format.components.length >= 4;
    const hasRelationships = format.relationships.length >= 3;
    const hasValidChartType =
      typeof format.chartType === "string" && format.chartType.length > 0;

    return {
      name: "IntermediateFormat - system analysis",
      success: hasComponents && hasRelationships && hasValidChartType,
      durationMs: Date.now() - start,
      tokens: result.usage?.totalTokens,
      metadata: {
        chartType: format.chartType,
        componentCount: format.components.length,
        relationshipCount: format.relationships.length,
        components: format.components.map((c) => c.label),
      },
    };
  } catch (err) {
    return {
      name: "IntermediateFormat - system analysis",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testIntermediateFormatFlowchart(): Promise<TestResult> {
  const start = Date.now();

  try {
    const result = await generateObjectWithRetry({
      model: getModel(),
      schema: IntermediateFormatSchema,
      prompt: `Create a diagram specification for this process:

"User submits order. System validates payment. If payment valid, process order and send confirmation. If invalid, show error and retry."

This should be a flowchart with decision points.`,
      timeoutMs: 60_000,
      maxRetries: 2,
    });

    const format = result.object as IntermediateFormat;
    const isFlowchart = format.chartType === "flowchart";
    const hasDecision = format.components.some(
      (c) =>
        c.label.toLowerCase().includes("valid") ||
        c.label.toLowerCase().includes("check") ||
        c.shape === "diamond"
    );

    return {
      name: "IntermediateFormat - flowchart with decision",
      success:
        format.components.length >= 4 && format.relationships.length >= 3,
      durationMs: Date.now() - start,
      tokens: result.usage?.totalTokens,
      metadata: {
        chartType: format.chartType,
        componentCount: format.components.length,
        relationshipCount: format.relationships.length,
        isFlowchart,
        hasDecision,
      },
    };
  } catch (err) {
    return {
      name: "IntermediateFormat - flowchart with decision",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function testConversionPipeline(): Promise<TestResult> {
  const start = Date.now();

  try {
    const analyzeResult = await generateObjectWithRetry({
      model: getModel(),
      schema: IntermediateFormatSchema,
      prompt: `Analyze: "Auth service checks tokens, forwards to API, which queries DB"`,
      timeoutMs: 60_000,
      maxRetries: 2,
    });

    const intermediate = analyzeResult.object as IntermediateFormat;
    const diagram = convertIntermediateToDiagram(intermediate);

    const hasShapes = diagram.shapes.length === intermediate.components.length;
    const hasArrows =
      diagram.arrows.length === intermediate.relationships.length;
    const allShapesHaveLabels = diagram.shapes.every((s) => s.label?.text);

    return {
      name: "Conversion pipeline - intermediate to diagram",
      success: hasShapes && hasArrows && allShapesHaveLabels,
      durationMs: Date.now() - start,
      tokens: analyzeResult.usage?.totalTokens,
      metadata: {
        intermediateComponents: intermediate.components.length,
        diagramShapes: diagram.shapes.length,
        diagramArrows: diagram.arrows.length,
      },
    };
  } catch (err) {
    return {
      name: "Conversion pipeline - intermediate to diagram",
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runAllTests() {
  console.log("=== Structured Output Test Suite ===\n");

  const results: TestResult[] = [];

  console.log("Running: DiagramSchema tests...");
  results.push(await testDiagramSchema());
  results.push(await testDiagramSchemaWithColors());

  console.log("Running: IntermediateFormat tests...");
  results.push(await testIntermediateFormat());
  results.push(await testIntermediateFormatFlowchart());

  console.log("Running: Conversion pipeline test...");
  results.push(await testConversionPipeline());

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
