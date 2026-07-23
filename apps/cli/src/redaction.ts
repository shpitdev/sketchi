const SHARE_BEARER_PATTERN =
  /(?:https:\/\/(?:www\.)?excalidraw\.com\/)?#json=[A-Za-z0-9_-]+,[A-Za-z0-9_-]{22,}/gu;

export const REDACTED_SHARE_LINK = "[redacted-share-link]";

export function redactShareLinks(value: string): string {
  return value.replace(SHARE_BEARER_PATTERN, REDACTED_SHARE_LINK);
}
