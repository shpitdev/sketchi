import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BannerPlugin,
  DefinePlugin,
  IgnorePlugin,
  optimize,
  rspack,
} from "@rspack/core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const outputDirectory = resolve(projectRoot, "dist");

const { version } = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8"),
);
const readme = await readFile(resolve(projectRoot, "README.md"), "utf8");
const thirdPartyNotices = await readFile(
  resolve(projectRoot, "THIRD_PARTY_NOTICES"),
  "utf8",
);
const resvgWasm = await readFile(
  resolve(projectRoot, "node_modules/@resvg/resvg-wasm/index_bg.wasm"),
);
const excalifontDirectory = resolve(
  projectRoot,
  "node_modules/@excalidraw/excalidraw/dist/prod/fonts/Excalifont",
);
const excalifontFiles = [
  "Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2",
  "Excalifont-Regular-be310b9bcd4f1a43f571c46df7809174.woff2",
  "Excalifont-Regular-b9dcf9d2e50a1eaf42fc664b50a3fd0d.woff2",
  "Excalifont-Regular-41b173a47b57366892116a575a43e2b6.woff2",
  "Excalifont-Regular-3f2c5db56cc93c5a6873b1361d730c16.woff2",
  "Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2",
  "Excalifont-Regular-623ccf21b21ef6b3a0d87738f77eb071.woff2",
];
const excalifontBase64 = await Promise.all(
  excalifontFiles.map(async (file) =>
    (await readFile(resolve(excalifontDirectory, file))).toString("base64"),
  ),
);

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
    chunkFilename: "chunks/[name].[contenthash].js",
    module: true,
    chunkFormat: "module",
    library: { type: "module" },
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
    extensionAlias: { ".js": [".ts", ".js"] },
    alias: {
      "@excalidraw/excalidraw": resolve(
        projectRoot,
        "node_modules/@excalidraw/excalidraw/dist/dev/index.js",
      ),
    },
  },
  module: {
    rules: [
      {
        test: /\.m?js$/u,
        resolve: { fullySpecified: false },
      },
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
    new DefinePlugin({
      __SKETCHI_EXCALIFONT_BASE64__: JSON.stringify(excalifontBase64),
      __SKETCHI_RESVG_WASM_BASE64__: JSON.stringify(
        resvgWasm.toString("base64"),
      ),
      __SKETCHI_VERSION__: JSON.stringify(version),
    }),
    new IgnorePlugin({ resourceRegExp: /^canvas$/u }),
    new optimize.LimitChunkCountPlugin({ maxChunks: 2 }),
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
  version,
  description:
    "Local Sketchi authoring CLI: offline flowchart and mindmap workflows plus one unauthenticated prompt-assisted generate command.",
  keywords: ["sketchi", "diagram", "flowchart", "mindmap", "excalidraw", "cli"],
  homepage: "https://sketchi.app",
  repository: {
    type: "git",
    url: "git+https://github.com/shpitdev/sketchi.git",
    directory: "apps/cli",
  },
  bugs: { url: "https://github.com/shpitdev/sketchi/issues" },
  license: "MIT",
  thirdPartyNotices: "THIRD_PARTY_NOTICES",
  author: "SHPIT LLC",
  type: "module",
  bin: { sketchi: "./sketchi.js" },
  files: ["sketchi.js", "chunks", "README.md", "THIRD_PARTY_NOTICES"],
  engines: { node: ">=24.13.0" },
  publishConfig: { access: "public" },
};

await writeFile(
  resolve(outputDirectory, "package.json"),
  `${JSON.stringify(packageManifest, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
await writeFile(resolve(outputDirectory, "README.md"), readme, {
  encoding: "utf8",
  mode: 0o600,
});
await writeFile(
  resolve(outputDirectory, "THIRD_PARTY_NOTICES"),
  thirdPartyNotices,
  { encoding: "utf8", mode: 0o600 },
);
await chmod(resolve(outputDirectory, "sketchi.js"), 0o755);

const details = stats.toJson({ assets: true });
const javascriptAssets = (details.assets ?? []).filter((asset) =>
  asset.name.endsWith(".js"),
);
const bytes = javascriptAssets.reduce(
  (total, asset) => total + (asset.size ?? 0),
  0,
);
const maximumPublishedJavascriptBytes = 20_000_000;
if (bytes > maximumPublishedJavascriptBytes) {
  throw new Error(
    `Published JavaScript is ${String(bytes)} bytes, exceeding the ${String(maximumPublishedJavascriptBytes)} byte budget.`,
  );
}
process.stdout.write(
  `built ${String(javascriptAssets.length)} CLI JavaScript files (${String(bytes)} bytes total)\n`,
);
