import Browserbase from "@browserbasehq/sdk";
import { type Browser, chromium, type Page } from "playwright";
import { chromium as chromiumCore } from "playwright-core";
import { applyLayout } from "../../lib/diagram-layout";
import type { Diagram } from "../../lib/diagram-structure";
import { convertLayoutedToExcalidraw } from "../../lib/excalidraw-elements";

const RENDER_TIMEOUT_MS = 60_000;

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

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

async function loadExportHarness(page: Page): Promise<void> {
  await page.goto("about:blank");
  await page.evaluate((html) => {
    document.open();
    document.write(html);
    document.close();
  }, EXPORT_HARNESS_HTML);
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
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

async function exportElementsToPng(
  elements: Record<string, unknown>[],
  options: RenderOptions
): Promise<RenderResult> {
  const { scale = 2, padding = 20, background = true } = options;
  const start = Date.now();

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await loadExportHarness(page);
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

export function renderDiagramToPng(
  diagram: Diagram,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const { chartType = "flowchart" } = options;

  const layouted = applyLayout(diagram, chartType);
  const elements = convertLayoutedToExcalidraw(layouted);

  return exportElementsToPng(elements, options);
}

export function renderElementsToPng(
  elements: Record<string, unknown>[],
  options: RenderOptions = {}
): Promise<RenderResult> {
  return exportElementsToPng(elements, options);
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
    timeout: RENDER_TIMEOUT_MS,
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
  if (!context) {
    await browser.close();
    throw new Error("Failed to get default context from Browserbase session.");
  }

  // Handle edge case: page may not exist yet in the context
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const start = Date.now();
    const layouted = applyLayout(diagram, chartType);
    const elements = convertLayoutedToExcalidraw(layouted);

    await loadExportHarness(page);
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
