const SELECTOR_SAFE_ID = /^[\w-]+$/u;

interface RenderElement {
  readonly id: string;
  readonly type: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Excalidraw's SVG export looks each image up as `#image-<element id>`, so an
 * id with selector syntax (such as `node:a:icon` in a hand-edited drawing)
 * makes the export throw. Give those images safe, unique ids for rendering
 * only, and follow every reference to them. Other elements are untouched.
 */
export function withSelectorSafeImageIds<Element extends RenderElement>(
  elements: readonly Element[],
): Element[] {
  const taken = new Set(elements.map((element) => element.id));
  const renamed = new Map<string, string>();
  for (const element of elements) {
    if (element.type !== "image" || SELECTOR_SAFE_ID.test(element.id)) continue;
    const base = element.id.replace(/[^\w-]/gu, "-");
    let id = base;
    for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
    taken.add(id);
    renamed.set(element.id, id);
  }
  if (renamed.size === 0) return [...elements];

  const rename = (value: unknown) =>
    typeof value === "string" ? (renamed.get(value) ?? value) : value;
  const renameBinding = (value: unknown) =>
    isRecord(value) ? { ...value, elementId: rename(value["elementId"]) } : value;
  return elements.map((element) => {
    const record = { ...element } as Record<string, unknown>;
    record["id"] = rename(element.id);
    if ("containerId" in record) record["containerId"] = rename(record["containerId"]);
    if ("frameId" in record) record["frameId"] = rename(record["frameId"]);
    if ("startBinding" in record) {
      record["startBinding"] = renameBinding(record["startBinding"]);
    }
    if ("endBinding" in record) {
      record["endBinding"] = renameBinding(record["endBinding"]);
    }
    if (Array.isArray(record["boundElements"])) {
      record["boundElements"] = record["boundElements"].map((bound: unknown) =>
        isRecord(bound) ? { ...bound, id: rename(bound["id"]) } : bound,
      );
    }
    return record as Element;
  });
}
