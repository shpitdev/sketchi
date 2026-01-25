import Browserbase from "@browserbasehq/sdk";
import { type Browser, chromium } from "playwright";
import { chromium as chromiumCore } from "playwright-core";
import { applyLayout, type LayoutedDiagram } from "./layout";
import type { Diagram } from "./schemas";

const RENDER_TIMEOUT_MS = 30_000;

const EXPORT_HARNESS_HTML = `
<!DOCTYPE html>
<html>
<head>
  <script type="importmap">
  { "imports": { "@excalidraw/excalidraw": "https://esm.sh/@excalidraw/excalidraw@0.18.0" } }
  </script>
</head>
<body>
  <div id="status">Loading...</div>
  <script type="module">
    import { exportToBlob } from "https://esm.sh/@excalidraw/excalidraw@0.18.0";
    
    window.exportPng = async function(elements, options = {}) {
      const { scale = 2, padding = 20, background = true, backgroundColor = "#ffffff" } = options;
      
      const blob = await exportToBlob({
        elements,
        appState: { exportScale: scale, exportBackground: background, viewBackgroundColor: backgroundColor },
        files: null,
        exportPadding: padding,
        mimeType: "image/png",
      });
      
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    };
    
    window.exportReady = true;
    document.getElementById('status').textContent = 'Ready';
  </script>
</body>
</html>
`;

let browser: Browser | null = null;

function generateSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

function convertLayoutedToExcalidraw(
  layouted: LayoutedDiagram
): Record<string, unknown>[] {
  const elements: Record<string, unknown>[] = [];
  let idx = 0;

  for (const shape of layouted.shapes) {
    const base = {
      id: shape.id,
      type: shape.type,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      angle: 0,
      strokeColor: "#1971c2",
      backgroundColor: shape.backgroundColor ?? "#a5d8ff",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: `a${idx++}`,
      roundness: { type: 3 },
      seed: generateSeed(),
      version: 1,
      versionNonce: generateSeed(),
      isDeleted: false,
      boundElements: null as { id: string; type: string }[] | null,
      updated: Date.now(),
      link: null,
      locked: false,
    };

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

  for (const arrow of layouted.arrows) {
    const textId = `${arrow.id}_label`;
    const hasLabel = arrow.label?.text;

    const arrowElement: Record<string, unknown> = {
      id: arrow.id,
      type: "arrow",
      x: arrow.x,
      y: arrow.y,
      width: arrow.width,
      height: arrow.height,
      angle: 0,
      strokeColor: "#1971c2",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: `a${idx++}`,
      roundness: arrow.elbowed ? null : { type: 2 },
      seed: generateSeed(),
      version: 1,
      versionNonce: generateSeed(),
      isDeleted: false,
      boundElements: hasLabel ? [{ type: "text", id: textId }] : null,
      updated: Date.now(),
      link: null,
      locked: false,
      points: arrow.points,
      elbowed: arrow.elbowed,
      startBinding: {
        elementId: arrow.fromId,
        focus: 0,
        gap: 5,
        fixedPoint: null,
      },
      endBinding: {
        elementId: arrow.toId,
        focus: 0,
        gap: 5,
        fixedPoint: null,
      },
      startArrowhead: null,
      endArrowhead: "arrow",
    };

    if (arrow.elbowed) {
      arrowElement.fixedSegments = [];
      arrowElement.startIsSpecial = false;
      arrowElement.endIsSpecial = false;
    }

    elements.push(arrowElement);

    if (hasLabel) {
      const midX = arrow.x + arrow.width / 2;
      const midY = arrow.y + arrow.height / 2;

      elements.push({
        id: textId,
        type: "text",
        x: midX - 30,
        y: midY - 10,
        width: 60,
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
        text: arrow.label?.text ?? "",
        fontSize: 14,
        fontFamily: 5,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: arrow.id,
        originalText: arrow.label?.text ?? "",
        autoResize: true,
        lineHeight: 1.25,
      });
    }
  }

  return elements;
}

export interface RenderResult {
  png: Buffer;
  durationMs: number;
  shareUrl: string;
}

export interface RenderOptions {
  chartType?: string;
  scale?: number;
  padding?: number;
  background?: boolean;
}

export async function renderDiagramToPng(
  diagram: Diagram,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const {
    chartType = "flowchart",
    scale = 2,
    padding = 20,
    background = true,
  } = options;
  const start = Date.now();

  const layouted = applyLayout(diagram, chartType);
  const elements = convertLayoutedToExcalidraw(layouted);

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.setContent(EXPORT_HARNESS_HTML);
    await page.waitForFunction("window.exportReady === true", {
      timeout: RENDER_TIMEOUT_MS,
    });

    const base64Png = (await page.evaluate(
      async ({ elements, options }) => {
        // biome-ignore lint/suspicious/noExplicitAny: window.exportPng is injected by harness
        return await (window as any).exportPng(elements, options);
      },
      {
        elements,
        options: { scale, padding, background, backgroundColor: "#ffffff" },
      }
    )) as string;

    const png = Buffer.from(base64Png, "base64");

    return {
      png,
      durationMs: Date.now() - start,
      shareUrl: "",
    };
  } finally {
    await context.close();
  }
}

export async function renderDiagramToPngRemote(
  diagram: Diagram,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const {
    chartType = "flowchart",
    scale = 2,
    padding = 20,
    background = true,
  } = options;

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!(apiKey && projectId)) {
    throw new Error("Missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID");
  }

  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({ projectId });

  const browser = await chromiumCore.connectOverCDP(session.connectUrl, {
    timeout: 30_000,
  });

  // CRITICAL: Use existing context, do NOT create new context
  // Browserbase sessions always provide a default context per their documentation
  // https://docs.browserbase.com/introduction/playwright (default context usage)
  // https://docs.browserbase.com/fundamentals/using-browser-session (connectOverCDP pattern)
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    await browser.close();
    throw new Error(
      "Browserbase session did not provide a default context. This is unexpected - check Browserbase status."
    );
  }
  const context = contexts[0];

  // Handle edge case: page may not exist yet in the context
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const start = Date.now();
    const layouted = applyLayout(diagram, chartType);
    const elements = convertLayoutedToExcalidraw(layouted);

    await page.setContent(EXPORT_HARNESS_HTML);
    await page.waitForFunction("window.exportReady === true", {
      timeout: 30_000,
    });

    const base64Png = (await page.evaluate(
      async ({ elements, options }) => {
        // biome-ignore lint/suspicious/noExplicitAny: window.exportPng is injected by harness
        return await (window as any).exportPng(elements, options);
      },
      {
        elements,
        options: { scale, padding, background, backgroundColor: "#ffffff" },
      }
    )) as string;

    const png = Buffer.from(base64Png, "base64");

    return {
      png,
      durationMs: Date.now() - start,
      shareUrl: "",
    };
  } finally {
    // Only close browser, session ends automatically
    await browser.close();
  }
}

export async function renderExcalidrawUrlToPng(
  shareUrl: string
): Promise<RenderResult> {
  const start = Date.now();

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(shareUrl, { timeout: RENDER_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: RENDER_TIMEOUT_MS });

    await page.waitForTimeout(2000);

    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: RENDER_TIMEOUT_MS });

    const png = await canvas.screenshot({ type: "png" });

    return {
      png,
      durationMs: Date.now() - start,
      shareUrl,
    };
  } finally {
    await context.close();
  }
}
