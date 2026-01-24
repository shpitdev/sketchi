// Export Excalidraw diagram to PNG
// Run: bun run packages/backend/experiments/export-diagram.ts <url> [output.png]

import { chromium } from "playwright";

const url = process.argv[2];
const outputPath = process.argv[3] || "diagram.png";

if (!url) {
  console.error(
    "Usage: bun run export-diagram.ts <excalidraw-url> [output.png]"
  );
  process.exit(1);
}

async function exportToPng(excalidrawUrl: string, output: string) {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("Loading:", excalidrawUrl);
  await page.goto(excalidrawUrl, { waitUntil: "networkidle" });

  console.log("Waiting for canvas to render...");
  await page.waitForSelector("canvas", { timeout: 30_000 });
  await page.waitForTimeout(2000);

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();

  if (!box) {
    console.error("Could not find canvas bounding box");
    await browser.close();
    process.exit(1);
  }

  console.log(`Canvas size: ${box.width}x${box.height}`);

  await page.screenshot({
    path: output,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });

  console.log(`Saved to: ${output}`);
  await browser.close();
}

exportToPng(url, outputPath).catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
