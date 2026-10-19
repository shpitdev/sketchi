function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Mindmap topics, their labels and branches, in a scene or its Excalidraw encoding. */
const MINDMAP_ELEMENT = /^(?:node|label|edge):(?:topic|branch)-\d/;

/**
 * What the mindmap layout (#430) redraws: geometry, the central topic's
 * ellipse, label wrapping and size, branch colors, curves and groups.
 */
const LAYOUT_FIELDS = new Set([
	"x",
	"y",
	"width",
	"height",
	"points",
	"shape",
	"strokeColor",
	"strokeWidth",
	"fillColor",
	"fillStyle",
	"backgroundColor",
	"groupIds",
	"curved",
	"endArrowhead",
	"fontSize",
	"maxWidth",
	"lineHeight",
	"roundness",
	"elbowed",
	"fixedSegments",
	"startIsSpecial",
	"endIsSpecial",
	"index",
	"autoResize",
]);

const SHAPE_TYPES = new Set(["rectangle", "ellipse"]);
const words = (text) => (typeof text === "string" ? text.split(/\s+/).join(" ").trim() : text);
const ids = (list) =>
	Array.isArray(list)
		? list
				.map((entry) => (isRecord(entry) ? entry["id"] : entry))
				.toSorted((left, right) => String(left).localeCompare(String(right)))
				.join("\n")
		: list;
const bindingTarget = (binding) => (isRecord(binding) ? binding["elementId"] : binding);

/** Fields the layout may change only within limits: the same words, targets and members. */
function sameMeaning(key, value, frozen) {
	if (key === "type") return SHAPE_TYPES.has(value) && SHAPE_TYPES.has(frozen);
	if (key === "text" || key === "originalText" || key === "label")
		return words(value) === words(frozen);
	if (key === "startBinding" || key === "endBinding")
		return bindingTarget(value) === bindingTarget(frozen);
	if (key === "boundElements" || key === "zOrder") return ids(value) === ids(frozen);
	return LAYOUT_FIELDS.has(key);
}

function isMindmapElements(list) {
	return (
		Array.isArray(list) &&
		list.some((element) => isRecord(element) && MINDMAP_ELEMENT.test(String(element["id"])))
	);
}

function containsMindmap(value) {
	if (Array.isArray(value)) return isMindmapElements(value) || value.some(containsMindmap);
	if (isRecord(value)) return Object.values(value).some(containsMindmap);
	if (typeof value === "string" && value.includes('"node:topic-')) return true;
	return false;
}

/**
 * The mindmap layout (#430) redraws every mindmap: geometry, shapes, colors,
 * curves, label wrapping, element order and the sizes those change. Restore
 * those from the frozen capture for mindmap elements only, while ids, bindings,
 * endpoints, label words and every protocol field still compare exactly.
 * Renderer invariants and Excalidraw validation cover the new drawing.
 */
export function normalizeMindmapLayoutAgainstFrozen(value, frozen) {
	if (typeof value === "string" && typeof frozen === "string") {
		if (!value.includes('"node:topic-')) return value;
		try {
			return JSON.stringify(
				normalizeMindmapLayoutAgainstFrozen(JSON.parse(value), JSON.parse(frozen)),
			);
		} catch {
			return value;
		}
	}
	if (Array.isArray(value) && Array.isArray(frozen)) {
		if (isMindmapElements(value) && ids(value) === ids(frozen)) {
			return frozen.map((old) =>
				normalizeMindmapLayoutAgainstFrozen(
					value.find((element) => element["id"] === old["id"]),
					old,
				),
			);
		}
		return value.map((entry, index) => normalizeMindmapLayoutAgainstFrozen(entry, frozen[index]));
	}
	if (!isRecord(value) || !isRecord(frozen)) return value;
	const element = MINDMAP_ELEMENT.test(String(value["id"])) && value["id"] === frozen["id"];
	const drawing = isMindmapElements(value["elements"]);
	const restored = (key) =>
		(element && sameMeaning(key, value[key], frozen[key])) ||
		(drawing &&
			["width", "height", "zOrder"].includes(key) &&
			sameMeaning(key, value[key], frozen[key])) ||
		(key === "sizeBytes" && containsMindmap(value));
	const keys = [...new Set([...Object.keys(value), ...Object.keys(frozen)])];
	return Object.fromEntries(
		keys.flatMap((key) => {
			if (restored(key)) return Object.hasOwn(frozen, key) ? [[key, frozen[key]]] : [];
			if (!Object.hasOwn(value, key)) return [];
			if (key === "appState" && drawing && isRecord(value[key]) && isRecord(frozen[key]))
				return [[key, { ...value[key], zoom: frozen[key]["zoom"] }]];
			return [[key, normalizeMindmapLayoutAgainstFrozen(value[key], frozen[key])]];
		}),
	);
}
