import type { Browser } from "@cloudflare/playwright";
import { launch } from "@cloudflare/playwright";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { beforeEach, expect, vi } from "vitest";

import {
  BROWSER_RENDER_TIMEOUT_MS,
  createCloudflareBrowserRunArtifactRenderer,
  withScopedBrowserSession,
  type CloudflareBrowserRunBinding,
} from "./codemode-browser-renderer.server";

vi.mock("@cloudflare/playwright", () => ({
  launch: vi.fn(),
}));

const browserBinding: CloudflareBrowserRunBinding = { fetch };

function renderInput() {
  return {
    scene: {
      accentColor: "#000000",
      backgroundColor: "#ffffff",
      diagramId: "test-diagram",
      elements: [],
      height: 120,
      title: "Test diagram",
      width: 180,
    },
    excalidraw: {
      appState: {},
      elements: [],
    },
  };
}

describe("Cloudflare Browser Rendering Code Mode renderer", () => {
  const launchMock = vi.mocked(launch);

  beforeEach(() => {
    launchMock.mockReset();
  });

  it.effect("renders through the harness and closes on success", () =>
    Effect.gen(function* () {
      let visitedUrl = "";
      const close = vi.fn(async () => {});
      const page = {
        goto: vi.fn(async (value: string) => {
          visitedUrl = value;
        }),
        waitForFunction: vi.fn(async () => {}),
        evaluate: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(btoa("PNG")),
      };
      launchMock.mockResolvedValue({
        close,
        newPage: vi.fn(async () => page),
      } as unknown as Browser);

      const renderer = createCloudflareBrowserRunArtifactRenderer(
        browserBinding,
        { assetOrigin: "https://studio.test" },
      );
      const png = yield* renderer.renderPng(renderInput());

      expect(visitedUrl).toBe("https://studio.test/codemode-export-harness");
      expect(new Uint8Array(png)).toEqual(new Uint8Array([80, 78, 71]));
      expect(close).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("closes on a typed page failure", () =>
    Effect.gen(function* () {
      const close = vi.fn(async () => {});
      launchMock.mockResolvedValue({
        close,
        newPage: vi.fn(async () => {
          throw new Error("new page failed");
        }),
      } as unknown as Browser);

      const renderer =
        createCloudflareBrowserRunArtifactRenderer(browserBinding);
      const error = yield* Effect.flip(renderer.renderPng(renderInput()));

      assert.strictEqual(error._tag, "BrowserRenderingFailure");
      if (error._tag === "BrowserRenderingFailure") {
        assert.strictEqual(error.operation, "newPage");
      }
      expect(close).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("closes when scoped use defects", () =>
    Effect.gen(function* () {
      const close = vi.fn(async () => {});
      const browser = { close } as unknown as Browser;
      const exit = yield* Effect.exit(
        withScopedBrowserSession(Effect.succeed(browser), () =>
          Effect.die(new Error("render defect")),
        ),
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.isTrue(Cause.hasDies(exit.cause));
      }
      expect(close).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("times out with a typed failure and closes promptly", () =>
    Effect.gen(function* () {
      const waitStarted = Promise.withResolvers<void>();
      const close = vi.fn(async () => {});
      const page = {
        goto: vi.fn(async () => {}),
        waitForFunction: vi.fn(
          () =>
            new Promise<void>(() => {
              waitStarted.resolve();
            }),
        ),
        evaluate: vi.fn(),
      };
      launchMock.mockResolvedValue({
        close,
        newPage: vi.fn(async () => page),
      } as unknown as Browser);
      const renderer =
        createCloudflareBrowserRunArtifactRenderer(browserBinding);
      const fiber = yield* Effect.forkChild(renderer.renderPng(renderInput()));
      yield* Effect.promise(() => waitStarted.promise);
      yield* TestClock.adjust(BROWSER_RENDER_TIMEOUT_MS);
      const exit = yield* Fiber.await(fiber);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const failure = Cause.findError(exit.cause);
        assert.isTrue(failure._tag === "Success");
        if (failure._tag === "Success") {
          assert.strictEqual(failure.success._tag, "BrowserRenderingTimeout");
        }
      }
      expect(close).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("closes and releases the scope on interruption", () =>
    Effect.gen(function* () {
      const waitStarted = Promise.withResolvers<void>();
      const close = vi.fn(async () => {});
      const page = {
        goto: vi.fn(async () => {}),
        waitForFunction: vi.fn(
          () =>
            new Promise<void>(() => {
              waitStarted.resolve();
            }),
        ),
        evaluate: vi.fn(),
      };
      launchMock.mockResolvedValue({
        close,
        newPage: vi.fn(async () => page),
      } as unknown as Browser);
      const renderer =
        createCloudflareBrowserRunArtifactRenderer(browserBinding);
      const fiber = yield* Effect.forkChild(renderer.renderPng(renderInput()));
      yield* Effect.promise(() => waitStarted.promise);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.isTrue(Cause.hasInterrupts(exit.cause));
      }
      expect(close).toHaveBeenCalledWith({
        reason: "Code Mode PNG render interrupted",
      });
    }),
  );
});
