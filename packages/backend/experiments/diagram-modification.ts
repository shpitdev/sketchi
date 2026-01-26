// Experiment 0.3: Diagram Modification
// Run: AI_GATEWAY_API_KEY=xxx bun run packages/backend/experiments/diagram-modification.ts

import { gateway, generateText } from "ai";
import { repairJsonClosure } from "../lib/json-repair";

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
if (!AI_GATEWAY_API_KEY) {
  console.error("Missing AI_GATEWAY_API_KEY environment variable");
  process.exit(1);
}

interface SimplifiedNode {
  id: string;
  type: string;
  label: string | null;
}

interface SimplifiedEdge {
  id: string;
  from: string | null;
  to: string | null;
  label: string | null;
}

interface SimplifiedDiagram {
  nodes: SimplifiedNode[];
  edges: SimplifiedEdge[];
}

interface ExcalidrawElement {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: { text: string };
  start?: { id: string };
  end?: { id: string };
}

function simplifyForAgent(elements: ExcalidrawElement[]): SimplifiedDiagram {
  const nodes = elements
    .filter((e) => e.type !== "arrow" && e.type !== "line")
    .map((e) => ({
      id: e.id,
      type: e.type,
      label: e.label?.text ?? null,
    }));

  const edges = elements
    .filter((e) => e.type === "arrow" || e.type === "line")
    .map((e) => ({
      id: e.id,
      from: e.start?.id ?? null,
      to: e.end?.id ?? null,
      label: e.label?.text ?? null,
    }));

  return { nodes, edges };
}

const MODIFICATION_SYSTEM_PROMPT = `You modify existing Excalidraw diagrams.

## Input
You receive a simplified representation:
- nodes: [{ id, type, label }]
- edges: [{ id, from, to, label }]

## Output
Return a JSON object with changes:
{
  "add": [...],      // New ExcalidrawElementSkeleton objects to add
  "remove": [...],   // Element IDs to remove (string array)
  "modify": [...]    // { id, changes: {...} } for updates
}

## New Element Format
New elements need: type, id, x, y. Optional: width, height, label: { text }, start: { id }, end: { id }

## Rules
- Preserve existing element IDs when modifying
- Use existing IDs in arrow bindings
- Only include sections that have changes (omit empty arrays)`;

interface ModificationChanges {
  add?: ExcalidrawElement[];
  remove?: string[];
  modify?: Array<{ id: string; changes: Partial<ExcalidrawElement> }>;
}

async function testModification() {
  console.log("=== Experiment 0.3: Diagram Modification ===\n");

  const existingElements: ExcalidrawElement[] = [
    {
      id: "api",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 150,
      height: 80,
      label: { text: "API Server" },
    },
    {
      id: "db",
      type: "rectangle",
      x: 300,
      y: 0,
      width: 150,
      height: 80,
      label: { text: "Database" },
    },
    {
      id: "conn1",
      type: "arrow",
      x: 150,
      y: 40,
      start: { id: "api" },
      end: { id: "db" },
    },
  ];

  const simplified = simplifyForAgent(existingElements);
  const modificationPrompt = "Add a Redis cache between the API and Database";

  console.log("Existing diagram (simplified):");
  console.log(JSON.stringify(simplified, null, 2));
  console.log("\nModification request:", modificationPrompt);
  console.log(`\n${"-".repeat(50)}\n`);

  try {
    const { text, usage } = await generateText({
      model: gateway("google/gemini-3-flash"),
      prompt: `Current diagram:\n${JSON.stringify(simplified)}\n\nModification: ${modificationPrompt}`,
      system: MODIFICATION_SYSTEM_PROMPT,
    });

    console.log("Raw response:", text.slice(0, 500));
    console.log("\nTokens used:", usage?.totalTokens ?? 0);

    const repaired = repairJsonClosure(text);
    const changes = JSON.parse(repaired) as ModificationChanges;

    console.log("\nParsed changes:");
    console.log("- Added elements:", changes.add?.length ?? 0);
    console.log("- Removed elements:", changes.remove?.length ?? 0);
    console.log("- Modified elements:", changes.modify?.length ?? 0);

    const hasValidStructure =
      (changes.add === undefined || Array.isArray(changes.add)) &&
      (changes.remove === undefined || Array.isArray(changes.remove)) &&
      (changes.modify === undefined || Array.isArray(changes.modify));

    const addedCache = changes.add?.some(
      (e) =>
        e.label?.text?.toLowerCase().includes("cache") ||
        e.label?.text?.toLowerCase().includes("redis")
    );

    const success = hasValidStructure && addedCache;

    console.log("\nValidation:");
    console.log("- Valid structure:", hasValidStructure ? "YES" : "NO");
    console.log("- Cache element added:", addedCache ? "YES" : "NO");

    if (changes.add) {
      console.log("\nAdded elements:");
      for (const el of changes.add) {
        console.log(
          `  - ${el.id}: ${el.label?.text ?? "(no label)"} (${el.type})`
        );
      }
    }

    console.log(`\n=== RESULT: ${success ? "PASS" : "FAIL"} ===`);
    return { success };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.log("Error:", error);
    console.log("\n=== RESULT: FAIL ===");
    return { success: false };
  }
}

testModification().then((result) => {
  process.exit(result.success ? 0 : 1);
});
