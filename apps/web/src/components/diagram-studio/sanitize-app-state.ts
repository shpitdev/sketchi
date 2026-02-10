// Excalidraw appState contains Map/Set instances (collaborators, followedBy)
// that Convex cannot serialize. Strip transient keys + convert Maps/Sets.

const TRANSIENT_KEYS_TO_STRIP = new Set([
  "collaborators",
  "followedBy",
  "selectedElementIds",
  "selectedGroupIds",
  "hoveredElementIds",
  "previousSelectedElementIds",
  "editingElement",
  "editingTextElement",
  "editingLinearElement",
  "editingGroupId",
  "resizingElement",
  "selectionElement",
  "multiElement",
  "newElement",
  "editingFrame",
  "draggingElement",
  "selectedLinearElement",
  "startBoundElement",
  "suggestedBindings",
  "elementsToHighlight",
  "frameToHighlight",
  "activeEmbeddable",
  "snapLines",
  "openDialog",
  "openMenu",
  "openPopup",
  "openSidebar",
  "contextMenu",
  "toast",
  "cursorButton",
  "selectedElementsAreBeingDragged",
  "isLoading",
  "isResizing",
  "isRotating",
  "isCropping",
  "croppingElementId",
  "fileHandle",
  "pendingImageElementId",
  "userToFollow",
  "searchMatches",
  "pasteDialog",
  "showHyperlinkPopup",
  "errorMessage",
  "scrolledOutside",
]);

function deepConvertToPlain(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) {
      obj[String(k)] = deepConvertToPlain(v);
    }
    return obj;
  }

  if (value instanceof Set) {
    return [...value].map(deepConvertToPlain);
  }

  if (Array.isArray(value)) {
    return value.map(deepConvertToPlain);
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = deepConvertToPlain(v);
    }
    return result;
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  return value;
}

export function sanitizeAppState(
  appState: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(appState)) {
    if (TRANSIENT_KEYS_TO_STRIP.has(key)) {
      continue;
    }
    sanitized[key] = deepConvertToPlain(value);
  }

  return sanitized;
}
