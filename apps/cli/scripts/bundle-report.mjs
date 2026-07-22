import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "../../..");
const distributionRoot = resolve(workspaceRoot, "apps/cli/dist");
const reportPath = resolve(workspaceRoot, ".memory/cli-bundle-report.json");
const javascriptPaths = (await readdir(distributionRoot, { recursive: true }))
  .filter((path) => path.endsWith(".js"))
  .sort();
const aggregateHash = createHash("sha256");
const files = [];
for (const path of javascriptPaths) {
  const absolutePath = resolve(distributionRoot, path);
  const bytes = await readFile(absolutePath);
  const compressed = await gzipAsync(bytes, { level: 9 });
  aggregateHash.update(path);
  aggregateHash.update("\0");
  aggregateHash.update(bytes);
  files.push({
    path,
    bytes: bytes.byteLength,
    gzipBytes: compressed.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const report = {
  path: relative(workspaceRoot, distributionRoot),
  bytes: files.reduce((total, file) => total + file.bytes, 0),
  gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
  sha256: aggregateHash.digest("hex"),
  entryBytes: files.find((file) => file.path === "sketchi.js")?.bytes,
  files,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report)}\n`);
