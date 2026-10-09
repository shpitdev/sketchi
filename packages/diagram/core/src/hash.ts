type HashTraversal = "characters" | "utf16";

export function fnv1a32(
  text: string,
  format: "seed",
  traversal?: HashTraversal,
): number;
export function fnv1a32(
  text: string,
  format: "hex",
  traversal?: HashTraversal,
): string;
/**
 * One FNV-1a loop for deterministic checksums and positive Excalidraw seeds.
 * Character traversal hashes the first UTF-16 unit of each character, matching
 * existing SVG/element identities. Library checksums hash every UTF-16 unit.
 */
export function fnv1a32(
  text: string,
  format: "hex" | "seed",
  traversal: HashTraversal = "characters",
): string | number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
    if (traversal === "characters" && (text.codePointAt(index) ?? 0) > 0xffff) {
      index += 1;
    }
  }
  return format === "seed"
    ? Math.abs(hash) || 1
    : (hash >>> 0).toString(16).padStart(8, "0");
}
