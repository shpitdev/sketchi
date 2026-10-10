import { cp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

// Node-logo SVGs ship as static assets, outside the Worker script size limit.
// The server's icon catalog reads them back through the ASSETS binding.
const appRoot = resolve(import.meta.dirname, "..");
const catalogRoot = dirname(
  createRequire(import.meta.url).resolve("@sketchi/icon-catalog/package.json"),
);
const target = resolve(appRoot, "public/node-logos");

await rm(target, { force: true, recursive: true });
await cp(resolve(catalogRoot, "dist/node-logos"), target, { recursive: true });

process.stdout.write("Published node logos into apps/playground/public.\n");
