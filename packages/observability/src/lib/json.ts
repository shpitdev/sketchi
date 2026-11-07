/** A value `JSON.stringify` writes back exactly. */
export type JsonValue =
	| boolean
	| null
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

const encoder = new TextEncoder();

function base64(bytes: Uint8Array): string {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

function binaryValue(bytes: Uint8Array): JsonValue {
	return { $binary: "base64", byteLength: bytes.byteLength, data: base64(bytes) };
}

type Container = JsonValue[] | Record<string, JsonValue>;

/** A value that is already JSON, or a container whose entries still need converting. */
type Converted =
	| { readonly json: JsonValue }
	| {
			readonly entries: ReadonlyArray<readonly [key: number | string, value: unknown]>;
			readonly source: object;
			readonly target: Container;
	  };

function ownEntries(object: object): Array<readonly [string, unknown]> {
	return Object.entries(object).filter(([, entry]) => entry !== undefined);
}

function convert(value: unknown, ancestors: ReadonlySet<object>): Converted {
	switch (typeof value) {
		case "string":
		case "boolean":
			return { json: value };
		case "number":
			return { json: Number.isFinite(value) ? value : String(value) };
		case "bigint":
			return { json: value.toString() };
		case "undefined":
			return { json: null };
		case "symbol":
			return { json: value.toString() };
		case "function":
			return { json: `[Function ${value.name || "anonymous"}]` };
		case "object":
			break;
	}
	if (value === null) return { json: null };
	const object: object = value;
	if (ancestors.has(object)) return { json: "[Circular]" };
	if (object instanceof Uint8Array) return { json: binaryValue(object) };
	if (object instanceof ArrayBuffer) return { json: binaryValue(new Uint8Array(object)) };
	if (ArrayBuffer.isView(object)) {
		return {
			json: binaryValue(new Uint8Array(object.buffer, object.byteOffset, object.byteLength)),
		};
	}
	if (object instanceof Date) {
		return { json: Number.isNaN(object.getTime()) ? "Invalid Date" : object.toISOString() };
	}
	if (object instanceof URL) return { json: object.href };
	if (object instanceof Headers) return { json: Object.fromEntries(object) };
	if (object instanceof Error) {
		const entries: Array<readonly [string, unknown]> = [
			["name", object.name],
			["message", object.message],
			...(object.stack ? [["stack", object.stack] as const] : []),
			...ownEntries(object),
		];
		if (object.cause !== undefined && !entries.some(([key]) => key === "cause")) {
			entries.push(["cause", object.cause]);
		}
		return { entries, source: object, target: {} };
	}
	if (Array.isArray(object)) {
		return {
			entries: object.map((entry, index) => [index, entry] as const),
			source: object,
			target: [],
		};
	}
	if (object instanceof Map) {
		return {
			entries: [...object].map(([key, entry]) => [String(key), entry] as const),
			source: object,
			target: {},
		};
	}
	if (object instanceof Set) {
		return {
			entries: [...object].map((entry, index) => [index, entry] as const),
			source: object,
			target: [],
		};
	}
	const toJSON = (object as { toJSON?: unknown }).toJSON;
	if (typeof toJSON === "function") {
		const replaced: unknown = toJSON.call(object);
		if (replaced !== object) return convert(replaced, ancestors);
	}
	return { entries: ownEntries(object), source: object, target: {} };
}

/**
 * Converts any value to one JSON can hold without losing what it says: errors keep
 * their stack and cause, binary data becomes base64, maps and sets become objects
 * and arrays, and a reference to an enclosing value becomes "[Circular]". It walks
 * the value without recursion, so nesting depth cannot overflow the stack.
 */
export function toJsonValue(value: unknown): JsonValue {
	const ancestors = new Set<object>();
	const root = convert(value, ancestors);
	if ("json" in root) return root.json;
	const stack = [{ ...root, index: 0 }];
	ancestors.add(root.source);
	while (stack.length > 0) {
		const frame = stack[stack.length - 1]!;
		const next = frame.entries[frame.index];
		if (!next) {
			stack.pop();
			ancestors.delete(frame.source);
			continue;
		}
		frame.index += 1;
		const [key, entry] = next;
		const converted = convert(entry, ancestors);
		const json = "json" in converted ? converted.json : converted.target;
		(frame.target as Record<number | string, JsonValue>)[key] = json;
		if (!("json" in converted)) {
			stack.push({ ...converted, index: 0 });
			ancestors.add(converted.source);
		}
	}
	return root.target;
}

export function utf8Length(text: string): number {
	return encoder.encode(text).byteLength;
}

/** The bytes `text`'s code unit at `index` adds inside a JSON string, and how many units it spans. */
function escapedCost(text: string, index: number): readonly [bytes: number, units: number] {
	const code = text.charCodeAt(index);
	if (code === 0x22 || code === 0x5c) return [2, 1];
	if (code < 0x20)
		return [
			code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6,
			1,
		];
	if (code < 0x80) return [1, 1];
	if (code < 0x800) return [2, 1];
	if (code >= 0xd800 && code <= 0xdbff) {
		const next = text.charCodeAt(index + 1);
		if (next >= 0xdc00 && next <= 0xdfff) return [4, 2];
		return [6, 1];
	}
	if (code >= 0xdc00 && code <= 0xdfff) return [6, 1];
	return [3, 1];
}

/**
 * The longest prefix of `text` from `start` whose JSON string encoding fits in
 * `budget` bytes. It never ends between the two halves of a surrogate pair.
 */
export function fittingPrefix(
	text: string,
	start: number,
	budget: number,
): { readonly bytes: number; readonly end: number } {
	let bytes = 0;
	let index = start;
	while (index < text.length) {
		const [cost, units] = escapedCost(text, index);
		if (bytes + cost > budget) break;
		bytes += cost;
		index += units;
	}
	return { bytes, end: index };
}
