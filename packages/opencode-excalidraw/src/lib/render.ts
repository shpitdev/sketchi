import { type Browser, chromium, type Page } from "playwright";

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

export interface RenderOptions {
  background?: boolean;
  backgroundColor?: string;
  padding?: number;
  scale?: number;
}

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

async function exportElementsToPng(
  elements: Record<string, unknown>[],
  options: RenderOptions
): Promise<{ png: Buffer; durationMs: number }> {
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
  }
}

export function renderElementsToPng(
  elements: Record<string, unknown>[],
  options: RenderOptions = {}
): Promise<{ png: Buffer; durationMs: number }> {
  return exportElementsToPng(elements, options);
}
