/**
 * Scenarios (Issue #95):
 * - Parse Excalidraw+ link-share URLs (`/l/<workspace>/<scene>`) via export service.
 * - Parse Excalidraw+ readonly URLs (`/readonly/<token>`) by extracting __NEXT_DATA__.
 * - Surface permission metadata derived from `linkSharing` (bitfield).
 *
 * Notes:
 * - These tests intentionally depend on upstream Excalidraw services.
 * - Keep the URLs stable; if they ever expire, refresh them in issue #95.
 */

import { describe, expect, test } from "vitest";
import { parseExcalidrawUrl } from "./lib/excalidrawShareLinks";

describe("Excalidraw+ URL parsing", () => {
  test("parses /l/<workspace>/<scene> and returns read-only permission for linkSharing=1", async () => {
    const result = await parseExcalidrawUrl(
      "https://link.excalidraw.com/l/9e01NdVniGv/40KFTlwYlBD"
    );

    expect(result.source).toBe("excalidraw-plus-link");
    if (result.source !== "excalidraw-plus-link") {
      throw new Error(`unexpected source: ${result.source}`);
    }
    expect(result.permission).toBe("read-only");
    expect(result.metadata.workspaceId).toBe("9e01NdVniGv");
    expect(result.metadata.sceneId).toBe("40KFTlwYlBD");
    expect(Array.isArray(result.payload.elements)).toBe(true);
    expect(result.payload.elements.length).toBeGreaterThan(0);
    expect(result.payload.appState).toBeTruthy();
  }, 20_000);

  test("parses app.excalidraw.com /l/<workspace>/<scene> and returns view-and-edit for linkSharing=3", async () => {
    const result = await parseExcalidrawUrl(
      "https://app.excalidraw.com/l/9e01NdVniGv/2EWXQ7ykXgY"
    );

    expect(result.source).toBe("excalidraw-plus-link");
    if (result.source !== "excalidraw-plus-link") {
      throw new Error(`unexpected source: ${result.source}`);
    }
    expect(result.permission).toBe("view-and-edit");
    expect(result.metadata.workspaceId).toBe("9e01NdVniGv");
    expect(result.metadata.sceneId).toBe("2EWXQ7ykXgY");
    expect(Array.isArray(result.payload.elements)).toBe(true);
    expect(result.payload.elements.length).toBeGreaterThan(0);
    expect(result.payload.appState).toBeTruthy();
  }, 20_000);

  test("parses /readonly/<token> via __NEXT_DATA__", async () => {
    const result = await parseExcalidrawUrl(
      "https://link.excalidraw.com/readonly/QSslwW7dHXMgR8eNDfTW"
    );

    expect(result.source).toBe("excalidraw-plus-readonly");
    if (result.source !== "excalidraw-plus-readonly") {
      throw new Error(`unexpected source: ${result.source}`);
    }
    expect(result.metadata.token).toBe("QSslwW7dHXMgR8eNDfTW");
    expect(Array.isArray(result.payload.elements)).toBe(true);
    expect(result.payload.elements.length).toBeGreaterThan(0);
    expect(result.payload.appState).toBeTruthy();

    // Stable for this public example.
    expect(result.payload.appState.viewBackgroundColor).toBe("#ffffff");
  }, 20_000);
});
