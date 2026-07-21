import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BannerPlugin, rspack } from "@rspack/core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const outputDirectory = resolve(projectRoot, "dist");

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

const compiler = rspack({
  context: resolve(projectRoot, "../.."),
  mode: "production",
  target: "node24",
  entry: resolve(projectRoot, "src/main.ts"),
  devtool: false,
  experiments: { outputModule: true },
  externalsPresets: { node: true },
  output: {
    path: outputDirectory,
    filename: "sketchi.js",
    module: true,
    chunkFormat: "module",
    library: { type: "module" },
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
    extensionAlias: { ".js": [".ts", ".js"] },
  },
  module: {
    rules: [
      {
        test: /\.ts$/u,
        exclude: /node_modules/u,
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: { syntax: "typescript" },
            target: "es2024",
          },
          module: { type: "es6" },
        },
      },
    ],
  },
  optimization: { minimize: true },
  plugins: [
    new BannerPlugin({
      banner: "#!/usr/bin/env node",
      raw: true,
      entryOnly: true,
    }),
  ],
});

const stats = await new Promise((resolveBuild, rejectBuild) => {
  compiler.run((error, result) => {
    compiler.close(() => undefined);
    if (error) {
      rejectBuild(error);
      return;
    }
    if (!result || result.hasErrors()) {
      rejectBuild(
        new Error(
          result?.toString({ colors: false, errors: true }) ??
            "Rspack returned no result.",
        ),
      );
      return;
    }
    resolveBuild(result);
  });
});

const packageManifest = {
  name: "sketchi",
  version: "0.0.0",
  description:
    "Local Sketchi authoring CLI: offline flowchart and mindmap workflows plus one unauthenticated prompt-assisted generate command.",
  keywords: [
    "sketchi",
    "diagram",
    "flowchart",
    "mindmap",
    "excalidraw",
    "cli",
  ],
  homepage: "https://sketchi.app",
  repository: {
    type: "git",
    url: "git+https://github.com/shpitdev/sketchi.git",
    directory: "apps/cli",
  },
  bugs: { url: "https://github.com/shpitdev/sketchi/issues" },
  license: "MIT",
  author: "SHPIT LLC",
  type: "module",
  bin: { sketchi: "./sketchi.js" },
  files: ["sketchi.js"],
  engines: { node: ">=24.13.0" },
  publishConfig: { access: "public" },
};

await writeFile(
  resolve(outputDirectory, "package.json"),
  `${JSON.stringify(packageManifest, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
await chmod(resolve(outputDirectory, "sketchi.js"), 0o755);

const details = stats.toJson({ assets: true });
const bytes = details.assets?.find(
  (asset) => asset.name === "sketchi.js",
)?.size;
process.stdout.write(
  `built apps/cli/dist/sketchi.js (${String(bytes ?? "unknown")} bytes)\n`,
);
