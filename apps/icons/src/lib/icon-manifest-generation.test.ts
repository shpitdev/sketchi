import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeIconManifest } from "./icon-data";
import { searchIcons } from "./icon-data";
import {
  buildIconCatalog,
  COLLISION_CANONICAL_COLLECTIONS,
} from "./icon-manifest-generation";

function sourceIcon(slug: string, collection: string) {
  return {
    bytes: 100,
    collection,
    slug,
    urlPath: `/output/upload-ready/svg/${collection}/${slug}.svg`,
    viewBox: { height: 24, minX: 0, minY: 0, width: 24 },
  };
}

describe("public icon manifest generation", () => {
  it("keeps an explicit canonical collision slug and qualifies alternates", () => {
    const catalog = buildIconCatalog({
      icons: [sourceIcon("anthos", "gcp-legacy"), sourceIcon("anthos", "gcp")],
    });
    expect(
      catalog.manifest.icons.map((icon) => [icon.slug, icon.collection]),
    ).toEqual([
      ["anthos", "gcp"],
      ["anthos-gcp-legacy", "gcp-legacy"],
    ]);
    expect(catalog.manifest.icons[1]?.aliases).toContain("anthos");
  });

  it("fails closed when a new collision has no product decision", () => {
    expect(() =>
      buildIconCatalog({
        icons: [
          sourceIcon("new-duplicate", "one"),
          sourceIcon("new-duplicate", "two"),
        ],
      }),
    ).toThrow("Choose a canonical collection");
  });

  it("keeps explicit alternate collision slugs stable after source removal", () => {
    const alternateOnly = buildIconCatalog({
      icons: [sourceIcon("anthos", "gcp-legacy")],
    });
    expect(alternateOnly.manifest.icons[0]?.slug).toBe("anthos-gcp-legacy");

    const canonicalOnly = buildIconCatalog({
      icons: [sourceIcon("anthos", "gcp")],
    });
    expect(canonicalOnly.manifest.icons[0]?.slug).toBe("anthos");
  });

  it("keeps collection-only tokens below semantic slug matches", () => {
    const catalog = buildIconCatalog({
      icons: [
        sourceIcon("postgresql", "data-storage"),
        sourceIcon("cloud-storage", "gcp"),
      ],
    });
    expect(
      searchIcons(catalog.manifest.icons, { query: "storage" }).map(
        ({ icon, rank }) => [icon.slug, rank],
      ),
    ).toEqual([
      ["cloud-storage", 3],
      ["postgresql", 4],
    ]);
    expect(
      catalog.manifest.icons.find((icon) => icon.slug === "postgresql")
        ?.keywords,
    ).not.toContain("storage");
  });

  it("uses deliberate names and full-name aliases for curated product slugs", () => {
    const expectedNames = {
      adobefirefly: "Adobe Firefly",
      adobeillustrator: "Adobe Illustrator",
      affinitydesigner: "Affinity Designer",
      aihubmix: "AIHubMix",
      alibabacloud: "Alibaba Cloud",
      amznwebserv: "Amazon Web Services",
      aws: "AWS",
      baiducloud: "Baidu Cloud",
      cloudflare: "Cloudflare",
      claudecode: "Claude Code",
      codex: "Codex",
      digitalocean: "DigitalOcean",
      githubcopilot: "GitHub Copilot",
      googlecloud: "Google Cloud",
      kubernetes: "Kubernetes",
      lmstudio: "LM Studio",
      nextjs: "Next.js",
      nodejs: "Node.js",
      openai: "OpenAI",
      postgresql: "PostgreSQL",
      reactnative: "React Native",
      tailwindcss: "Tailwind CSS",
      vercel: "Vercel",
      vertexai: "Vertex AI",
      visualbasic: "Visual Basic",
      visualstudio: "Visual Studio",
      vscode: "Visual Studio Code",
    } as const;
    const catalog = buildIconCatalog({
      icons: Object.keys(expectedNames).map((slug) =>
        sourceIcon(slug, COLLISION_CANONICAL_COLLECTIONS[slug] ?? "products"),
      ),
    });

    expect(
      Object.fromEntries(
        catalog.manifest.icons.map(({ name, slug }) => [slug, name]),
      ),
    ).toEqual(expectedNames);

    for (const [slug, name] of Object.entries(expectedNames)) {
      expect(
        catalog.manifest.icons.find((icon) => icon.slug === slug)?.aliases,
      ).toContain(name);
    }
  });

  it("applies curated base names and aliases to wordmark variants", () => {
    const catalog = buildIconCatalog({
      icons: [
        {
          ...sourceIcon("claudecode-text", "ai-model-providers"),
          baseSlug: "claudecode",
          variant: "text",
        },
      ],
    });

    expect(catalog.manifest.icons[0]).toMatchObject({
      aliases: ["Claude Code"],
      name: "Claude Code Wordmark",
    });
  });

  it("ships a compact clean manifest with aliases and no review fields", () => {
    const path = resolve(
      process.cwd(),
      "apps/icons/public/icons-manifest.json",
    );
    const source = readFileSync(path, "utf8");
    const manifest = decodeIconManifest(JSON.parse(source));
    expect(manifest.summary.totalIcons).toBe(1412);
    expect(new Set(manifest.icons.map((icon) => icon.slug)).size).toBe(
      manifest.icons.length,
    );
    expect(
      manifest.icons.find((icon) => icon.slug === "kubernetes")?.aliases,
    ).toContain("k8s");
    expect(
      manifest.icons.find((icon) => icon.slug === "adobefirefly-text")?.name,
    ).toBe("Adobe Firefly Wordmark");
    expect(
      manifest.icons.find((icon) => icon.slug === "adobeillustrator")?.name,
    ).toBe("Adobe Illustrator");
    expect(
      manifest.icons.find((icon) => icon.slug === "affinitydesigner")?.name,
    ).toBe("Affinity Designer");
    expect(
      manifest.icons.find((icon) => icon.slug === "tailwindcss"),
    ).toMatchObject({ aliases: ["Tailwind CSS"], name: "Tailwind CSS" });
    expect(
      manifest.icons.find((icon) => icon.slug === "claudecode-text"),
    ).toMatchObject({
      aliases: ["Claude Code"],
      name: "Claude Code Wordmark",
    });
    expect(
      manifest.icons.find((icon) => icon.slug === "amznwebserv"),
    ).toMatchObject({
      aliases: ["Amazon Web Services"],
      name: "Amazon Web Services",
    });
    expect(
      searchIcons(manifest.icons, { query: "amazon web services" }).map(
        ({ icon }) => icon.slug,
      ),
    ).toEqual(["amznwebserv", "aws", "aws-text"]);
    const expectedFullNameMatches = {
      "adobe illustrator": ["adobeillustrator"],
      "affinity designer": ["affinitydesigner"],
      "amazon web services": ["amznwebserv", "aws", "aws-text"],
      "claude code": ["claudecode", "claudecode-text"],
      "tailwind css": ["tailwindcss"],
    } as const;
    for (const [fullName, expectedSlugs] of Object.entries(
      expectedFullNameMatches,
    )) {
      expect(
        searchIcons(manifest.icons, { query: fullName }).map(
          ({ icon }) => icon.slug,
        ),
      ).toEqual(expectedSlugs);
    }
    expect(source).not.toContain('"flags"');
    expect(source).not.toContain('"similarityGroupSize"');
    expect(Buffer.byteLength(source)).toBeLessThan(450_000);
  });
});
