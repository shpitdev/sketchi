/**
 * TEST SCENARIO: Arrow binding drag verification
 *
 * Goal: Verify that when a shape is dragged in Excalidraw, connected arrows move with it.
 *
 * Pre-conditions:
 * - P0 binding fix deployed (normalizeArrowBindings)
 * - Dev server running OR STAGEHAND_TARGET_URL set
 *
 * Steps:
 * 1. Generate 2-node diagram with arrow via API
 * 2. Load share link in Excalidraw web
 * 3. Extract arrow endpoint coordinates from scene
 * 4. Drag source shape
 * 5. Extract arrow endpoint coordinates again
 * 6. Assert arrow endpoint moved (coordinates changed)
 *
 * Success:
 * - Arrow endpoint coordinates change after shape drag
 * - Arrow remains visually connected to the shape
 */

import { loadConfig } from "../../runner/config";
import {
  captureScreenshot,
  createStagehand,
  getActivePage,
  shutdown,
} from "../../runner/stagehand";
import { writeScenarioSummary } from "../../runner/summary";
import {
  ensureDesktopViewport,
  finalizeScenario,
  resetBrowserState,
} from "../../runner/utils";
import { sleep, waitForCondition } from "../../runner/wait";

interface ArrowEndpoint {
  x: number;
  y: number;
}

interface ShapePoint {
  clientX: number;
  clientY: number;
}

interface DragPayload {
  clientX: number;
  clientY: number;
  offsetX: number;
  offsetY: number;
}

interface DiagramResponse {
  error?: string;
  shareLink?: {
    url?: string;
  };
  shareUrl?: string;
}

async function generateTestDiagram(baseUrl: string): Promise<string> {
  const prompt =
    "Two boxes labeled A and B connected by an arrow from A to B. Simple flowchart.";
  const apiUrl = `${baseUrl}/api/diagrams/generate`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Failed to generate diagram: ${response.statusText} (${response.status}) ${details}`
    );
  }

  const data = (await response.json()) as DiagramResponse;
  const shareUrl = data.shareLink?.url ?? data.shareUrl;
  if (!shareUrl) {
    throw new Error("No share URL returned from diagram generation");
  }

  return shareUrl;
}

async function getSceneElements(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<unknown[] | null> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem("excalidraw");
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });
}

async function waitForExcalidrawReady(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<boolean> {
  return await waitForCondition(
    async () => {
      const elements = await getSceneElements(page);
      return Array.isArray(elements) && elements.length > 0;
    },
    { timeoutMs: 15_000, label: "excalidraw ready" }
  );
}

async function getArrowEndpoint(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<ArrowEndpoint | null> {
  const elements = await getSceneElements(page);
  if (!elements) {
    return null;
  }

  interface ArrowElement {
    points?: [number, number][];
    type: string;
    x: number;
    y: number;
  }

  const arrow = (elements as ArrowElement[]).find((e) => e.type === "arrow");
  if (!arrow?.points || arrow.points.length === 0) {
    return null;
  }

  const lastPoint = arrow.points.at(-1);
  if (!lastPoint) {
    return null;
  }

  return {
    x: arrow.x + lastPoint[0],
    y: arrow.y + lastPoint[1],
  };
}

async function getFirstRectanglePixel(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<ShapePoint | null> {
  return await page.evaluate(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      return null;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    const target = { r: 0xa5, g: 0xd8, b: 0xff };
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = image;
    const threshold = 8;
    const stride = 2;

    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        if (a < 200) {
          continue;
        }
        if (
          Math.abs(r - target.r) <= threshold &&
          Math.abs(g - target.g) <= threshold &&
          Math.abs(b - target.b) <= threshold
        ) {
          const rect = canvas.getBoundingClientRect();
          const scaleX = rect.width / canvas.width;
          const scaleY = rect.height / canvas.height;
          return {
            clientX: rect.left + x * scaleX,
            clientY: rect.top + y * scaleY,
          };
        }
      }
    }

    return null;
  });
}

async function dragShape(
  page: {
    dragAndDrop?: (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      options?: { steps?: number }
    ) => Promise<unknown>;
    evaluate: <T>(
      fn: (args: DragPayload) => T,
      args: DragPayload
    ) => Promise<T>;
  },
  shapePoint: ShapePoint,
  offsetX: number,
  offsetY: number
): Promise<void> {
  const startX = shapePoint.clientX;
  const startY = shapePoint.clientY;
  const endX = startX + offsetX;
  const endY = startY + offsetY;

  if (page.dragAndDrop) {
    await page.dragAndDrop(startX, startY, endX, endY, { steps: 12 });
    return;
  }

  await page.evaluate(
    ({ clientX, clientY, offsetX, offsetY }) => {
      const canvas = document.querySelector(
        "canvas"
      ) as HTMLCanvasElement | null;
      if (!canvas) {
        return;
      }
      const endX = clientX + offsetX;
      const endY = clientY + offsetY;

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX,
          clientY,
          buttons: 1,
          pointerType: "mouse",
        })
      );
      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: endX,
          clientY: endY,
          buttons: 1,
          pointerType: "mouse",
        })
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: endX,
          clientY: endY,
          buttons: 0,
          pointerType: "mouse",
        })
      );
    },
    { clientX: startX, clientY: startY, offsetX, offsetY }
  );
  await sleep(200);
}

async function main() {
  const cfg = loadConfig();
  const stagehand = await createStagehand(cfg);
  const warnings: string[] = [];
  const visualIssues: string[] = [];
  const startedAt = new Date().toISOString();
  let status: "passed" | "failed" = "passed";
  let errorMessage = "";

  try {
    const page = await getActivePage(stagehand);
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await resetBrowserState(page as any, cfg.baseUrl, cfg.vercelBypassSecret);
    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await ensureDesktopViewport(page as any);

    console.log("Generating test diagram...");
    const shareUrl = await generateTestDiagram(cfg.baseUrl);
    console.log(`Generated diagram: ${shareUrl}`);

    console.log("Loading diagram in Excalidraw...");
    await page.goto(shareUrl, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    const excalidrawReady = await waitForExcalidrawReady(
      page as Parameters<typeof waitForExcalidrawReady>[0]
    );
    if (!excalidrawReady) {
      throw new Error("Excalidraw did not initialize with scene elements");
    }

    console.log("Extracting initial arrow coordinates...");
    const initialEndpoint = await getArrowEndpoint(
      page as Parameters<typeof getArrowEndpoint>[0]
    );
    if (!initialEndpoint) {
      throw new Error("Could not find arrow element in scene");
    }
    console.log(
      `Initial arrow endpoint: (${initialEndpoint.x}, ${initialEndpoint.y})`
    );

    const shapePixel = await getFirstRectanglePixel(
      page as Parameters<typeof getFirstRectanglePixel>[0]
    );
    if (!shapePixel) {
      throw new Error("Could not find rectangle/shape pixel to drag");
    }

    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await captureScreenshot(page as any, cfg, "arrow-binding-pre-drag", {
      prompt: "Diagram with arrow connecting two shapes before drag",
    });

    console.log("Dragging shape...");
    const dragOffsetX = 100;
    const dragOffsetY = 50;

    await dragShape(page, shapePixel, dragOffsetX, dragOffsetY);
    await sleep(1000);

    console.log("Extracting post-drag arrow coordinates...");
    const finalEndpoint = await getArrowEndpoint(
      page as Parameters<typeof getArrowEndpoint>[0]
    );
    if (!finalEndpoint) {
      throw new Error("Could not find arrow element after drag");
    }
    console.log(
      `Final arrow endpoint: (${finalEndpoint.x}, ${finalEndpoint.y})`
    );

    // biome-ignore lint/suspicious/noExplicitAny: Playwright Page types
    await captureScreenshot(page as any, cfg, "arrow-binding-post-drag", {
      prompt: "Diagram with arrow after shape was dragged",
    });

    const deltaX = Math.abs(finalEndpoint.x - initialEndpoint.x);
    const deltaY = Math.abs(finalEndpoint.y - initialEndpoint.y);
    const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    console.log(
      `Arrow endpoint movement: deltaX=${deltaX.toFixed(2)}, deltaY=${deltaY.toFixed(2)}, total=${totalMovement.toFixed(2)}`
    );

    const movementThreshold = 20;
    if (totalMovement < movementThreshold) {
      throw new Error(
        `Arrow binding failed: endpoint moved only ${totalMovement.toFixed(2)}px (expected >${movementThreshold}px)`
      );
    }

    console.log(
      `Arrow binding verified: endpoint moved ${totalMovement.toFixed(2)}px`
    );

    if (cfg.env === "BROWSERBASE") {
      const sessionId = stagehand.browserbaseSessionID;
      if (sessionId) {
        console.log(
          `Browserbase session: search for ${sessionId} to view replay`
        );
      }
    }
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Test failed: ${errorMessage}`);
    throw error;
  } finally {
    await writeScenarioSummary({
      outputDir: cfg.screenshotsDir,
      summary: {
        scenario: "arrow-binding-drag",
        status,
        warnings,
        visualIssues,
        error: errorMessage || undefined,
        baseUrl: cfg.baseUrl,
        env: cfg.env,
        startedAt,
        finishedAt: new Date().toISOString(),
      },
    });
    await shutdown(stagehand);
    finalizeScenario(status);
  }
}

await main();
