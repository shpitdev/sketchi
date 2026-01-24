# Excalidraw AI Diagram Tool - Implementation Plan

## Table of Contents

- [Summary](#summary)
- [Architecture Overview](#architecture-overview)
- [Phase 0: Experiments](#phase-0-experiments)
- [Phase 1: Core API](#phase-1-core-api)
- [Phase 2: OpenCode Plugin](#phase-2-opencode-plugin)
- [Phase 3: Tech Stack Schemas](#phase-3-tech-stack-schemas)
- [Phase 4: Icon Library Generator](#phase-4-icon-library-generator)
- [Phase 5: Export Rendering](#phase-5-export-rendering)
- [Reference Material](#reference-material)

---

## Summary

**Goal**: API-first Excalidraw diagram generation with AI. No web UI initially - OpenCode plugin is the primary consumer.

**Key Decisions**:
- **Not forking** smart-excalidraw-next - extracting valuable pieces as reference
- **Convex functions** as core logic layer
- **oRPC wrapper** on Vercel for public HTTP API
- **Scalar docs** for API documentation
- **Excalidraw.com integration** for shareable links (using their infrastructure)

**Core Value Proposition**:
1. Prompt → Diagram → Share link
2. Share link + Prompt → Modified diagram → New share link
3. Technology-aware generation (Palantir Foundry, AWS, etc.)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Consumers                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  OpenCode Plugin │  │  Direct API      │  │  Future Web UI   │          │
│  │  (Primary)       │  │  Consumers       │  │  (Later)         │          │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘          │
└───────────┼─────────────────────┼─────────────────────┼─────────────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  oRPC API Layer (Vercel Functions)                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  POST /api/diagrams/generate    - Prompt → Diagram + Share link     │   │
│  │  POST /api/diagrams/modify      - Share link + Prompt → Updated     │   │
│  │  POST /api/diagrams/share       - JSON → Share link                 │   │
│  │  GET  /api/diagrams/parse       - Share link → JSON                 │   │
│  │  GET  /api/docs                 - Scalar API documentation          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Convex Backend                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Actions (AI generation, external API calls)                        │   │
│  │  ├─ generateDiagram: AI SDK → Excalidraw JSON                       │   │
│  │  ├─ modifyDiagram: Parse + AI SDK → Modified JSON                   │   │
│  │  ├─ shareToExcalidraw: AES-GCM encrypt → json.excalidraw.com        │   │
│  │  └─ parseExcalidrawLink: Fetch + decrypt → JSON                     │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  Queries (tech stack knowledge)                                     │   │
│  │  ├─ getTechStackContext: Components, rules, examples                │   │
│  │  └─ listTechStacks: Available tech stacks                           │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  Tables                                                             │   │
│  │  ├─ techStacks: Platform definitions (Palantir, AWS, etc.)          │   │
│  │  ├─ components: Valid node types per stack                          │   │
│  │  ├─ validationRules: Connection rules, anti-patterns                │   │
│  │  └─ exampleDiagrams: Few-shot learning examples                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  External Services                                                           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  AI Gateway      │  │  json.excalidraw │  │  Daytona         │          │
│  │  (Vercel/OR)     │  │  .com            │  │  (Future export) │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 0: Experiments

**Goal**: Validate core behaviors before building the API layer. Run experiments in isolation, then copy proven logic to the real app.

**Location**: `packages/backend/experiments/` - standalone scripts runnable with `bun run`

**Environment**: `AI_GATEWAY_API_KEY` is already configured in Convex. For local experiments, ensure this env var is available.

**Models to Test**:
- `google/gemini-3-flash` - Primary model (fast, good structured output)
- `zai/glm-4.7` - Alternative (use Cerebras provider for performance)

```typescript
// Model configuration for experiments
const MODELS = {
  primary: "google/gemini-3-flash",
  alternative: {
    model: "zai/glm-4.7",
    providerOptions: {
      gateway: {
        order: ["cerebras"], // Prioritize Cerebras for better performance
      },
    },
  },
};
```

### Experiment 0.1: Excalidraw Share Link Round-Trip

Validate we can create and parse Excalidraw share links using their infrastructure.

```typescript
// experiments/share-roundtrip.ts
// Test: JSON → encrypt → upload → get link → fetch → decrypt → JSON
// Verify: Round-trip produces identical output, link opens in excalidraw.com

// === IMPLEMENTATION (copy to lib/excalidraw-share.ts after validation) ===

async function shareToExcalidraw(
  elements: any[],
  appState: any = {}
): Promise<{ url: string; shareId: string; encryptionKey: string }> {
  // 1. Prepare payload
  const payload = JSON.stringify({ elements, appState });
  const encodedPayload = new TextEncoder().encode(payload);
  
  // 2. Generate AES-GCM key (128-bit as per Excalidraw's format)
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 128 },
    true,
    ["encrypt", "decrypt"]
  );
  
  // 3. Encrypt with random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedPayload
  );
  
  // 4. Combine IV + ciphertext (Excalidraw expects this format)
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  // 5. Upload to Excalidraw's storage
  const response = await fetch("https://json.excalidraw.com/api/v2", {
    method: "POST",
    body: combined,
  });
  
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
  }
  
  const { id } = await response.json();
  
  // 6. Export key as base64url string
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const keyString = jwk.k!;
  
  return {
    url: `https://excalidraw.com/#json=${id},${keyString}`,
    shareId: id,
    encryptionKey: keyString,
  };
}

async function parseExcalidrawLink(
  url: string
): Promise<{ elements: any[]; appState: any }> {
  // Parse URL format: https://excalidraw.com/#json=<id>,<key>
  const match = url.match(/#json=([^,]+),(.+)$/);
  if (!match) throw new Error("Invalid Excalidraw share URL format");
  
  const [, id, keyString] = match;
  
  // Fetch encrypted data
  const response = await fetch(`https://json.excalidraw.com/api/v2/${id}`);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }
  const encrypted = await response.arrayBuffer();
  
  // Import key from base64url
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "oct", k: keyString, alg: "A128GCM" },
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  
  // Decrypt (first 12 bytes are IV)
  const iv = new Uint8Array(encrypted.slice(0, 12));
  const ciphertext = new Uint8Array(encrypted.slice(12));
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// === TEST ===

async function testRoundTrip() {
  console.log("=== Experiment 0.1: Share Link Round-Trip ===\n");
  
  const testElements = [
    { type: "rectangle", id: "rect1", x: 100, y: 100, width: 200, height: 100, 
      backgroundColor: "#a5d8ff", label: { text: "Test Node" } },
    { type: "arrow", id: "arrow1", x: 150, y: 200, width: 100, height: 50,
      start: { id: "rect1" }, end: { type: "ellipse" } }
  ];
  
  console.log("1. Original elements:", JSON.stringify(testElements, null, 2));
  
  // Create share link
  console.log("\n2. Creating share link...");
  const { url, shareId, encryptionKey } = await shareToExcalidraw(testElements, {
    viewBackgroundColor: "#ffffff",
  });
  console.log("   Share URL:", url);
  console.log("   Share ID:", shareId);
  console.log("   Key length:", encryptionKey.length, "chars");
  
  // Parse it back
  console.log("\n3. Parsing share link...");
  const parsed = await parseExcalidrawLink(url);
  console.log("   Parsed elements count:", parsed.elements.length);
  console.log("   Parsed appState keys:", Object.keys(parsed.appState));
  
  // Verify
  const originalJson = JSON.stringify(testElements);
  const parsedJson = JSON.stringify(parsed.elements);
  const match = originalJson === parsedJson;
  
  console.log("\n4. Verification:");
  console.log("   Elements match:", match ? "✓ YES" : "✗ NO");
  
  if (!match) {
    console.log("   Diff:", { original: testElements, parsed: parsed.elements });
  }
  
  console.log("\n5. Manual verification:");
  console.log("   Open this URL in browser:", url);
  console.log("   Should see: Rectangle with 'Test Node' label + arrow to ellipse");
  
  return { success: match, url };
}

testRoundTrip().then(result => {
  console.log("\n=== RESULT:", result.success ? "PASS" : "FAIL", "===");
  process.exit(result.success ? 0 : 1);
});
```

**Success Criteria**: 
- Round-trip produces identical elements
- Link opens in excalidraw.com and displays correctly
- No errors during encrypt/upload/fetch/decrypt cycle

### Experiment 0.2: AI Generation Quality

Validate LLM can generate valid Excalidraw skeleton JSON. Compare models.

```typescript
// experiments/ai-generation.ts
// Test: Various prompts → AI → JSON → convertToExcalidrawElements
// Measure: Success rate, token usage, latency, common failure modes
// Compare: gemini-3-flash vs glm-4.7 (Cerebras)

import { generateText } from "ai";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { repairJsonClosure } from "./lib/json-repair";

const MODELS = [
  { name: "gemini-3-flash", model: "google/gemini-3-flash" },
  { 
    name: "glm-4.7-cerebras", 
    model: "zai/glm-4.7",
    providerOptions: { gateway: { order: ["cerebras"] } },
  },
];

const PROMPTS = [
  "Simple flowchart: Start → Process → End",
  "Architecture: Load balancer → 3 API servers → Database",
  "Sequence: User → Auth Service → Database → Auth Service → User",
  "Org chart: CEO with 3 VPs, each VP has 2 directors",
  "Data pipeline: S3 → ETL → Data Warehouse → BI Dashboard",
];

const EXCALIDRAW_SYSTEM_PROMPT = `You generate Excalidraw diagram elements as JSON.

## Output Format
Return ONLY a JSON array of ExcalidrawElementSkeleton objects. No markdown, no explanation.

## Element Types
- Shapes (rectangle, ellipse, diamond): Required: type, x, y. Optional: width, height, backgroundColor, strokeColor, label: { text }
- Arrows: Required: type, x, y. Optional: start: { id }, end: { id }, label: { text }

## Rules
- Always include "id" on shapes so arrows can reference them
- Position elements logically (left-to-right or top-to-bottom)
- Leave 150+ pixels between elements

## Example
[
  { "type": "rectangle", "id": "a", "x": 0, "y": 0, "label": { "text": "Start" } },
  { "type": "rectangle", "id": "b", "x": 250, "y": 0, "label": { "text": "End" } },
  { "type": "arrow", "x": 100, "y": 40, "start": { "id": "a" }, "end": { "id": "b" } }
]`;

async function testGeneration() {
  const results: Record<string, { success: number; total: number; avgTokens: number; avgLatency: number }> = {};
  
  for (const modelConfig of MODELS) {
    results[modelConfig.name] = { success: 0, total: 0, avgTokens: 0, avgLatency: 0 };
    
    for (const prompt of PROMPTS) {
      const start = Date.now();
      try {
        const { text, usage } = await generateText({
          model: modelConfig.model,
          prompt,
          system: EXCALIDRAW_SYSTEM_PROMPT,
          ...(modelConfig.providerOptions && { experimental_providerMetadata: modelConfig.providerOptions }),
        });
        
        const latency = Date.now() - start;
        const repaired = repairJsonClosure(text);
        const elements = JSON.parse(repaired);
        const converted = convertToExcalidrawElements(elements);
        
        results[modelConfig.name].success++;
        results[modelConfig.name].avgTokens += usage?.totalTokens || 0;
        results[modelConfig.name].avgLatency += latency;
        
        console.log(`✓ [${modelConfig.name}] ${prompt.slice(0, 30)}... | ${usage?.totalTokens} tokens | ${latency}ms | ${elements.length} elements`);
      } catch (e) {
        console.log(`✗ [${modelConfig.name}] ${prompt.slice(0, 30)}... | Error: ${e.message}`);
      }
      results[modelConfig.name].total++;
    }
  }
  
  // Summary
  console.log("\n=== MODEL COMPARISON ===");
  for (const [name, stats] of Object.entries(results)) {
    const successRate = ((stats.success / stats.total) * 100).toFixed(1);
    const avgTokens = (stats.avgTokens / stats.total).toFixed(0);
    const avgLatency = (stats.avgLatency / stats.total).toFixed(0);
    console.log(`${name}: ${successRate}% success | avg ${avgTokens} tokens | avg ${avgLatency}ms`);
  }
}

testGeneration();
```

**Success Criteria**: 
- >90% success rate on basic prompts for winning model
- Document which model performs best for speed vs quality tradeoff

### Experiment 0.3: Diagram Modification

Validate LLM can understand existing diagram and apply changes. Test different representations.

```typescript
// experiments/diagram-modification.ts
// Test: Existing JSON + modification prompt → Modified JSON
// Key question: What representation works best for agent comprehension?

import { generateText } from "ai";

// === SIMPLIFY FUNCTION (copy to lib/simplify.ts after validation) ===

function simplifyForAgent(elements: any[]) {
  const nodes = elements
    .filter(e => e.type !== "arrow" && e.type !== "line")
    .map(e => ({
      id: e.id,
      type: e.type,
      label: e.label?.text || null,
    }));
  
  const edges = elements
    .filter(e => e.type === "arrow" || e.type === "line")
    .map(e => ({
      id: e.id,
      from: e.start?.id || null,
      to: e.end?.id || null,
      label: e.label?.text || null,
    }));
  
  return { nodes, edges };
}

function describeGraph(elements: any[]): string {
  const { nodes, edges } = simplifyForAgent(elements);
  const nodeList = nodes.map(n => `- ${n.id}: ${n.label || "(unlabeled)"} (${n.type})`).join("\n");
  const edgeList = edges.map(e => `- ${e.from} → ${e.to}${e.label ? ` (${e.label})` : ""}`).join("\n");
  return `Nodes:\n${nodeList}\n\nConnections:\n${edgeList}`;
}

// === MODIFICATION PROMPT ===

const MODIFICATION_SYSTEM_PROMPT = `You modify existing Excalidraw diagrams.

## Input Format
You receive the current diagram as either:
- Simplified: { nodes: [{id, type, label}], edges: [{id, from, to, label}] }
- Or text description

## Output Format
Return a JSON object with changes:
{
  "add": [/* new ExcalidrawElementSkeleton objects */],
  "remove": ["id1", "id2"],  /* element IDs to remove */
  "modify": [{ "id": "existingId", "changes": { "label": { "text": "new label" } } }]
}

## Rules
- Preserve existing element IDs
- New elements need unique IDs
- Use existing IDs when creating arrow bindings
- Only include sections that have changes (omit empty arrays)`;

// === TEST ===

async function testModification() {
  console.log("=== Experiment 0.3: Diagram Modification ===\n");
  
  // Sample existing diagram
  const existingElements = [
    { id: "api", type: "rectangle", x: 0, y: 0, width: 150, height: 80, label: { text: "API Server" } },
    { id: "db", type: "rectangle", x: 300, y: 0, width: 150, height: 80, label: { text: "Database" } },
    { id: "conn1", type: "arrow", x: 150, y: 40, start: { id: "api" }, end: { id: "db" } },
  ];
  
  const representations = {
    simplified: JSON.stringify(simplifyForAgent(existingElements)),
    textDescription: describeGraph(existingElements),
    // Omitting fullJson - too verbose, unlikely to be better
  };
  
  const modificationPrompt = "Add a Redis cache between the API and Database";
  
  console.log("Existing diagram:", representations.textDescription);
  console.log("\nModification request:", modificationPrompt);
  console.log("\n--- Testing representations ---\n");
  
  const results: Record<string, { success: boolean; tokens: number; output: any }> = {};
  
  for (const [name, repr] of Object.entries(representations)) {
    try {
      const { text, usage } = await generateText({
        model: "google/gemini-3-flash",
        prompt: `Current diagram:\n${repr}\n\nModification: ${modificationPrompt}`,
        system: MODIFICATION_SYSTEM_PROMPT,
      });
      
      // Try to parse the response
      const changes = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
      
      // Validate structure
      const hasValidStructure = 
        (changes.add === undefined || Array.isArray(changes.add)) &&
        (changes.remove === undefined || Array.isArray(changes.remove)) &&
        (changes.modify === undefined || Array.isArray(changes.modify));
      
      // Check if cache was added
      const addedCache = changes.add?.some((e: any) => 
        e.label?.text?.toLowerCase().includes("cache") || 
        e.label?.text?.toLowerCase().includes("redis")
      );
      
      const success = hasValidStructure && addedCache;
      
      results[name] = { 
        success, 
        tokens: usage?.totalTokens || 0, 
        output: changes 
      };
      
      console.log(`${success ? '✓' : '✗'} ${name}: ${usage?.totalTokens} tokens`);
      console.log(`  Added elements: ${changes.add?.length || 0}`);
      console.log(`  Removed elements: ${changes.remove?.length || 0}`);
      console.log(`  Modified elements: ${changes.modify?.length || 0}`);
      if (addedCache) console.log(`  ✓ Cache element found in additions`);
      
    } catch (e: any) {
      results[name] = { success: false, tokens: 0, output: e.message };
      console.log(`✗ ${name}: Error - ${e.message}`);
    }
    console.log();
  }
  
  console.log("=== SUMMARY ===");
  console.log("Best representation for modification:", 
    Object.entries(results)
      .filter(([_, r]) => r.success)
      .sort((a, b) => a[1].tokens - b[1].tokens)[0]?.[0] || "none succeeded"
  );
}

testModification();
```

**Success Criteria**: 
- Modifications are semantically correct (cache added between API and DB)
- Existing elements preserved (not recreated)
- Output format is valid and parseable
- Determine which representation is most token-efficient

### Experiment 0.4: Auto-Layout

Validate we can compute good positions without LLM involvement.

```typescript
// experiments/auto-layout.ts
// Test: Logical structure (nodes + edges) → Positioned diagram
// Libraries to try: dagre, elkjs, d3-force

import dagre from "dagre";

function layoutWithDagre(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 100, ranksep: 150 });
  g.setDefaultEdgeLabel(() => ({}));
  
  for (const node of nodes) {
    g.setNode(node.id, { width: node.width || 150, height: node.height || 80 });
  }
  for (const edge of edges) {
    g.setEdge(edge.from, edge.to);
  }
  
  dagre.layout(g);
  
  return nodes.map(node => {
    const pos = g.node(node.id);
    return { ...node, x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 };
  });
}
```

**Success Criteria**: Clean layouts without overlapping, logical flow direction

### Experiment 0.5: Arrow Optimization

Extract and test the arrow optimization algorithm from smart-excalidraw-next.

```typescript
// experiments/arrow-optimization.ts
// Extracted from: smart-excalidraw-next/lib/optimizeArrows.js
// Test: Arrows connect at optimal edge points based on relative element positions

// === IMPLEMENTATION (copy to lib/optimize-arrows.ts after validation) ===

function determineEdges(startEle: any, endEle: any) {
  const startCenter = { 
    x: (startEle.x || 0) + (startEle.width || 100) / 2,
    y: (startEle.y || 0) + (startEle.height || 100) / 2,
  };
  const endCenter = {
    x: (endEle.x || 0) + (endEle.width || 100) / 2,
    y: (endEle.y || 0) + (endEle.height || 100) / 2,
  };
  
  const dx = startCenter.x - endCenter.x;
  const dy = startCenter.y - endCenter.y;
  
  // Determine which edges to connect based on relative positions
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal relationship dominates
    return dx > 0 
      ? { startEdge: "left", endEdge: "right" }   // start is right of end
      : { startEdge: "right", endEdge: "left" };  // start is left of end
  } else {
    // Vertical relationship dominates
    return dy > 0
      ? { startEdge: "top", endEdge: "bottom" }   // start is below end
      : { startEdge: "bottom", endEdge: "top" };  // start is above end
  }
}

function getEdgeCenter(element: any, edge: string) {
  const x = element.x || 0;
  const y = element.y || 0;
  const w = element.width || 100;
  const h = element.height || 100;
  
  switch (edge) {
    case "left": return { x, y: y + h / 2 };
    case "right": return { x: x + w, y: y + h / 2 };
    case "top": return { x: x + w / 2, y };
    case "bottom": return { x: x + w / 2, y: y + h };
    default: return { x: x + w, y: y + h / 2 };
  }
}

function optimizeArrows(elements: any[]): any[] {
  const elementMap = new Map(elements.filter(e => e.id).map(e => [e.id, e]));
  
  return elements.map(element => {
    if (element.type !== "arrow") return element;
    
    const startEle = element.start?.id ? elementMap.get(element.start.id) : null;
    const endEle = element.end?.id ? elementMap.get(element.end.id) : null;
    
    if (!startEle || !endEle) return element;
    
    const { startEdge, endEdge } = determineEdges(startEle, endEle);
    const startPoint = getEdgeCenter(startEle, startEdge);
    const endPoint = getEdgeCenter(endEle, endEdge);
    
    return {
      ...element,
      x: startPoint.x,
      y: startPoint.y,
      width: Math.max(1, endPoint.x - startPoint.x), // Avoid 0 width (Excalidraw bug)
      height: endPoint.y - startPoint.y,
    };
  });
}

// === TEST ===

function testArrowOptimization() {
  console.log("=== Experiment 0.5: Arrow Optimization ===\n");
  
  const testCases = [
    {
      name: "Horizontal: A left of B",
      elements: [
        { id: "a", type: "rectangle", x: 0, y: 100, width: 100, height: 50 },
        { id: "b", type: "rectangle", x: 300, y: 100, width: 100, height: 50 },
        { id: "arrow", type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } },
      ],
      expected: { startEdge: "right", endEdge: "left" },
    },
    {
      name: "Vertical: A above B",
      elements: [
        { id: "a", type: "rectangle", x: 100, y: 0, width: 100, height: 50 },
        { id: "b", type: "rectangle", x: 100, y: 200, width: 100, height: 50 },
        { id: "arrow", type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } },
      ],
      expected: { startEdge: "bottom", endEdge: "top" },
    },
    {
      name: "Diagonal: A top-left of B (horizontal dominant)",
      elements: [
        { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
        { id: "b", type: "rectangle", x: 400, y: 100, width: 100, height: 50 },
        { id: "arrow", type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } },
      ],
      expected: { startEdge: "right", endEdge: "left" },
    },
  ];
  
  let passed = 0;
  for (const tc of testCases) {
    const optimized = optimizeArrows(tc.elements);
    const arrow = optimized.find(e => e.type === "arrow")!;
    const a = tc.elements.find(e => e.id === "a")!;
    const b = tc.elements.find(e => e.id === "b")!;
    
    // Check arrow start point matches expected edge
    const aCenter = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const bCenter = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    
    // Arrow should go from start element toward end element
    const goesRight = arrow.width > 0;
    const goesDown = arrow.height > 0;
    
    const expectedRight = tc.expected.startEdge === "right";
    const expectedDown = tc.expected.startEdge === "bottom";
    
    const success = (goesRight === expectedRight) || (goesDown === expectedDown);
    
    console.log(`${success ? '✓' : '✗'} ${tc.name}`);
    console.log(`  Arrow: x=${arrow.x}, y=${arrow.y}, width=${arrow.width}, height=${arrow.height}`);
    console.log(`  Expected edges: ${tc.expected.startEdge} → ${tc.expected.endEdge}`);
    
    if (success) passed++;
  }
  
  console.log(`\n=== RESULT: ${passed}/${testCases.length} tests passed ===`);
  return passed === testCases.length;
}

testArrowOptimization();
```

**Success Criteria**: 
- Arrows connect to correct edges based on element positions
- Horizontal pairs connect right→left, vertical pairs connect bottom→top
- No arrows crossing through shapes

---

## Phase 1: Core API

**Goal**: Working API that can generate, modify, and share diagrams. No UI.

### 1.1 Convex Schema

```typescript
// packages/backend/convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Tech stack definitions (Phase 3, but schema defined now)
  techStacks: defineTable({
    id: v.string(),
    name: v.string(),
    version: v.string(),
    description: v.string(),
    promptContext: v.string(),
    isActive: v.boolean(),
  }).index("by_id", ["id"]),

  // Generated diagrams (for history/caching)
  diagrams: defineTable({
    shareId: v.optional(v.string()),      // Excalidraw share ID
    encryptionKey: v.optional(v.string()), // For re-fetching
    prompt: v.string(),
    techStackId: v.optional(v.string()),
    elementsJson: v.string(),              // Stringified elements
    createdAt: v.number(),
  }).index("by_share_id", ["shareId"]),
});
```

### 1.2 Convex Actions

```typescript
// packages/backend/convex/diagrams.ts
import { action } from "./_generated/server";
import { v } from "convex/values";
import { generateText } from "ai";

export const generate = action({
  args: {
    prompt: v.string(),
    techStackId: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Get tech stack context (if specified)
    const techContext = args.techStackId 
      ? await ctx.runQuery(internal.techStacks.getContext, { id: args.techStackId })
      : null;
    
    // 2. Build system prompt
    const systemPrompt = buildSystemPrompt(techContext);
    
    // 3. Generate with AI SDK
    const { text } = await generateText({
      model: args.model || "google/gemini-3-flash",
      prompt: args.prompt,
      system: systemPrompt,
    });
    
    // 4. Parse and repair JSON
    const elements = parseAndRepairJson(text);
    
    // 5. Apply layout optimization
    const layoutedElements = applyLayout(elements);
    
    // 6. Optimize arrow connections
    const optimizedElements = optimizeArrows(layoutedElements);
    
    // 7. Create share link
    const { url, shareId, encryptionKey } = await shareToExcalidraw(optimizedElements);
    
    // 8. Store for history
    await ctx.runMutation(internal.diagrams.store, {
      shareId,
      encryptionKey,
      prompt: args.prompt,
      techStackId: args.techStackId,
      elementsJson: JSON.stringify(optimizedElements),
    });
    
    return {
      elements: optimizedElements,
      url,
      shareId,
    };
  },
});

export const modify = action({
  args: {
    shareUrl: v.string(),
    prompt: v.string(),
    techStackId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Parse existing diagram from share link
    const existing = await parseExcalidrawLink(args.shareUrl);
    
    // 2. Simplify for agent consumption
    const simplified = simplifyForAgent(existing.elements);
    
    // 3. Generate modification
    const { text } = await generateText({
      model: "google/gemini-3-flash",
      prompt: buildModificationPrompt(simplified, args.prompt),
      system: MODIFICATION_SYSTEM_PROMPT,
    });
    
    // 4. Parse and merge changes
    const changes = parseAndRepairJson(text);
    const merged = mergeChanges(existing.elements, changes);
    
    // 5. Re-optimize layout and arrows
    const optimized = optimizeArrows(applyLayout(merged));
    
    // 6. Create new share link
    const { url, shareId } = await shareToExcalidraw(optimized);
    
    return {
      elements: optimized,
      url,
      shareId,
    };
  },
});

export const parse = action({
  args: {
    shareUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const { elements, appState } = await parseExcalidrawLink(args.shareUrl);
    
    return {
      elements,
      appState,
      simplified: simplifyForAgent(elements),
    };
  },
});

export const share = action({
  args: {
    elements: v.array(v.any()),
    appState: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { url, shareId } = await shareToExcalidraw(args.elements, args.appState);
    return { url, shareId };
  },
});
```

### 1.3 oRPC API Layer

```typescript
// apps/web/lib/orpc/router.ts
import { os } from "@orpc/server";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@packages/backend/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const orpc = os.context<{ convex: typeof convex }>();

export const appRouter = orpc.router({
  generate: orpc
    .input(z.object({
      prompt: z.string().min(1).max(10000),
      techStackId: z.string().optional(),
      model: z.string().optional(),
    }))
    .output(z.object({
      elements: z.array(z.any()),
      url: z.string(),
      shareId: z.string(),
    }))
    .handler(async ({ input, context }) => {
      return await context.convex.action(api.diagrams.generate, input);
    }),

  modify: orpc
    .input(z.object({
      shareUrl: z.string().url(),
      prompt: z.string().min(1).max(10000),
      techStackId: z.string().optional(),
    }))
    .output(z.object({
      elements: z.array(z.any()),
      url: z.string(),
      shareId: z.string(),
    }))
    .handler(async ({ input, context }) => {
      return await context.convex.action(api.diagrams.modify, input);
    }),

  parse: orpc
    .input(z.object({
      shareUrl: z.string().url(),
    }))
    .output(z.object({
      elements: z.array(z.any()),
      appState: z.any().optional(),
      simplified: z.object({
        nodes: z.array(z.any()),
        edges: z.array(z.any()),
      }),
    }))
    .handler(async ({ input, context }) => {
      return await context.convex.action(api.diagrams.parse, input);
    }),

  share: orpc
    .input(z.object({
      elements: z.array(z.any()),
      appState: z.any().optional(),
    }))
    .output(z.object({
      url: z.string(),
      shareId: z.string(),
    }))
    .handler(async ({ input, context }) => {
      return await context.convex.action(api.diagrams.share, input);
    }),

  listTechStacks: orpc
    .output(z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
    })))
    .handler(async ({ context }) => {
      return await context.convex.query(api.techStacks.list);
    }),
});

export type AppRouter = typeof appRouter;
```

### 1.4 API Routes + Scalar Docs

```typescript
// apps/web/app/api/[...orpc]/route.ts
import { createOpenAPIServerlessHandler } from "@orpc/openapi/fetch";
import { appRouter } from "@/lib/orpc/router";

const handler = createOpenAPIServerlessHandler({ router: appRouter });

export { handler as GET, handler as POST };
```

```typescript
// apps/web/app/api/docs/route.ts
import { generateOpenAPI } from "@orpc/openapi";
import { appRouter } from "@/lib/orpc/router";

export async function GET() {
  const spec = generateOpenAPI({
    router: appRouter,
    info: {
      title: "Sketchi - Excalidraw AI Diagram API",
      version: "1.0.0",
      description: "Generate, modify, and share Excalidraw diagrams with AI",
    },
  });
  return Response.json(spec);
}
```

```typescript
// apps/web/app/docs/page.tsx
import { ApiReference } from "@scalar/nextjs-api-reference";

export default function DocsPage() {
  return (
    <ApiReference
      configuration={{
        url: "/api/docs",
        theme: "default",
      }}
    />
  );
}
```

### 1.5 Core Library Functions

```typescript
// packages/backend/lib/excalidraw-share.ts
// Extracted from smart-excalidraw-next + Excalidraw docs

export async function shareToExcalidraw(
  elements: ExcalidrawElement[],
  appState?: Partial<AppState>
): Promise<{ url: string; shareId: string; encryptionKey: string }> {
  // 1. Prepare payload
  const payload = JSON.stringify({ elements, appState: appState || {} });
  const encodedPayload = new TextEncoder().encode(payload);
  
  // 2. Generate AES-GCM key
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 128 },
    true,
    ["encrypt", "decrypt"]
  );
  
  // 3. Encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedPayload
  );
  
  // 4. Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  // 5. Upload to Excalidraw
  const response = await fetch("https://json.excalidraw.com/api/v2", {
    method: "POST",
    body: combined,
  });
  const { id } = await response.json();
  
  // 6. Export key
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const keyString = jwk.k!;
  
  return {
    url: `https://excalidraw.com/#json=${id},${keyString}`,
    shareId: id,
    encryptionKey: keyString,
  };
}

export async function parseExcalidrawLink(
  url: string
): Promise<{ elements: ExcalidrawElement[]; appState: any }> {
  // Parse URL: https://excalidraw.com/#json=<id>,<key>
  const match = url.match(/#json=([^,]+),(.+)$/);
  if (!match) throw new Error("Invalid Excalidraw share URL");
  
  const [, id, keyString] = match;
  
  // Fetch encrypted data
  const response = await fetch(`https://json.excalidraw.com/api/v2/${id}`);
  const encrypted = await response.arrayBuffer();
  
  // Import key
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "oct", k: keyString, alg: "A128GCM" },
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  
  // Decrypt
  const iv = new Uint8Array(encrypted.slice(0, 12));
  const ciphertext = new Uint8Array(encrypted.slice(12));
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  
  const payload = JSON.parse(new TextDecoder().decode(decrypted));
  return payload;
}
```

```typescript
// packages/backend/lib/json-repair.ts
// Extracted from smart-excalidraw-next/lib/json-repair.js

export function repairJsonClosure(input: string): string {
  // Strip markdown fences
  let processed = input.trim()
    .replace(/^```(?:json|javascript|js)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  
  // Find JSON array start
  const start = processed.search(/[\[{]/);
  if (start === -1) return processed;
  
  // Track brackets/quotes
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  
  for (let i = start; i < processed.length; i++) {
    const ch = processed[i];
    
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { stack.push("}"); continue; }
    if (ch === "[") { stack.push("]"); continue; }
    if (ch === "}" || ch === "]") {
      if (stack.length && stack[stack.length - 1] === ch) {
        stack.pop();
      }
      if (stack.length === 0) {
        return processed.slice(start, i + 1);
      }
    }
  }
  
  // Close unclosed string
  if (inString) processed += '"';
  
  // Trim trailing comma
  processed = processed.replace(/,\s*$/, "");
  
  // Close unclosed brackets
  while (stack.length) processed += stack.pop();
  
  return processed.slice(start);
}

export function parseAndRepairJson(text: string): any[] {
  const repaired = repairJsonClosure(text);
  const parsed = JSON.parse(repaired);
  return Array.isArray(parsed) ? parsed : [parsed];
}
```

```typescript
// packages/backend/lib/optimize-arrows.ts
// Extracted from smart-excalidraw-next/lib/optimizeArrows.js

export function optimizeArrows(elements: any[]): any[] {
  const elementMap = new Map(elements.filter(e => e.id).map(e => [e.id, e]));
  
  return elements.map(element => {
    if (element.type !== "arrow") return element;
    
    const startEle = element.start?.id ? elementMap.get(element.start.id) : null;
    const endEle = element.end?.id ? elementMap.get(element.end.id) : null;
    
    if (!startEle || !endEle) return element;
    
    const { startEdge, endEdge } = determineEdges(startEle, endEle);
    const startPoint = getEdgeCenter(startEle, startEdge);
    const endPoint = getEdgeCenter(endEle, endEdge);
    
    return {
      ...element,
      x: startPoint.x,
      y: startPoint.y,
      width: Math.max(1, endPoint.x - startPoint.x),
      height: endPoint.y - startPoint.y,
    };
  });
}

function determineEdges(startEle: any, endEle: any) {
  const startCenter = { 
    x: (startEle.x || 0) + (startEle.width || 100) / 2,
    y: (startEle.y || 0) + (startEle.height || 100) / 2,
  };
  const endCenter = {
    x: (endEle.x || 0) + (endEle.width || 100) / 2,
    y: (endEle.y || 0) + (endEle.height || 100) / 2,
  };
  
  const dx = startCenter.x - endCenter.x;
  const dy = startCenter.y - endCenter.y;
  
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 
      ? { startEdge: "left", endEdge: "right" }
      : { startEdge: "right", endEdge: "left" };
  } else {
    return dy > 0
      ? { startEdge: "top", endEdge: "bottom" }
      : { startEdge: "bottom", endEdge: "top" };
  }
}

function getEdgeCenter(element: any, edge: string) {
  const x = element.x || 0;
  const y = element.y || 0;
  const w = element.width || 100;
  const h = element.height || 100;
  
  switch (edge) {
    case "left": return { x, y: y + h / 2 };
    case "right": return { x: x + w, y: y + h / 2 };
    case "top": return { x: x + w / 2, y };
    case "bottom": return { x: x + w / 2, y: y + h };
    default: return { x: x + w, y: y + h / 2 };
  }
}
```

```typescript
// packages/backend/lib/layout.ts
// Auto-layout using dagre

import dagre from "dagre";

export function applyLayout(elements: any[]): any[] {
  // Separate nodes and edges
  const nodes = elements.filter(e => e.type !== "arrow" && e.type !== "line");
  const edges = elements.filter(e => e.type === "arrow" || e.type === "line");
  
  if (nodes.length === 0) return elements;
  
  // Build graph
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 100, ranksep: 150 });
  g.setDefaultEdgeLabel(() => ({}));
  
  for (const node of nodes) {
    g.setNode(node.id || `node-${Math.random()}`, { 
      width: node.width || 150, 
      height: node.height || 80,
      original: node,
    });
  }
  
  for (const edge of edges) {
    if (edge.start?.id && edge.end?.id) {
      g.setEdge(edge.start.id, edge.end.id);
    }
  }
  
  dagre.layout(g);
  
  // Apply positions
  const positionedNodes = nodes.map(node => {
    const nodeId = node.id || `node-${Math.random()}`;
    const pos = g.node(nodeId);
    if (!pos) return node;
    
    return {
      ...node,
      x: pos.x - pos.width / 2,
      y: pos.y - pos.height / 2,
    };
  });
  
  return [...positionedNodes, ...edges];
}
```

```typescript
// packages/backend/lib/simplify.ts
// Simplify diagram for agent consumption

export function simplifyForAgent(elements: any[]) {
  const nodes = elements
    .filter(e => e.type !== "arrow" && e.type !== "line")
    .map(e => ({
      id: e.id,
      type: e.type,
      label: e.label?.text || extractTextFromElement(e),
    }));
  
  const edges = elements
    .filter(e => e.type === "arrow" || e.type === "line")
    .map(e => ({
      id: e.id,
      from: e.start?.id,
      to: e.end?.id,
      label: e.label?.text,
    }));
  
  return { nodes, edges };
}

function extractTextFromElement(element: any): string | undefined {
  // Check for bound text elements
  if (element.boundElements) {
    const textBinding = element.boundElements.find((b: any) => b.type === "text");
    if (textBinding) {
      // Would need to look up by ID in full elements array
      return undefined;
    }
  }
  return undefined;
}
```

### 1.6 System Prompts

```typescript
// packages/backend/lib/prompts.ts

export const EXCALIDRAW_SYSTEM_PROMPT = `You generate Excalidraw diagram elements as JSON.

## Output Format
Return ONLY a JSON array of ExcalidrawElementSkeleton objects. No markdown, no explanation.

## Element Types

### Shapes (rectangle, ellipse, diamond)
Required: type, x, y
Optional: width, height, backgroundColor, strokeColor, label: { text }

### Text
Required: type, x, y, text
Optional: fontSize, strokeColor

### Arrows
Required: type, x, y
Optional: width, height, start: { type | id }, end: { type | id }, label: { text }

## Bindings
- Use start/end with { type: "rectangle" } to auto-create bound shapes
- Use start/end with { id: "existing-id" } to bind to existing elements

## Layout
- Position elements logically left-to-right or top-to-bottom
- Leave 100+ pixels between elements
- Don't worry about exact positions - they'll be auto-optimized

## Example
\`\`\`json
[
  { "type": "rectangle", "id": "a", "x": 0, "y": 0, "label": { "text": "Start" } },
  { "type": "rectangle", "id": "b", "x": 200, "y": 0, "label": { "text": "Process" } },
  { "type": "arrow", "x": 100, "y": 40, "start": { "id": "a" }, "end": { "id": "b" } }
]
\`\`\`
`;

export const MODIFICATION_SYSTEM_PROMPT = `You modify existing Excalidraw diagrams.

## Input
You receive a simplified representation:
- nodes: [{ id, type, label }]
- edges: [{ id, from, to, label }]

## Output
Return a JSON object with changes to apply:
{
  "add": [...],      // New elements to add
  "remove": [...],   // Element IDs to remove
  "modify": [...]    // { id, changes: {...} } for updates
}

## Rules
- Preserve existing element IDs when modifying
- Use existing IDs in arrow bindings
- Keep the diagram's overall structure unless asked to reorganize
`;
```

### 1.7 Phase 1 Deliverables

| Deliverable | Description |
|-------------|-------------|
| Convex actions | generate, modify, parse, share |
| oRPC API | /api/diagrams/* endpoints |
| Scalar docs | /docs with interactive API explorer |
| Core libraries | excalidraw-share, json-repair, optimize-arrows, layout, simplify |
| System prompts | Generation and modification prompts |

---

## Phase 2: OpenCode Plugin

**Goal**: First-class integration with OpenCode CLI

### 2.1 Plugin Structure

```typescript
// packages/opencode-plugin/src/index.ts
import { definePlugin, defineTool } from "@opencode/sdk";

const API_BASE = process.env.SKETCHI_API_URL || "https://sketchi.app";

export default definePlugin({
  name: "sketchi",
  version: "1.0.0",
  
  tools: [
    defineTool({
      name: "diagram_generate",
      description: "Generate an Excalidraw diagram from a description",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What to diagram" },
          techStack: { type: "string", description: "Optional: palantir-foundry, aws, etc." },
        },
        required: ["prompt"],
      },
      execute: async ({ prompt, techStack }) => {
        const res = await fetch(`${API_BASE}/api/diagrams/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, techStackId: techStack }),
        });
        const { url, elements } = await res.json();
        return { url, elementCount: elements.length };
      },
    }),
    
    defineTool({
      name: "diagram_modify",
      description: "Modify an existing Excalidraw diagram",
      parameters: {
        type: "object",
        properties: {
          shareUrl: { type: "string", description: "Excalidraw share URL" },
          prompt: { type: "string", description: "What changes to make" },
        },
        required: ["shareUrl", "prompt"],
      },
      execute: async ({ shareUrl, prompt }) => {
        const res = await fetch(`${API_BASE}/api/diagrams/modify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shareUrl, prompt }),
        });
        const { url } = await res.json();
        return { url };
      },
    }),
    
    defineTool({
      name: "diagram_parse",
      description: "Parse an Excalidraw share link to understand its contents",
      parameters: {
        type: "object",
        properties: {
          shareUrl: { type: "string", description: "Excalidraw share URL" },
        },
        required: ["shareUrl"],
      },
      execute: async ({ shareUrl }) => {
        const res = await fetch(`${API_BASE}/api/diagrams/parse?shareUrl=${encodeURIComponent(shareUrl)}`);
        const { simplified } = await res.json();
        return simplified;
      },
    }),
  ],
});
```

### 2.2 Phase 2 Deliverables

| Deliverable | Description |
|-------------|-------------|
| OpenCode plugin | @sketchi/opencode-plugin npm package |
| Tools | diagram_generate, diagram_modify, diagram_parse |
| Documentation | Usage examples in plugin README |

---

## Phase 3: Tech Stack Schemas

**Goal**: Technology-specific diagram generation with validation

### 3.1 Convex Schema (Extended)

```typescript
// Additional tables for tech stack knowledge

components: defineTable({
  techStackId: v.string(),
  id: v.string(),
  name: v.string(),
  description: v.string(),
  shape: v.string(),
  defaultStyle: v.object({
    backgroundColor: v.string(),
    strokeColor: v.string(),
  }),
  canConnectTo: v.array(v.string()),
  canReceiveFrom: v.array(v.string()),
}).index("by_tech_stack", ["techStackId"]),

validationRules: defineTable({
  techStackId: v.string(),
  id: v.string(),
  description: v.string(),
  severity: v.union(v.literal("error"), v.literal("warning")),
  pattern: v.string(), // JSON pattern to match
}).index("by_tech_stack", ["techStackId"]),

exampleDiagrams: defineTable({
  techStackId: v.string(),
  name: v.string(),
  prompt: v.string(),
  elementsJson: v.string(),
}).index("by_tech_stack", ["techStackId"]),
```

### 3.2 Palantir Foundry Schema (Seed Data)

```typescript
// packages/backend/seed/palantir-foundry.ts

export const palantirFoundryTechStack = {
  id: "palantir-foundry",
  name: "Palantir Foundry",
  version: "1.0.0",
  description: "Data integration and analytics platform",
  promptContext: `
You are generating a Palantir Foundry architecture diagram.
Data flows: External Sources → Pipelines → Datasets → Ontology → Applications
Ontology is the semantic layer. Applications never access Datasets directly.
Actions are the only way to write back to Ontology.
`,
  isActive: true,
};

export const palantirFoundryComponents = [
  {
    id: "ontology",
    name: "Ontology",
    description: "Semantic layer with object types and relationships",
    shape: "rectangle",
    defaultStyle: { backgroundColor: "#E8F4F8", strokeColor: "#0D5C75" },
    canConnectTo: ["workshop", "actions", "object-explorer"],
    canReceiveFrom: ["pipeline", "dataset"],
  },
  {
    id: "pipeline",
    name: "Pipeline",
    description: "Data transformation (Code Workbook, Pipeline Builder)",
    shape: "rectangle",
    defaultStyle: { backgroundColor: "#FFF3E0", strokeColor: "#E65100" },
    canConnectTo: ["ontology", "dataset", "pipeline"],
    canReceiveFrom: ["dataset", "external-source", "pipeline"],
  },
  // ... more components
];
```

### 3.3 Validation Engine

```typescript
// packages/backend/lib/validate.ts

export function validateDiagram(
  elements: any[],
  rules: ValidationRule[]
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  for (const rule of rules) {
    const violations = checkRule(elements, rule);
    for (const violation of violations) {
      if (rule.severity === "error") {
        errors.push(violation);
      } else {
        warnings.push(violation);
      }
    }
  }
  
  return { valid: errors.length === 0, errors, warnings };
}
```

---

## Phase 4: Icon Library Generator

**Goal**: Generate Excalidraw icon libraries from vendor icons

*Deferred - see original plan for details*

---

## Phase 5: Export Rendering

**Goal**: Export diagrams to PNG, SVG, PDF

**Approach**: Deferred to client-side (OpenCode plugin or web UI). Excalidraw has `exportToSvg()` and `exportToBlob()` but requires browser context.

**Future Option**: Daytona/Browserbase sandbox with headless browser if server-side export needed.

---

## Future Improvements

### Arrow Style Selection (Straight vs Elbow)

Excalidraw supports both straight arrows and elbow (orthogonal) arrows via the `elbowed` property. The optimal style depends on the diagram type:

- **Elbow arrows** (`elbowed: true`): Better for architecture diagrams, flowcharts, org charts - cleaner routing that avoids diagonal lines
- **Straight arrows**: Better for concept maps, mind maps, network diagrams - more organic feel

**Implementation approach**:
1. Add `arrowStyle: "straight" | "elbow" | "auto"` parameter to generate/modify APIs
2. For "auto" mode, infer from diagram type or layout:
   - Hierarchical/layered layouts → elbow
   - Radial/organic layouts → straight
3. When using elbow arrows, may need different edge calculation logic

```typescript
// Future: Arrow style in element generation
{
  type: "arrow",
  elbowed: true,  // Creates orthogonal routing
  // ...
}
```

**Reference**: Excalidraw's `elbowed` property creates arrows that route around obstacles with 90-degree turns.

---

## Reference Material

### Extracted from smart-excalidraw-next

| File | Purpose | Location in Our Codebase |
|------|---------|-------------------------|
| `lib/prompts.js` | System prompt + chart type specs | `packages/backend/lib/prompts.ts` |
| `lib/optimizeArrows.js` | Arrow edge optimization | `packages/backend/lib/optimize-arrows.ts` |
| `lib/json-repair.js` | LLM output repair | `packages/backend/lib/json-repair.ts` |
| `lib/llm-client.js` | Reference only - we use AI SDK | N/A |

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `ai` | Vercel AI SDK v6 |
| `@excalidraw/excalidraw` | Element conversion (convertToExcalidrawElements) |
| `dagre` | Graph layout algorithm |
| `@orpc/server` | Type-safe API layer |
| `@orpc/openapi` | OpenAPI spec generation |
| `@scalar/nextjs-api-reference` | API documentation UI |
| `zod` | Schema validation |

### Excalidraw Resources

- [ExcalidrawElementSkeleton API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton)
- [json.excalidraw.com API](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/json.ts)
- [excalidraw-libraries repo](https://github.com/excalidraw/excalidraw-libraries) - for icon library PRs
