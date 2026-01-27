import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const svgDir = join(__dirname, "..", "seed", "palantir-icons", "svgs");

const resolveConvexUrl = () =>
  process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

const convexUrl = resolveConvexUrl();

if (!convexUrl) {
  throw new Error(
    "Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL env var for seeding."
  );
}

const client = new ConvexHttpClient(convexUrl);

const slug = "palantir-icons";
const libraryName = "Palantir Icons";

const existing = await client.query(api.iconLibraries.getBySlug, { slug });

if (existing?.iconCount && existing.iconCount > 0) {
  console.log("Palantir icon library already seeded; skipping.");
  process.exit(0);
}

const libraryId =
  existing?.library?._id ??
  (await client.mutation(api.iconLibraries.create, {
    name: libraryName,
    slug,
    description: "Seeded Palantir icon library",
  }));

const existingIcons = new Set<string>();
if (existing?.library?._id) {
  const libraryData = await client.query(api.iconLibraries.get, {
    id: existing.library._id,
  });
  for (const icon of libraryData.icons) {
    existingIcons.add(icon.originalName);
  }
}

const entries = await readdir(svgDir, { withFileTypes: true });
const svgFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".svg"))
  .map((entry) => entry.name)
  .sort();

if (svgFiles.length === 0) {
  console.log("No SVGs found to seed.");
  process.exit(0);
}

for (const fileName of svgFiles) {
  if (existingIcons.has(fileName)) {
    console.log(`Skipping existing icon: ${fileName}`);
    continue;
  }

  const filePath = join(svgDir, fileName);
  const buffer = await readFile(filePath);

  const uploadUrl = await client.mutation(
    api.iconLibraries.generateUploadUrl,
    {}
  );
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "image/svg+xml" },
    body: buffer,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload ${fileName}.`);
  }

  const payload = (await response.json()) as { storageId: string };

  await client.action(api.iconLibrariesActions.addIcon, {
    libraryId,
    storageId: payload.storageId,
    originalName: fileName,
  });

  console.log(`Seeded icon: ${fileName}`);
}

console.log("Palantir icon library seeded.");
