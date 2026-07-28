import type {
  IconManifest,
  SketchiIcon,
  SketchiIconViewBox,
} from "./data.js";

interface SourceIcon {
  readonly baseSlug?: string;
  readonly bytes: number;
  readonly collection: string;
  readonly slug: string;
  readonly urlPath: string;
  readonly variant?: string | null;
  readonly viewBox: SketchiIconViewBox;
}

interface SourceData {
  readonly generatedAt?: string;
  readonly icons: readonly SourceIcon[];
}

export interface GeneratedIconCatalog {
  readonly manifest: IconManifest;
  readonly sources: Readonly<Record<string, string>>;
}

export const COLLISION_CANONICAL_COLLECTIONS: Readonly<Record<string, string>> =
  {
    aihubmix: "ai-ecosystem",
    amp: "ai-apps-agents",
    anthos: "gcp",
    "cloud-run": "gcp",
    "cloud-spanner": "gcp",
    "cloud-sql": "gcp",
    "cloud-storage": "gcp",
    "compute-engine": "gcp",
    looker: "gcp",
    "security-command-center": "gcp",
    vertexai: "ai-infrastructure",
  };

const ALIASES_BY_BASE_SLUG: Readonly<Record<string, readonly string[]>> = {
  aws: ["amazon web services"],
  googlecloud: ["gcp", "google cloud"],
  kubernetes: ["k8s", "kube"],
  nextjs: ["next", "next.js"],
  postgresql: ["postgres", "psql", "postgres sql"],
  vercel: ["zeit"],
};

const NAME_BY_BASE_SLUG: Readonly<Record<string, string>> = {
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
};

const UPPERCASE_WORDS = new Set([
  "ai",
  "api",
  "aws",
  "cdn",
  "ci",
  "cli",
  "css",
  "db",
  "gcp",
  "gpu",
  "html",
  "http",
  "ide",
  "iot",
  "ip",
  "js",
  "json",
  "llm",
  "mcp",
  "ml",
  "os",
  "php",
  "sdk",
  "sql",
  "ssh",
  "svg",
  "ts",
  "ui",
  "url",
  "ux",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isViewBox(value: unknown): value is SketchiIconViewBox {
  return (
    isRecord(value) &&
    typeof value.height === "number" &&
    typeof value.minX === "number" &&
    typeof value.minY === "number" &&
    typeof value.width === "number"
  );
}

function isSourceIcon(value: unknown): value is SourceIcon {
  return (
    isRecord(value) &&
    typeof value.bytes === "number" &&
    typeof value.collection === "string" &&
    typeof value.slug === "string" &&
    typeof value.urlPath === "string" &&
    (value.baseSlug === undefined || typeof value.baseSlug === "string") &&
    (value.variant === undefined ||
      value.variant === null ||
      typeof value.variant === "string") &&
    isViewBox(value.viewBox)
  );
}

function decodeSourceData(value: unknown): SourceData {
  if (
    !isRecord(value) ||
    !Array.isArray(value.icons) ||
    !value.icons.every(isSourceIcon) ||
    (value.generatedAt !== undefined && typeof value.generatedAt !== "string")
  ) {
    throw new Error("Icon source data is invalid.");
  }
  return {
    ...(typeof value.generatedAt === "string"
      ? { generatedAt: value.generatedAt }
      : {}),
    icons: value.icons,
  };
}

function titleWord(word: string): string {
  if (UPPERCASE_WORDS.has(word)) {
    return word.toUpperCase();
  }
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

export function displayNameForSourceIcon(icon: SourceIcon): string {
  const baseSlug = icon.baseSlug ?? icon.slug.replace(/-text$/u, "");
  const baseName =
    NAME_BY_BASE_SLUG[baseSlug] ??
    baseSlug.split("-").filter(Boolean).map(titleWord).join(" ");
  return icon.variant === "text" || icon.slug.endsWith("-text")
    ? `${baseName} Wordmark`
    : baseName;
}

function publicSlugForIcon(
  icon: SourceIcon,
  collisions: ReadonlyMap<string, readonly SourceIcon[]>,
): string {
  const canonicalCollection = COLLISION_CANONICAL_COLLECTIONS[icon.slug];
  if (canonicalCollection) {
    return icon.collection === canonicalCollection
      ? icon.slug
      : `${icon.slug}-${icon.collection}`;
  }

  const collided = collisions.get(icon.slug);
  if (!collided || collided.length === 1) {
    return icon.slug;
  }

  throw new Error(
    `Choose a canonical collection for duplicate slug ${icon.slug}.`,
  );
}

function aliasesForIcon(
  icon: SourceIcon,
  publicSlug: string,
): readonly string[] {
  const baseSlug = icon.baseSlug ?? icon.slug.replace(/-text$/u, "");
  const seeded = ALIASES_BY_BASE_SLUG[baseSlug] ?? [];
  const curatedName = NAME_BY_BASE_SLUG[baseSlug];
  return Array.from(
    new Set(
      publicSlug === icon.slug
        ? [...seeded, ...(curatedName ? [curatedName] : [])]
        : [icon.slug, ...seeded, ...(curatedName ? [curatedName] : [])],
    ),
  ).sort();
}

function keywordsForIcon(icon: SourceIcon): readonly string[] {
  const baseSlug = icon.baseSlug ?? icon.slug.replace(/-text$/u, "");
  return Array.from(
    new Set([
      ...baseSlug.split("-"),
      ...(icon.variant ? [icon.variant, "wordmark"] : []),
    ]),
  ).sort();
}

export function buildIconCatalog(value: unknown): GeneratedIconCatalog {
  const sourceData = decodeSourceData(value);
  const collisions = new Map<string, SourceIcon[]>();
  for (const icon of sourceData.icons) {
    const current = collisions.get(icon.slug) ?? [];
    current.push(icon);
    collisions.set(icon.slug, current);
  }

  const sources: Record<string, string> = {};
  const icons: SketchiIcon[] = sourceData.icons.map((icon) => {
    const slug = publicSlugForIcon(icon, collisions);
    if (sources[slug]) {
      throw new Error(`Generated public slug ${slug} is not unique.`);
    }
    sources[slug] = icon.urlPath;
    return {
      aliases: aliasesForIcon(icon, slug),
      bytes: icon.bytes,
      collection: icon.collection,
      keywords: keywordsForIcon(icon),
      name: displayNameForSourceIcon(icon),
      slug,
      svgPath: icon.urlPath,
      ...(icon.variant ? { variant: icon.variant } : {}),
      viewBox: icon.viewBox,
    };
  });

  icons.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.slug.localeCompare(right.slug),
  );
  const collectionCounts: Record<string, number> = {};
  for (const icon of icons) {
    collectionCounts[icon.collection] =
      (collectionCounts[icon.collection] ?? 0) + 1;
  }

  return {
    manifest: {
      ...(sourceData.generatedAt
        ? { generatedAt: sourceData.generatedAt }
        : {}),
      icons,
      summary: {
        collectionCounts,
        totalIcons: icons.length,
      },
      version: 1,
    },
    sources,
  };
}
