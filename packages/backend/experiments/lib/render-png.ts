import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Browserbase from "@browserbasehq/sdk";
import { type Browser, chromium, type Page } from "playwright";
import { chromium as chromiumCore } from "playwright-core";
import { applyLayout } from "../../lib/diagram-layout";
import type { Diagram } from "../../lib/diagram-structure";
import { convertLayoutedToExcalidraw } from "../../lib/excalidraw-elements";

const RENDER_TIMEOUT_MS = 60_000;
const LEADING_SLASH_REGEX = /^\/+/;

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

const VALIDATE_HARNESS_HTML = `
<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="status">Loading...</div>
  <script>
    window.validateImages = async function(files) {
      const results = [];
      for (const file of files) {
        const { id, dataURL } = file;
        const result = await new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve({ id, ok: true });
          image.onerror = () => resolve({ id, ok: false });
          image.src = dataURL;
        });
        results.push(result);
      }
      return results;
    };
    window.validateReady = true;
    document.getElementById('status').textContent = 'Ready';
  </script>
</body>
</html>
`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXCALIDRAW_DEV_DIR = resolve(
  __dirname,
  "..",
  "..",
  "node_modules",
  "@excalidraw",
  "excalidraw",
  "dist",
  "dev"
);

const buildValidateSceneHarnessHtml = (moduleUrl: string) => `
<!DOCTYPE html>
<html>
<head>
</head>
<body>
  <div id="status">Loading...</div>
  <script type="module">
    import { restore } from "${moduleUrl}";

    window.validateScene = async function(sceneJson) {
      const result = {
        loadOk: false,
        loadError: null,
        svgErrors: [],
      };

      let data = null;
      try {
        data = JSON.parse(sceneJson);
      } catch (error) {
        result.loadError = error?.message ?? String(error);
        return result;
      }

      const hasValidType = data?.type === "excalidraw";
      const elementsOk =
        !data.elements || Array.isArray(data.elements);
      const appStateOk =
        !data.appState || typeof data.appState === "object";

      if (!(hasValidType && elementsOk && appStateOk)) {
        result.loadError = "Invalid excalidraw scene shape";
        return result;
      }

      try {
        restore(
          {
            elements: data.elements || [],
            appState: data.appState || {},
            files: data.files || {},
          },
          null,
          null,
          { repairBindings: true, refreshDimensions: false }
        );
        result.loadOk = true;
      } catch (error) {
        result.loadError = error?.message ?? String(error);
      }

      return result;
    };

    window.validateSceneReady = true;
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

async function loadValidateHarness(page: Page): Promise<void> {
  await page.goto("about:blank");
  await page.evaluate((html) => {
    document.open();
    document.write(html);
    document.close();
  }, VALIDATE_HARNESS_HTML);
}

async function loadValidateSceneHarness(
  page: Page,
  baseUrl: string
): Promise<void> {
  await page.goto(`${baseUrl}/validate.html`);
}

function getContentType(filePath: string): string {
  const ext = extname(filePath);
  if (ext === ".js") {
    return "application/javascript";
  }
  if (ext === ".css") {
    return "text/css";
  }
  if (ext === ".map") {
    return "application/json";
  }
  return "application/octet-stream";
}

async function withLocalExcalidrawServer<T>(
  handler: (baseUrl: string) => Promise<T>
): Promise<T> {
  const validateHtml = buildValidateSceneHarnessHtml(
    "https://esm.sh/@excalidraw/excalidraw@0.18.0?bundle"
  );
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://localhost");
      if (requestUrl.pathname === "/validate.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(validateHtml);
        return;
      }
      const rawPath = requestUrl.pathname.replace(LEADING_SLASH_REGEX, "");
      const filePath = join(EXCALIDRAW_DEV_DIR, rawPath || "index.js");
      if (!filePath.startsWith(EXCALIDRAW_DEV_DIR)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const contents = await readFile(filePath);
      res.writeHead(200, { "Content-Type": getContentType(filePath) });
      res.end(contents);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    return await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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

export interface ImageValidationResult {
  id: string;
  ok: boolean;
}

export interface ImageValidationSummary {
  results: ImageValidationResult[];
  durationMs: number;
}

export interface SceneValidationResult {
  loadOk: boolean;
  loadError: string | null;
  svgErrors: Array<{ id: string; error: string }>;
  harnessErrors?: string[];
  harnessLogs?: string[];
  durationMs: number;
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

export async function validateExcalidrawImageDataUrls(
  files: Array<{ id: string; dataURL: string }>
): Promise<ImageValidationSummary> {
  const start = Date.now();
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await loadValidateHarness(page);
    await page.waitForFunction("window.validateReady === true", {
      timeout: RENDER_TIMEOUT_MS,
    });

    const results = (await page.evaluate(async (input) => {
      // biome-ignore lint/suspicious/noExplicitAny: validateImages injected by harness
      return await (window as any).validateImages(input);
    }, files)) as ImageValidationResult[];

    return { results, durationMs: Date.now() - start };
  } finally {
    await context.close();
  }
}

export function validateExcalidrawSceneJson(
  sceneJson: string
): Promise<SceneValidationResult> {
  const start = Date.now();
  return withLocalExcalidrawServer(async (baseUrl) => {
    const browser = await getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    const harnessErrors: string[] = [];
    const harnessLogs: string[] = [];

    page.on("pageerror", (error) => {
      harnessErrors.push(error?.message ?? String(error));
    });
    page.on("console", (message) => {
      harnessLogs.push(message.text());
    });

    try {
      await loadValidateSceneHarness(page, baseUrl);
      try {
        await page.waitForFunction("window.validateSceneReady === true", {
          timeout: RENDER_TIMEOUT_MS,
        });
      } catch (error) {
        return {
          loadOk: false,
          loadError: error instanceof Error ? error.message : String(error),
          svgErrors: [],
          harnessErrors: harnessErrors.length ? harnessErrors : undefined,
          harnessLogs: harnessLogs.length ? harnessLogs : undefined,
          durationMs: Date.now() - start,
        };
      }

      const result = (await page.evaluate(async (input) => {
        // biome-ignore lint/suspicious/noExplicitAny: validateScene injected by harness
        return await (window as any).validateScene(input);
      }, sceneJson)) as {
        loadOk: boolean;
        loadError: string | null;
        svgErrors: Array<{ id: string; error: string }>;
      };

      return {
        ...result,
        harnessErrors: harnessErrors.length ? harnessErrors : undefined,
        harnessLogs: harnessLogs.length ? harnessLogs : undefined,
        durationMs: Date.now() - start,
      };
    } finally {
      await context.close();
    }
  });
}
