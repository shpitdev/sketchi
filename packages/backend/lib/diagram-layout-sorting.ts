import type { ArrowElement, ShapeElement } from "./diagram-structure";

export function sortShapes(shapes: ShapeElement[]): ShapeElement[] {
  return [...shapes].sort((a, b) => a.id.localeCompare(b.id));
}

export function sortArrows(arrows: ArrowElement[]): ArrowElement[] {
  return [...arrows].sort((a, b) => {
    const from = a.fromId.localeCompare(b.fromId);
    if (from !== 0) {
      return from;
    }
    const to = a.toId.localeCompare(b.toId);
    if (to !== 0) {
      return to;
    }
    return a.id.localeCompare(b.id);
  });
}
