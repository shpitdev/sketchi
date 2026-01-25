/**
 * Spike Test: Local Playwright + Excalidraw Export
 *
 * Validates that we can:
 * 1. Launch local Chromium browser
 * 2. Inject export harness HTML with Excalidraw
 * 3. Export PNG via exportToBlob
 * 4. Transfer PNG data via base64
 * 5. Achieve acceptable performance (<15s)
 *
 * Expected output: packages/backend/experiments/output/spike-browserbase-export.png
 * Expected diagram: 2 rectangles + 1 arrow with text labels
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium } from "playwright-core";

const exportHarnessHTML = `
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

function generateSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function createTestElements() {
  const elements: Record<string, unknown>[] = [];

  const rect1Id = "rect1";
  const rect1TextId = `${rect1Id}_text`;

  elements.push({
    id: rect1Id,
    type: "rectangle",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    angle: 0,
    strokeColor: "#1971c2",
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0",
    roundness: { type: 3 },
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: [{ id: rect1TextId, type: "text" }],
    updated: Date.now(),
    link: null,
    locked: false,
  });

  elements.push({
    id: rect1TextId,
    type: "text",
    x: 110,
    y: 140,
    width: 180,
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
    index: "a1",
    roundness: null,
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text: "Start",
    fontSize: 16,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: rect1Id,
    originalText: "Start",
    autoResize: true,
    lineHeight: 1.25,
  });

  const rect2Id = "rect2";
  const rect2TextId = `${rect2Id}_text`;

  elements.push({
    id: rect2Id,
    type: "rectangle",
    x: 500,
    y: 100,
    width: 200,
    height: 100,
    angle: 0,
    strokeColor: "#1971c2",
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a2",
    roundness: { type: 3 },
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: [{ id: rect2TextId, type: "text" }],
    updated: Date.now(),
    link: null,
    locked: false,
  });

  elements.push({
    id: rect2TextId,
    type: "text",
    x: 510,
    y: 140,
    width: 180,
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
    index: "a3",
    roundness: null,
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text: "End",
    fontSize: 16,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: rect2Id,
    originalText: "End",
    autoResize: true,
    lineHeight: 1.25,
  });

  const arrowId = "arrow1";
  const arrowTextId = `${arrowId}_label`;

  elements.push({
    id: arrowId,
    type: "arrow",
    x: 300,
    y: 150,
    width: 200,
    height: 0,
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
    index: "a4",
    roundness: { type: 2 },
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: [{ type: "text", id: arrowTextId }],
    updated: Date.now(),
    link: null,
    locked: false,
    points: [
      [0, 0],
      [200, 0],
    ],
    startBinding: {
      elementId: rect1Id,
      focus: 0,
      gap: 5,
      fixedPoint: null,
    },
    endBinding: {
      elementId: rect2Id,
      focus: 0,
      gap: 5,
      fixedPoint: null,
    },
    startArrowhead: null,
    endArrowhead: "arrow",
  });

  elements.push({
    id: arrowTextId,
    type: "text",
    x: 370,
    y: 140,
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
    index: "a5",
    roundness: null,
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text: "flow",
    fontSize: 14,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: arrowId,
    originalText: "flow",
    autoResize: true,
    lineHeight: 1.25,
  });

  return elements;
}

async function main() {
  const startTime = Date.now();

  console.log("🚀 Starting local Playwright + Excalidraw export spike...\n");

  const outputDir = join(process.cwd(), "packages/backend/experiments/output");
  mkdirSync(outputDir, { recursive: true });

  let browser: Browser | undefined;

  try {
    console.log("🌐 Launching local Chromium browser...");
    browser = await chromium.launch({ headless: true });
    console.log("✅ Browser launched\n");

    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("💉 Injecting export harness HTML...");
    await page.setContent(exportHarnessHTML);
    console.log("✅ Export harness injected\n");

    console.log("⏳ Waiting for export harness to initialize...");
    await page.waitForFunction("window.exportReady === true", {
      timeout: 10_000,
    });
    console.log("✅ Export harness ready\n");

    const elements = createTestElements();
    console.log(
      `📐 Created ${elements.length} test elements (2 rectangles + 1 arrow + labels)\n`
    );

    console.log("🎨 Exporting PNG...");
    const base64Png = (await page.evaluate(
      async ({ elements, options }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (window as any).exportPng(elements, options);
      },
      {
        elements,
        options: {
          scale: 2,
          padding: 30,
          background: true,
          backgroundColor: "#ffffff",
        },
      }
    )) as string;
    console.log("✅ PNG exported successfully\n");

    const pngBuffer = Buffer.from(base64Png, "base64");
    const outputPath = join(outputDir, "spike-browserbase-export.png");
    writeFileSync(outputPath, pngBuffer);

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);

    console.log("📊 Performance Metrics:");
    console.log(`   Total time: ${totalTime}s`);
    console.log(`   PNG size: ${(pngBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   Output: ${outputPath}\n`);

    console.log("✅ Spike test completed successfully!");
  } catch (error) {
    console.error("❌ Spike test failed:", error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log("\n🔒 Browser closed");
    }
  }
}

main();
