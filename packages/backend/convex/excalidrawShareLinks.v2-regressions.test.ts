/**
 * Scenarios:
 * - Parses base64url-encoded V2 payloads without fetch fallback.
 * - Rejects truncated V2 chunk headers.
 * - Rejects chunk sizes that exceed remaining buffer.
 * - Rejects invalid encryption key lengths.
 */

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

interface FixtureParts {
  data: string;
  key: string;
}

const t = convexTest(schema, modules);
const shareLinksApi = api.excalidrawShareLinks;

const SHARE_URL_PATTERN = /#json=([^,]+),(.+)$/;

let fixture: FixtureParts;

beforeAll(async () => {
  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "test-fixtures",
    "v2-share-link.txt"
  );
  const fixtureUrl = (await readFile(fixturePath, "utf8")).trim();
  fixture = parseShareUrl(fixtureUrl);
});

function parseShareUrl(url: string): FixtureParts {
  const match = url.match(SHARE_URL_PATTERN);
  if (!(match?.[1] && match[2])) {
    throw new Error("Invalid Excalidraw share URL format");
  }
  return { data: match[1], key: match[2] };
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildShareUrl(data: string, key: string): string {
  return `https://excalidraw.com/#json=${data},${key}`;
}

test("parses base64url-encoded V2 payload", async () => {
  const base64UrlData = fixture.data
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const result = await t.action(shareLinksApi.parseShareLinkToElements, {
    url: buildShareUrl(base64UrlData, fixture.key),
  });

  expect(Array.isArray(result.elements)).toBe(true);
  expect(result.elements.length).toBeGreaterThan(0);
  expect(result.appState).toBeTruthy();
});

test("rejects truncated V2 chunk header", async () => {
  const truncated = new Uint8Array(6);
  new DataView(truncated.buffer).setUint32(0, 1);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(truncated);
  try {
    await expect(
      t.action(shareLinksApi.parseShareLinkToElements, {
        url: buildShareUrl("fake-id", fixture.key),
      })
    ).rejects.toThrow("V2 parsing failed: truncated chunk header");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects chunk size exceeding remaining buffer", async () => {
  const oversized = new Uint8Array(20);
  const view = new DataView(oversized.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 100);

  await expect(
    t.action(shareLinksApi.parseShareLinkToElements, {
      url: buildShareUrl(toBase64Url(oversized), fixture.key),
    })
  ).rejects.toThrow("V2 parsing failed: chunk size exceeds remaining buffer");
});

test("rejects invalid encryption key length", async () => {
  await expect(
    t.action(shareLinksApi.parseShareLinkToElements, {
      url: buildShareUrl(fixture.data, "AA"),
    })
  ).rejects.toThrow("Invalid encryption key length");
});
