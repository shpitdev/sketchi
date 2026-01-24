// Generate architecture diagram from implementation plan
// Run: bun run packages/backend/experiments/generate-arch-diagram.ts

import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import dagre from "dagre";
import { chromium } from "playwright";
import { repairJsonClosure } from "./json-repair";

const EXCALIDRAW_POST_URL = "https://json.excalidraw.com/api/v2/post/";
const IV_BYTE_LENGTH = 12;
const AES_GCM_KEY_LENGTH = 128;
const OUTPUT_DIR = "experiments/output";

interface ShapeElement {
  type: "rectangle" | "ellipse" | "diamond";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: { text: string };
  backgroundColor?: string;
}

interface ArrowElement {
  type: "arrow";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  start: { id: string };
  end: { id: string };
}

type PositionedElement = ShapeElement | ArrowElement;

function generateSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

function applyLayout(rawElements: unknown[]): PositionedElement[] {
  const shapes: ShapeElement[] = [];
  const arrows: ArrowElement[] = [];

  for (const el of rawElements) {
    const e = el as Record<string, unknown>;
    if (e.type === "arrow") {
      arrows.push({
        type: "arrow",
        id: e.id as string,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        start: e.start as { id: string },
        end: e.end as { id: string },
      });
    } else {
      shapes.push({
        type: e.type as "rectangle" | "ellipse" | "diamond",
        id: e.id as string,
        x: 0,
        y: 0,
        width: (e.width as number) ?? 150,
        height: (e.height as number) ?? 60,
        label: e.label as { text: string } | undefined,
        backgroundColor: e.backgroundColor as string | undefined,
      });
    }
  }

  if (shapes.length === 0) {
    return [...shapes, ...arrows];
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const shape of shapes) {
    g.setNode(shape.id, { width: shape.width, height: shape.height });
  }

  for (const arrow of arrows) {
    g.setEdge(arrow.start.id, arrow.end.id);
  }

  dagre.layout(g);

  for (const shape of shapes) {
    const pos = g.node(shape.id);
    if (pos) {
      shape.x = pos.x - shape.width / 2;
      shape.y = pos.y - shape.height / 2;
    }
  }

  const shapeMap = new Map(shapes.map((s) => [s.id, s]));

  for (const arrow of arrows) {
    const startShape = shapeMap.get(arrow.start.id);
    const endShape = shapeMap.get(arrow.end.id);

    if (startShape && endShape) {
      const startX = startShape.x + startShape.width / 2;
      const startY = startShape.y + startShape.height;
      const endX = endShape.x + endShape.width / 2;
      const endY = endShape.y;

      arrow.x = startX;
      arrow.y = startY;
      arrow.width = endX - startX;
      arrow.height = endY - startY;
    }
  }

  return [...shapes, ...arrows];
}

function convertToFullElements(
  positioned: PositionedElement[]
): Record<string, unknown>[] {
  const elements: Record<string, unknown>[] = [];
  let idx = 0;

  for (const el of positioned) {
    const base = {
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor:
        el.type === "arrow"
          ? "transparent"
          : ((el as ShapeElement).backgroundColor ?? "transparent"),
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: `a${idx++}`,
      roundness: el.type === "arrow" ? { type: 2 } : { type: 3 },
      seed: generateSeed(),
      version: 1,
      versionNonce: generateSeed(),
      isDeleted: false,
      boundElements: null as { id: string; type: string }[] | null,
      updated: Date.now(),
      link: null,
      locked: false,
    };

    if (el.type === "arrow") {
      const arrow = el as ArrowElement;
      elements.push({
        ...base,
        points: [
          [0, 0],
          [arrow.width, arrow.height],
        ],
        startBinding: {
          elementId: arrow.start.id,
          focus: 0,
          gap: 5,
          fixedPoint: null,
        },
        endBinding: {
          elementId: arrow.end.id,
          focus: 0,
          gap: 5,
          fixedPoint: null,
        },
        startArrowhead: null,
        endArrowhead: "arrow",
      });
    } else {
      const shape = el as ShapeElement;
      if (shape.label?.text) {
        base.boundElements = [{ id: `${shape.id}_text`, type: "text" }];
        elements.push(base);

        elements.push({
          id: `${shape.id}_text`,
          type: "text",
          x: shape.x + 10,
          y: shape.y + shape.height / 2 - 10,
          width: shape.width - 20,
          height: 20,
          angle: 0,
          strokeColor: "#1e1e1e",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          groupIds: [],
          frameId: null,
          index: `a${idx++}`,
          roundness: null,
          seed: generateSeed(),
          version: 1,
          versionNonce: generateSeed(),
          isDeleted: false,
          boundElements: null,
          updated: Date.now(),
          link: null,
          locked: false,
          text: shape.label.text,
          fontSize: 16,
          fontFamily: 5,
          textAlign: "center",
          verticalAlign: "middle",
          containerId: shape.id,
          originalText: shape.label.text,
          autoResize: true,
          lineHeight: 1.25,
        });
      } else {
        elements.push(base);
      }
    }
  }

  return elements;
}

async function shareToExcalidraw(
  elements: Record<string, unknown>[]
): Promise<string> {
  const payload = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "sketchi",
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });
  const encodedPayload = new TextEncoder().encode(payload);

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_GCM_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedPayload
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  const response = await fetch(EXCALIDRAW_POST_URL, {
    method: "POST",
    body: combined,
  });
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  const { id } = (await response.json()) as { id: string };
  const jwk = await crypto.subtle.exportKey("jwk", key);

  return `https://excalidraw.com/#json=${id},${jwk.k}`;
}

async function exportToPng(url: string, output: string) {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas", { timeout: 30_000 });
  await page.waitForTimeout(3000);

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();

  if (box) {
    await page.screenshot({
      path: output,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  }

  await browser.close();
}

const SYSTEM_PROMPT = `Generate Excalidraw diagram elements as a JSON array. No markdown, no explanation.

Element format:
- Shapes: { "type": "rectangle", "id": "unique_id", "width": 150, "height": 60, "label": { "text": "Label" }, "backgroundColor": "#color" }
- Arrows: { "type": "arrow", "id": "unique_id", "start": { "id": "from_id" }, "end": { "id": "to_id" } }

Colors: #a5d8ff=blue, #b2f2bb=green, #d0bfff=purple, #ffc078=orange`;

const ARCH_PROMPT = `Create architecture diagram:

ROW 1 (blue #a5d8ff):
- "opencode_plugin" label "OpenCode Plugin"
- "direct_api" label "Direct API"
- "web_ui" label "Web UI"

ROW 2 (green #b2f2bb, width 300):
- "orpc_api" label "oRPC API Layer"

ROW 3 (purple #d0bfff, width 300):
- "convex_backend" label "Convex Backend"

ROW 4 (orange #ffc078):
- "ai_gateway" label "AI Gateway"
- "excalidraw_storage" label "excalidraw.com"
- "daytona" label "Daytona"

Arrows:
- opencode_plugin -> orpc_api
- direct_api -> orpc_api
- web_ui -> orpc_api
- orpc_api -> convex_backend
- convex_backend -> ai_gateway
- convex_backend -> excalidraw_storage
- convex_backend -> daytona`;

async function generate() {
  console.log("Generating diagram...");

  const { text } = await generateText({
    model: gateway("google/gemini-3-flash"),
    prompt: ARCH_PROMPT,
    system: SYSTEM_PROMPT,
  });

  console.log("Raw response received");

  const repaired = repairJsonClosure(text);
  const rawElements = JSON.parse(repaired) as unknown[];
  console.log(`Parsed ${rawElements.length} elements`);

  const positioned = applyLayout(rawElements);
  console.log(`Positioned ${positioned.length} elements`);

  const fullElements = convertToFullElements(positioned);
  console.log(`Converted to ${fullElements.length} full elements`);

  const url = await shareToExcalidraw(fullElements);
  console.log("\nExcalidraw URL:", url);

  const outputPath = `${OUTPUT_DIR}/arch-${Date.now()}.png`;
  console.log(`\nExporting to ${outputPath}...`);
  await exportToPng(url, outputPath);
  console.log("Done! Check:", outputPath);

  return { url, outputPath };
}

generate().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
