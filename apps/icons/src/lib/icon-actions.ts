import { strToU8, zipSync } from "fflate";

import type { SketchiIcon } from "./icon-data.js";

function toCamelCase(value: string): string {
  return value.replace(/[-:]([a-z])/gu, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function jsxAttributeName(name: string): string {
  if (name === "class") return "className";
  if (name === "for") return "htmlFor";
  if (name.startsWith("aria-") || name.startsWith("data-")) return name;
  return toCamelCase(name);
}

function jsxStyle(value: string): string {
  const declarations = value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const separator = entry.indexOf(":");
      if (separator < 1) return [];
      const property = toCamelCase(entry.slice(0, separator).trim());
      const propertyValue = entry.slice(separator + 1).trim();
      return [`${property}: ${JSON.stringify(propertyValue)}`];
    });
  return `{{ ${declarations.join(", ")} }}`;
}

function serializeNode(node: Node, root: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text.includes("{") || text.includes("}")
      ? `{${JSON.stringify(text)}}`
      : text;
  }
  if (!(node instanceof Element)) {
    return "";
  }

  const attributes = Array.from(node.attributes).map((attribute) => {
    const name = jsxAttributeName(attribute.name);
    if (attribute.name === "style") {
      return `style=${jsxStyle(attribute.value)}`;
    }
    return `${name}=${JSON.stringify(attribute.value)}`;
  });
  if (root) attributes.push("{...props}");
  const opening = `<${node.tagName}${attributes.length ? ` ${attributes.join(" ")}` : ""}`;
  const children = Array.from(node.childNodes)
    .map((child) => serializeNode(child, false))
    .join("");
  return children
    ? `${opening}>${children}</${node.tagName}>`
    : `${opening} />`;
}

export function componentNameForIcon(icon: Pick<SketchiIcon, "name">): string {
  const words = icon.name.match(/[A-Za-z0-9]+/gu) ?? ["Sketchi"];
  const name = words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
  return /^\d/u.test(name) ? `Icon${name}` : `${name}Icon`;
}

export function svgToJsxComponent(svg: string, icon: SketchiIcon): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.querySelector("parsererror")) {
    throw new Error("SVG could not be converted to JSX.");
  }
  const name = componentNameForIcon(icon);
  const markup = serializeNode(document.documentElement, true);
  return [
    'import type { SVGProps } from "react";',
    "",
    `export function ${name}(props: SVGProps<SVGSVGElement>) {`,
    `  return (${markup});`,
    "}",
  ].join("\n");
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = fileName;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadSvg(svg: string, slug: string): void {
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${slug}.svg`);
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard copy failed.");
}

/**
 * Maps over items with at most `limit` tasks in flight. Bulk selection actions
 * can cover hundreds of icons, and an unbounded `Promise.all` would open that
 * many requests at once.
 *
 * The first failure stops the remaining workers from claiming new items, and
 * the rejection is only raised once every in-flight task has settled, so a
 * caller that resets its state on error is never racing leftover work.
 */
export async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  run: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = Array.from<Result>({ length: items.length });
  let cursor = 0;
  let failure: { readonly error: unknown } | undefined;
  async function worker(): Promise<void> {
    while (cursor < items.length && !failure) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      try {
        results[index] = await run(item, index);
      } catch (error) {
        failure ??= { error };
        return;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  if (failure) throw failure.error;
  return results;
}

export function createIconZip(
  icons: readonly { readonly slug: string; readonly svg: string }[],
): Promise<Blob> {
  return createIconZipBytes(icons).then((archive) => {
    const bytes = new Uint8Array(archive.byteLength);
    bytes.set(archive);
    return new Blob([bytes.buffer], { type: "application/zip" });
  });
}

export function createIconZipBytes(
  icons: readonly { readonly slug: string; readonly svg: string }[],
): Promise<Uint8Array> {
  const files = Object.fromEntries(
    icons.map((icon) => [`${icon.slug}.svg`, strToU8(icon.svg)]),
  );
  return Promise.resolve(zipSync(files, { level: 6 }));
}
