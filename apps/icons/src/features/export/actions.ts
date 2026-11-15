import { String as Str, Array as Arr, Record as Rec, Option as Opt, Schema } from "effect";
import { strToU8, zipSync } from "fflate";

import type { SketchiIcon } from "@sketchi/icon-catalog";

// @effect-diagnostics-next-line schemaSync:off -- JSX string quoting is a synchronous pure export over known strings.
const quote = Schema.encodeSync(Schema.fromJsonString(Schema.String));

function toCamelCase(value: string): string {
	// @effect-diagnostics-next-line preferEffectString:off -- Effect String.replace has no callable replacer for SVG attribute casing.
	return value.replace(/[-:]([a-z])/gu, (_, letter: string) => Str.toUpperCase(letter));
}

function jsxAttributeName(name: string): string {
	if (name === "class") return "className";
	if (name === "for") return "htmlFor";
	if (Str.startsWith("aria-")(name) || Str.startsWith("data-")(name)) return name;
	return toCamelCase(name);
}

function jsxStyle(value: string): string {
	const declarations = Arr.flatMap(
		Arr.filter(
			Arr.map(Str.split(value, ";"), (entry) => Str.trim(entry)),
			(entry) => entry.length > 0,
		),
		(entry: string) => {
			const separator = Opt.getOrElse(Str.indexOf(":")(entry), () => -1);
			if (separator < 1) return [];
			const property = toCamelCase(Str.trim(Str.slice(0, separator)(entry)));
			const propertyValue = Str.trim(Str.slice(separator + 1)(entry));
			return [`${property}: ${quote(propertyValue)}`];
		},
	);
	return `{{ ${Arr.join(declarations, ", ")} }}`;
}

function serializeNode(node: Node, root: boolean): string {
	if (node.nodeType === Node.TEXT_NODE) {
		const text = node.textContent ?? "";
		return Str.includes("{")(text) || Str.includes("}")(text) ? `{${quote(text)}}` : text;
	}
	if (!(node instanceof Element)) {
		return "";
	}

	const attributes = Arr.map(Array.from(node.attributes), (attribute) => {
		const name = jsxAttributeName(attribute.name);
		if (attribute.name === "style") {
			return `style=${jsxStyle(attribute.value)}`;
		}
		return `${name}=${quote(attribute.value)}`;
	});
	if (root) attributes.push("{...props}");
	const opening = `<${node.tagName}${attributes.length ? ` ${Arr.join(attributes, " ")}` : ""}`;
	const children = Arr.join(
		Arr.map(Array.from(node.childNodes), (child) => serializeNode(child, false)),
		"",
	);
	return children ? `${opening}>${children}</${node.tagName}>` : `${opening} />`;
}

export function componentNameForIcon(icon: Pick<SketchiIcon, "name">): string {
	const words = Opt.getOrElse(Str.match(/[A-Za-z0-9]+/gu)(icon.name), () => undefined) ?? [
		"Sketchi",
	];
	const name = Arr.join(
		Arr.map(
			words,
			(word) =>
				`${Str.toUpperCase(Opt.getOrElse(Str.charAt(word, 0), () => ""))}${Str.slice(1)(word)}`,
		),
		"",
	);
	return /^\d/u.test(name) ? `Icon${name}` : `${name}Icon`;
}

export function svgToJsxComponent(svg: string, icon: SketchiIcon): string {
	const document = new DOMParser().parseFromString(svg, "image/svg+xml");
	if (document.querySelector("parsererror")) {
		throw new Error("SVG could not be converted to JSX.");
	}
	const name = componentNameForIcon(icon);
	const markup = serializeNode(document.documentElement, true);
	return Arr.join(
		[
			'import type { SVGProps } from "react";',
			"",
			`export function ${name}(props: SVGProps<SVGSVGElement>) {`,
			`  return (${markup});`,
			"}",
		],
		"\n",
	);
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

/**
 * Copy text, possibly still being prepared. A pending value is written as a
 * promise-backed ClipboardItem started inside the click, so the browser keeps
 * the click's permission while the text resolves.
 */
// @effect-diagnostics-next-line asyncFunction:off -- ClipboardItem consumes a native Promise during user activation; the caller atom owns completion and interruption.
export async function copyText(pending: string | Promise<string>): Promise<void> {
	if (
		typeof pending !== "string" &&
		navigator.clipboard?.write &&
		typeof ClipboardItem === "function"
	) {
		await navigator.clipboard.write([
			new ClipboardItem({
				"text/plain": pending.then((text) => new Blob([text], { type: "text/plain" })),
			}),
		]);
		return;
	}
	const value = await pending;
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

export function createIconZip(
	icons: readonly { readonly slug: string; readonly svg: string }[],
): Blob {
	return new Blob([createIconZipBytes(icons)], { type: "application/zip" });
}

export function createIconZipBytes(
	icons: readonly { readonly slug: string; readonly svg: string }[],
): Uint8Array<ArrayBuffer> {
	const files = Rec.fromEntries(Arr.map(icons, (icon) => [`${icon.slug}.svg`, strToU8(icon.svg)]));
	return zipSync(files, { level: 6 });
}
