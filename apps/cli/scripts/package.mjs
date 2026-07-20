import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const run = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "../../..");
const packageDirectory = resolve(workspaceRoot, ".memory/cli-package");
const distributionDirectory = resolve(workspaceRoot, "apps/cli/dist");

await rm(packageDirectory, { force: true, recursive: true });
await mkdir(packageDirectory, { recursive: true });
await run(
  "npm",
  ["pack", distributionDirectory, "--pack-destination", packageDirectory],
  {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  },
);

const archives = (await readdir(packageDirectory)).filter((name) =>
  name.endsWith(".tgz"),
);
if (archives.length !== 1) {
  throw new Error(
    `Expected one CLI package archive, found ${String(archives.length)}.`,
  );
}
process.stdout.write(`${resolve(packageDirectory, archives[0])}\n`);
