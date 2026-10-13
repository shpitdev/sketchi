function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** The routing revision changes only arrow geometry and moves labels into explicit groups.
 * Preserve the frozen runtime/protocol receipts, comparing all non-routing fields exactly.
 * Renderer invariants and Excalidraw validation independently cover the new geometry.
 */
export function normalizeRoutingAgainstFrozen(value, frozen) {
	if (typeof value === "string" && typeof frozen === "string") {
		try {
			return JSON.stringify(normalizeRoutingAgainstFrozen(JSON.parse(value), JSON.parse(frozen)));
		} catch {
			return value;
		}
	}
	if (Array.isArray(value) && Array.isArray(frozen))
		return value.map((entry, index) => normalizeRoutingAgainstFrozen(entry, frozen[index]));
	if (!isRecord(value) || !isRecord(frozen)) return value;
	if (Array.isArray(value["elements"]) && Array.isArray(frozen["elements"])) {
		const current = value["elements"];
		const previous = frozen["elements"];
		const elements = current
			.filter((element) => {
				if (previous.some((old) => old["id"] === element["id"])) return true;
				const arrow = previous.find(
					(old) => old["type"] === "arrow" && `${String(old["id"])}:label` === element["id"],
				);
				return !(arrow && element["type"] === "text" && element["text"] === arrow["label"]);
			})
			.map((element) => {
				const old = previous.find((old) => old["id"] === element["id"]);
				if (!old) return element;
				const corrected = { ...element };
				const arrowLabel =
					element["type"] === "text" &&
					typeof old["containerId"] === "string" &&
					old["containerId"].startsWith("edge:");
				if (element["type"] === "arrow" || arrowLabel) {
					for (const key of [
						"points",
						"x",
						"y",
						"width",
						"height",
						"groupIds",
						"index",
						"boundElements",
						"containerId",
						"autoResize",
					]) {
						if (Object.hasOwn(old, key)) corrected[key] = old[key];
						else delete corrected[key];
					}
					if (element["type"] === "arrow" && typeof old["label"] === "string") {
						const label = current.find((label) => label["id"] === `${String(element["id"])}:label`);
						corrected["label"] = element["label"] ?? label?.["text"];
					}
				}
				return corrected;
			});
		// Excalidraw ordering is now explicit text-before-arrow, with the same semantic ids.
		elements.sort(
			(a, b) =>
				previous.findIndex((e) => e["id"] === a["id"]) -
				previous.findIndex((e) => e["id"] === b["id"]),
		);
		return { ...value, elements };
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [
			key,
			key === "sizeBytes" && value["format"] === "excalidraw"
				? frozen[key]
				: normalizeRoutingAgainstFrozen(entry, frozen[key]),
		]),
	);
}
