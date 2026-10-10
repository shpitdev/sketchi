import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Excalidraw resolves every font face against `window.EXCALIDRAW_ASSET_PATH`
 * (set to "/" by `loadExcalidraw` in diagram-ui) and falls back to esm.sh only
 * when that URL fails. This plugin makes "/fonts/<Family>/<file>" resolve on
 * every surface that renders Excalidraw: it serves the installed package's
 * font files in dev and emits them into the client build, so the CDN fallback
 * is never used.
 *
 * Files a surface already ships in its public directory (the vendored
 * Excalifont subsets, byte-identical to the package's) are left to that copy.
 */
const FONT_URL_PREFIX = "/fonts/";

const diagramUi = createRequire(
  new URL("../../packages/diagram/ui/package.json", import.meta.url),
);

export function excalidrawFontsDirectory() {
  // Resolve through diagram-ui, which owns the Excalidraw dependency.
  return join(dirname(diagramUi.resolve("@excalidraw/excalidraw")), "fonts");
}

/** Font files relative to the fonts directory, e.g. "Xiaolai/Xiaolai-Regular-<hash>.woff2". */
export function excalidrawFontFiles(directory = excalidrawFontsDirectory()) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".woff2"))
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(directory.length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();
}

/** @returns {import("vite").Plugin} */
export function excalidrawFonts() {
  const directory = excalidrawFontsDirectory();
  const files = new Set(excalidrawFontFiles(directory));
  let publicDirectory = "";

  return {
    name: "sketchi:excalidraw-fonts",
    configResolved(config) {
      publicDirectory = config.publicDir;
    },
    configureServer(server) {
      server.middlewares.use(FONT_URL_PREFIX, (request, response, next) => {
        const file = decodeURIComponent(
          (request.url ?? "").split("?")[0] ?? "",
        ).replace(/^\/+/, "");
        if (!files.has(file)) {
          next();
          return;
        }
        response.setHeader("content-type", "font/woff2");
        createReadStream(join(directory, file)).pipe(response);
      });
    },
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    generateBundle() {
      for (const file of files) {
        const fileName = `fonts/${file}`;
        if (publicDirectory && existsSync(join(publicDirectory, fileName))) {
          continue;
        }
        this.emitFile({
          type: "asset",
          fileName,
          source: readFileSync(join(directory, file)),
        });
      }
    },
  };
}
