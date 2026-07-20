import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "../../..");
const bundlePath = resolve(workspaceRoot, "apps/cli/dist/sketchi.js");
const reportPath = resolve(workspaceRoot, ".memory/cli-bundle-report.json");
const bundle = await readFile(bundlePath);
const compressed = await gzipAsync(bundle, { level: 9 });
const report = {
  path: "apps/cli/dist/sketchi.js",
  bytes: bundle.byteLength,
  gzipBytes: compressed.byteLength,
  sha256: createHash("sha256").update(bundle).digest("hex"),
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report)}\n`);
