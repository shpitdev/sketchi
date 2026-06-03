import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";

import { resolveExcalidrawFromShareUrl } from "./resolve-share-url.js";

function readHeader(
  headers: RequestInit["headers"],
  name: string
): string | null {
  if (!headers) {
    return null;
  }
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (Array.isArray(headers)) {
    const found = headers.find(
      ([key]) => key.toLowerCase() === name.toLowerCase()
    );
    return found ? found[1] : null;
  }
  const record = headers as Record<string, string>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return value;
    }
  }
  return null;
}

describe("resolveExcalidrawFromShareUrl", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolveClose, rejectClose) => {
      server?.close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    });
    server = null;
  });

  test("uses Sketchi /api/diagrams/parse and forwards x-trace-id", async () => {
    const seen: {
      url?: string;
      headers?: Headers;
      method?: string;
    } = {};

    server = createServer((request, response) => {
      seen.url = `http://${request.headers.host}${request.url ?? ""}`;
      seen.headers = new Headers(request.headers as Record<string, string>);
      seen.method = request.method ?? "";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          elements: [{ id: "b" }],
          appState: { theme: "light" },
        })
      );
    });
    await new Promise<void>((resolveListen) => {
      server?.listen(0, "127.0.0.1", resolveListen);
    });
    const port = (server.address() as AddressInfo).port;

    const result = await resolveExcalidrawFromShareUrl({
      shareUrl: "https://excalidraw.com/#json=abc,def",
      apiBase: `http://127.0.0.1:${port}`,
      traceId: "trace-2",
    });

    expect(seen.method).toBe("GET");
    expect(seen.url).toContain("/api/diagrams/parse?");
    expect(seen.url).toContain("shareUrl=");
    expect(readHeader(seen.headers, "x-trace-id")).toBe("trace-2");
    expect(result.elements).toEqual([{ id: "b" }]);
    expect(result.appState).toEqual({ theme: "light" });
  });
});
