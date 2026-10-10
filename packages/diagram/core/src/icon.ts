/** Public icon-catalog slugs are lowercase kebab-case. */
export const DIAGRAM_ICON_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const DIAGRAM_ICON_SLUG_MAX_LENGTH = 64;

export function isDiagramIconSlug(value: string): boolean {
  return (
    value.length <= DIAGRAM_ICON_SLUG_MAX_LENGTH &&
    DIAGRAM_ICON_SLUG_PATTERN.test(value)
  );
}
