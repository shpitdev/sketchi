/**
 * gemini-flash-lite sometimes welds the next JSON key onto the previous
 * string value inside tool-call args ("start-node,kind:", "pass,source:").
 * Strip those trailing key fragments so one sloppy generation doesn't
 * poison the whole attempt loop.
 */
const TRAILING_KEY_FRAGMENT =
  /[,;]\s*(?:id|label|kind|group|source|target|title|direction|nodes|edges)\s*:?\s*$/i;

export function cleanToolString(value: string): string {
  let cleaned = value.trim();
  for (;;) {
    const next = cleaned.replace(TRAILING_KEY_FRAGMENT, "").trim();
    if (next === cleaned) {
      return cleaned;
    }
    cleaned = next;
  }
}
