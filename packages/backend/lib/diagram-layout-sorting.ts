import type { ArrowElement, ShapeElement } from "./diagram-structure";

function compareStringsDeterministic(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function sortShapes(shapes: ShapeElement[]): ShapeElement[] {
  return [...shapes].sort((a, b) =>
    compareStringsDeterministic(a.id, b.id)
  );
}

export function sortArrows(arrows: ArrowElement[]): ArrowElement[] {
  return [...arrows].sort((a, b) => {
    const from = compareStringsDeterministic(a.fromId, b.fromId);
    if (from !== 0) {
      return from;
    }
    const to = compareStringsDeterministic(a.toId, b.toId);
    if (to !== 0) {
      return to;
    }
    return compareStringsDeterministic(a.id, b.id);
  });
}
