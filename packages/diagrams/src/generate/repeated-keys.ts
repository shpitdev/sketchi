/**
 * Keys that repeat inside one object of a JSON text, by path ("diagram.nodes.review"), in the
 * order they repeat. JSON.parse keeps only a repeated key's last value, so a flowchart that names
 * two steps by one id would silently lose the first. Reads the first value in the text, as
 * extractJsonObject does; it expects JSON that already parsed.
 */
export function repeatedJsonKeys(text: string): string[] {
	const repeated: string[] = [];
	let at = text.indexOf("{");
	if (at < 0) return repeated;

	const skipSpace = () => {
		while (at < text.length && /\s/u.test(text[at] ?? "")) at += 1;
	};
	const readString = (): string => {
		let value = "";
		at += 1;
		while (at < text.length) {
			const character = text[at] ?? "";
			at += 1;
			if (character === '"') return value;
			if (character !== "\\") {
				value += character;
				continue;
			}
			const escaped = text[at] ?? "";
			at += 1;
			if (escaped === "u") {
				value += String.fromCharCode(Number.parseInt(text.slice(at, at + 4), 16));
				at += 4;
			} else {
				value += { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[escaped] ?? escaped;
			}
		}
		return value;
	};
	const readValue = (path: string): void => {
		skipSpace();
		const opening = text[at];
		if (opening === "{") {
			at += 1;
			const keys = new Set<string>();
			skipSpace();
			if (text[at] === "}") {
				at += 1;
				return;
			}
			while (at < text.length) {
				skipSpace();
				const key = readString();
				const keyPath = path ? `${path}.${key}` : key;
				if (keys.has(key)) repeated.push(keyPath);
				keys.add(key);
				skipSpace();
				at += 1; // the colon
				readValue(keyPath);
				skipSpace();
				const separator = text[at];
				at += 1;
				if (separator !== ",") return;
			}
			return;
		}
		if (opening === "[") {
			at += 1;
			skipSpace();
			if (text[at] === "]") {
				at += 1;
				return;
			}
			for (let index = 0; at < text.length; index += 1) {
				readValue(`${path}[${index}]`);
				skipSpace();
				const separator = text[at];
				at += 1;
				if (separator !== ",") return;
			}
			return;
		}
		if (opening === '"') {
			readString();
			return;
		}
		while (at < text.length && !/[\s,\]}]/u.test(text[at] ?? "")) at += 1;
	};

	readValue("");
	return repeated;
}
