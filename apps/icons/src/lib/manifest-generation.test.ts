import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeIconManifest } from "./data";
import { searchIcons } from "./data";
import {
  buildIconCatalog,
  COLLISION_CANONICAL_COLLECTIONS,
} from "./manifest-generation";

function sourceIcon(slug: string, collection: string) {
  return {
    bytes: 100,
    collection,
    slug,
    urlPath: `/output/upload-ready/svg/${collection}/${slug}.svg`,
    viewBox: { height: 24, minX: 0, minY: 0, width: 24 },
  };
}

interface ReviewGroup {
  readonly distinctBaseSlugs: readonly string[];
  readonly groupKey?: string;
  readonly key?: string;
  readonly rasterHash?: string;
  readonly visualHash?: string;
}

interface ReviewIcon {
  readonly baseSlug: string;
  readonly flags: readonly string[];
  readonly nearSimilarityGroupKey: string | null;
  readonly perceptualHash: string;
  readonly rasterHash: string;
  readonly similarityGroupKey: string | null;
  readonly slug: string;
  readonly visualHash: string;
}

interface ReviewData {
  readonly icons: readonly ReviewIcon[];
  readonly nearSimilarityGroups: readonly ReviewGroup[];
  readonly rasterDuplicateGroups: readonly ReviewGroup[];
  readonly summary: {
    readonly flagCounts: Readonly<Record<string, number>>;
    readonly nearSimilarityGroupsCount: number;
    readonly rasterDuplicateGroupsCount: number;
    readonly visualDuplicateGroupsCount: number;
  };
  readonly visualDuplicateGroups: readonly ReviewGroup[];
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

  it("uses product names and search aliases for Palantir icons", () => {
    const catalog = buildIconCatalog({
      icons: [
        sourceIcon("aip-autopilot-app", "palantir"),
        sourceIcon("ontology-objecttype-app", "palantir"),
        sourceIcon("palantir-ontology", "palantir"),
        sourceIcon("palantir-pipeline", "palantir"),
        sourceIcon("palantir-workshop", "palantir"),
        sourceIcon("pipeline-builder-graph-app", "palantir"),
        sourceIcon("sddi-app", "palantir"),
        sourceIcon("workshop-module-app", "palantir"),
      ],
    });

    expect(
      Object.fromEntries(
        catalog.manifest.icons.map(({ name, slug }) => [slug, name]),
      ),
    ).toMatchObject({
      "aip-autopilot-app": "AIP Autopilot App",
      "ontology-objecttype-app": "Ontology Object Type App",
      "palantir-ontology": "Ontology",
      "palantir-pipeline": "Pipeline Builder",
      "palantir-workshop": "Workshop",
      "sddi-app": "SDDI App",
    });
    expect(
      searchIcons(catalog.manifest.icons, { query: "ontology" })[0]?.icon.slug,
    ).toBe("palantir-ontology");
    expect(
      searchIcons(catalog.manifest.icons, { query: "pipeline builder" })[0]
        ?.icon.slug,
    ).toBe("palantir-pipeline");
    expect(
      searchIcons(catalog.manifest.icons, { query: "workshop" })[0]?.icon.slug,
    ).toBe("palantir-workshop");
  });

  it("accounts for promoted Palantir glyph pairs in review aggregates", () => {
    const path = resolve(
      process.cwd(),
      "apps/icons/pipeline-output/review/review-data.json",
    );
    const review = JSON.parse(readFileSync(path, "utf8")) as ReviewData;
    const flagCounts = review.icons
      .flatMap(({ flags }) => flags)
      .reduce<Record<string, number>>((counts, flag) => {
        counts[flag] = (counts[flag] ?? 0) + 1;
        return counts;
      }, {});

    expect(review.summary.flagCounts).toEqual(flagCounts);
    expect(review.summary.visualDuplicateGroupsCount).toBe(
      review.visualDuplicateGroups.length,
    );
    expect(review.summary.rasterDuplicateGroupsCount).toBe(
      review.rasterDuplicateGroups.length,
    );
    expect(review.summary.nearSimilarityGroupsCount).toBe(
      review.nearSimilarityGroups.length,
    );

    const pairs = [
      ["ontology-objecttype-app", "palantir-ontology"],
      ["pipeline-builder-graph-app", "palantir-pipeline"],
      ["workshop-module-app", "palantir-workshop"],
    ] as const;
    for (const [sourceSlug, canonicalSlug] of pairs) {
      const source = review.icons.find(({ slug }) => slug === sourceSlug);
      const canonical = review.icons.find(({ slug }) => slug === canonicalSlug);
      expect(source).toBeDefined();
      expect(canonical).toBeDefined();
      if (!source || !canonical) continue;

      expect(canonical).toMatchObject({
        flags: ["duplicate-raster", "duplicate-raster-cross-name"],
        nearSimilarityGroupKey: source.nearSimilarityGroupKey,
        perceptualHash: source.perceptualHash,
        rasterHash: source.rasterHash,
        similarityGroupKey: source.similarityGroupKey,
        visualHash: source.visualHash,
      });
      expect(
        review.visualDuplicateGroups.find(
          ({ visualHash }) => visualHash === source.visualHash,
        )?.distinctBaseSlugs,
      ).toEqual(expect.arrayContaining([source.baseSlug, canonical.baseSlug]));
      expect(
        review.rasterDuplicateGroups.find(
          ({ groupKey }) => groupKey === source.similarityGroupKey,
        )?.distinctBaseSlugs,
      ).toEqual(expect.arrayContaining([source.baseSlug, canonical.baseSlug]));
      expect(
        review.nearSimilarityGroups.find(
          ({ key }) => key === source.nearSimilarityGroupKey,
        )?.distinctBaseSlugs,
      ).toEqual(expect.arrayContaining([source.baseSlug, canonical.baseSlug]));
    }
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
