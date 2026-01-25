/**
 * TEST SCENARIO: Browserbase Remote PNG Export
 *
 * GIVEN: A simple diagram with 2 shapes and 1 arrow
 * WHEN: We call renderDiagramToPngRemote() with Browserbase credentials
 * THEN: A valid PNG is generated and saved to disk
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { renderDiagramToPngRemote } from "../lib/render-png";
import type { Diagram } from "../lib/schemas";

// Verify environment variables
const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;

if (!(apiKey && projectId)) {
  console.error("Missing Browserbase credentials:");
  if (!apiKey) {
    console.error("  - BROWSERBASE_API_KEY not set");
  }
  if (!projectId) {
    console.error("  - BROWSERBASE_PROJECT_ID not set");
  }
  process.exit(1);
}

// Create simple test diagram: 2 rectangles + 1 arrow
const testDiagram: Diagram = {
  shapes: [
    {
      id: "start",
      type: "rectangle",
      label: { text: "Start" },
      width: 150,
      height: 60,
    },
    {
      id: "end",
      type: "rectangle",
      label: { text: "End" },
      width: 150,
      height: 60,
    },
  ],
  arrows: [
    {
      id: "arrow1",
      fromId: "start",
      toId: "end",
    },
  ],
};

async function runTest() {
  console.log("Testing Browserbase remote PNG export...\n");

  try {
    console.log("Calling renderDiagramToPngRemote()...");
    const result = await renderDiagramToPngRemote(testDiagram);

    // Validate PNG with sharp
    console.log("Validating PNG with sharp...");
    const metadata = await sharp(result.png).metadata();

    if (!(metadata.width && metadata.height)) {
      throw new Error("PNG metadata missing width or height");
    }

    if (metadata.width < 100 || metadata.height < 100) {
      throw new Error(
        `Invalid PNG dimensions: ${metadata.width}x${metadata.height} (minimum 100x100)`
      );
    }

    // Save PNG to output directory
    const outputPath = join(
      import.meta.dirname,
      "../output/browserbase-test.png"
    );
    writeFileSync(outputPath, result.png);

    // Success output
    console.log("\n✅ Test passed!");
    console.log(`PNG dimensions: ${metadata.width}x${metadata.height}`);
    console.log(`PNG format: ${metadata.format}`);
    console.log(`Render time: ${result.durationMs}ms`);
    console.log(`Saved to: ${outputPath}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("\n❌ Test failed!");
    console.error(`Error: ${errorMessage}`);
    process.exit(1);
  }
}

runTest();
