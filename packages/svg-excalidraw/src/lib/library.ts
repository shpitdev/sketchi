import type {
  ExcalidrawLibraryItemInput,
  SerializeExcalidrawLibraryOptions,
} from "./types";

const DEFAULT_LIBRARY_SOURCE = "https://sketchi.app";

/**
 * Serializes native elements as Excalidraw's v2 library format without loading
 * Excalidraw's browser bundle. Defaults are intentionally stable so identical
 * inputs produce byte-identical `.excalidrawlib` files in every runtime.
 */
export function serializeExcalidrawLibrary(
  items: readonly ExcalidrawLibraryItemInput[],
  options: SerializeExcalidrawLibraryOptions = {},
): string {
  const created = options.created ?? 1;
  const status = options.status ?? "published";
  const libraryItems = items.map((item) => ({
    id: item.id,
    status,
    elements: item.elements,
    created,
    ...(item.name === undefined ? {} : { name: item.name }),
  }));

  return JSON.stringify(
    {
      type: "excalidrawlib",
      version: 2,
      source: options.source ?? DEFAULT_LIBRARY_SOURCE,
      libraryItems,
    },
    null,
    2,
  );
}

export function deterministicLibraryChecksum(serialized: string): string {
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
