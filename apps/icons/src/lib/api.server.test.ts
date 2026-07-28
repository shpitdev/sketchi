// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  handleIconDetailRequest,
  handleIconDetailHeadRequest,
  handleIconSearchRequest,
  handleRawIconRequest,
  parseIconLimit,
} from "./api.server";

describe("icon HTTP API", () => {
  it("returns ranked alias matches with stable agent URLs", async () => {
    const response = handleIconSearchRequest(
      new Request("https://icons.sketchi.app/api/icons?q=k8s&limit=5"),
    );
    const payload: unknown = await response.json();
    expect(payload).toMatchObject({
      count: 1,
      query: "k8s",
      results: [
        {
          detailUrl: "https://icons.sketchi.app/api/icons/kubernetes",
          name: "Kubernetes",
          slug: "kubernetes",
          svgUrl: "https://icons.sketchi.app/api/icons/kubernetes.svg",
        },
      ],
      total: 1,
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("keeps duplicate source slugs deterministic and addressable", async () => {
    const sourceLoader = async () => "<svg />";
    const canonical = await handleIconDetailRequest(
      new Request("https://icons.test/api/icons/anthos"),
      "anthos",
      sourceLoader,
    );
    const alternate = await handleIconDetailRequest(
      new Request("https://icons.test/api/icons/anthos-gcp-legacy"),
      "anthos-gcp-legacy",
      sourceLoader,
    );
    await expect(canonical.json()).resolves.toMatchObject({
      collection: "gcp",
    });
    await expect(alternate.json()).resolves.toMatchObject({
      collection: "gcp-legacy",
      slug: "anthos-gcp-legacy",
    });
  });

  it("returns inline JSON SVG and a raw SVG response", async () => {
    const sourceLoader = async () => '<svg viewBox="0 0 24 24" />';
    const request = new Request("https://icons.test/api/icons/postgresql");
    const detail = await handleIconDetailRequest(
      request,
      "postgresql",
      sourceLoader,
    );
    await expect(detail.json()).resolves.toMatchObject({
      name: "PostgreSQL",
      slug: "postgresql",
      svg: '<svg viewBox="0 0 24 24" />',
    });

    const raw = await handleRawIconRequest(
      new Request("https://icons.test/api/icons/postgresql.svg"),
      "postgresql",
      sourceLoader,
    );
    expect(raw.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(raw.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(raw.text()).resolves.toBe('<svg viewBox="0 0 24 24" />');
  });

  it("caps result limits and returns stable 404s", async () => {
    expect(parseIconLimit("500")).toBe(100);
    expect(parseIconLimit("bad")).toBe(50);
    const response = await handleRawIconRequest(
      new Request("https://icons.test/api/icons/missing.svg"),
      "missing",
      async () => "<svg />",
    );
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Icon not found.");
  });

  it("returns method and CORS headers for non-SVG HEAD requests", () => {
    const response = handleIconDetailHeadRequest();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "HEAD",
    );
  });
});
