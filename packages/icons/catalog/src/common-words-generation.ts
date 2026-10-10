import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { SearchableIcon } from "./search.js";
import { termTokens } from "./text-match.js";

/**
 * SCOWL size 50 is the common-English cut: it holds "stream", "segment",
 * "render", and "google", but not "docker", "git", or "terraform", which name
 * the product far more often than anything else.
 */
export const COMMON_WORD_SIZES = [10, 20, 35, 40, 50] as const;
const DIALECTS = ["english", "american"] as const;

/** Lowercased common English words from the wordlist-english SCOWL lists. */
export function loadCommonEnglishWords(): Set<string> {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("wordlist-english/package.json"));
  const words = new Set<string>();
  for (const dialect of DIALECTS) {
    for (const size of COMMON_WORD_SIZES) {
      const list: unknown = JSON.parse(
        readFileSync(join(root, `${dialect}-words-${String(size)}.json`), "utf8"),
      );
      if (!Array.isArray(list)) {
        throw new Error(`wordlist-english ${dialect} ${String(size)} is invalid.`);
      }
      for (const word of list) {
        if (typeof word === "string") words.add(word.toLocaleLowerCase());
      }
    }
  }
  return words;
}

/**
 * The words of catalog slugs, names, and aliases that are common English.
 * Shipping only these keeps the runtime list to a few hundred words.
 */
export function catalogCommonWords(
  icons: readonly Pick<SearchableIcon, "aliases" | "name" | "slug">[],
  english: ReadonlySet<string>,
): string[] {
  const words = new Set<string>();
  for (const icon of icons) {
    for (const term of [icon.slug.replaceAll("-", " "), icon.name, ...icon.aliases]) {
      for (const token of termTokens(term)) {
        if (english.has(token)) words.add(token);
      }
    }
  }
  return [...words].sort();
}
