import type { convertSceneToExcalidraw } from "@sketchi/drawing/excalidraw";

export type ExportedElement = ReturnType<typeof convertSceneToExcalidraw>["elements"][number];

/** Line breaks the export inserted inside a Latin word or identifier of `original`. */
export function midWordBreaks(original: string, wrapped: string): string[] {
	const word = /[\p{L}\p{N}]/u;
	const wide = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u9fff\uac00-\ud7a3\uff00-\uff60]/u;
	const breaks: string[] = [];
	let index = 0;
	for (const char of wrapped.split("")) {
		if (char === "\n" && original[index] !== " " && original[index] !== "\n") {
			const [before, after] = [original[index - 1] ?? "", original[index] ?? ""];
			const camel = /\p{Ll}/u.test(before) && /\p{Lu}/u.test(after);
			if (word.test(before) && word.test(after) && !wide.test(before + after) && !camel)
				breaks.push(`${original.slice(0, index)}|${original.slice(index)}`);
			continue;
		}
		index += 1;
	}
	return breaks;
}
