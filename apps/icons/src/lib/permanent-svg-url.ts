export function permanentSvgUrl(slug: string): string {
  const path = `/api/icons/${encodeURIComponent(slug)}.svg`;
  return typeof window === "undefined"
    ? `https://icons.sketchi.app${path}`
    : new URL(path, window.location.href).href;
}
