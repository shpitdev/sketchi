import { chromium, type Page } from "playwright";

const RENDER_TIMEOUT_MS = 60_000;
const PLAYWRIGHT_INSTALL_COMMAND = "npx playwright install chromium";

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

export interface RenderOptions {
  background?: boolean;
  backgroundColor?: string;
  padding?: number;
  scale?: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

export function mapPlaywrightLaunchError(error: unknown): Error | null {
  const message = errorMessage(error);
  const normalized = message.toLowerCase();
  const missingExecutable = normalized.includes("executable doesn't exist");
  const installHint = normalized.includes(
    "please run the following command to download new browsers"
  );

  if (!(missingExecutable || installHint)) {
    return null;
  }

  return new Error(
    [
      "Playwright Chromium is required for Sketchi PNG rendering but is not installed.",
      "Install it once per machine and retry:",
      `  ${PLAYWRIGHT_INSTALL_COMMAND}`,
      "This plugin fails fast and does not auto-install browser binaries.",
      "",
      `Original error: ${message}`,
    ].join("\n")
  );
}

async function loadExportHarness(page: Page): Promise<void> {
  await page.goto("about:blank");
  await page.evaluate((html) => {
    document.open();
    document.write(html);
    document.close();
  }, EXPORT_HARNESS_HTML);
}

export function closeBrowser(): Promise<void> {
  return Promise.resolve();
}

async function exportElementsToPng(
  elements: Record<string, unknown>[],
  options: RenderOptions
): Promise<{ png: Buffer; durationMs: number }> {
  const { scale = 2, padding = 20, background = true } = options;
  const start = Date.now();

  const launchedBrowser = await chromium
    .launch({ headless: true })
    .catch((error) => {
      const mapped = mapPlaywrightLaunchError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    });

  const context = await launchedBrowser.newContext();
  const page = await context.newPage();

  try {
    await loadExportHarness(page);
    await page.waitForFunction("window.exportReady === true", {
      timeout: RENDER_TIMEOUT_MS,
    });

    const base64Png = (await page.evaluate(
      async ({ elements, options }) => {
        // biome-ignore lint/suspicious/noExplicitAny: injected by harness
        return await (window as any).exportPng(elements, options);
      },
      {
        elements,
        options: {
          scale,
          padding,
          background,
          backgroundColor: options.backgroundColor ?? "#ffffff",
        },
      }
    )) as string;

    const png = Buffer.from(base64Png, "base64");
    return { png, durationMs: Date.now() - start };
  } finally {
    await context.close();
    await launchedBrowser.close();
  }
}

export function renderElementsToPng(
  elements: Record<string, unknown>[],
  options: RenderOptions = {}
): Promise<{ png: Buffer; durationMs: number }> {
  return exportElementsToPng(elements, options);
}
