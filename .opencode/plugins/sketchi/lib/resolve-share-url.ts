import { parseExcalidrawShareLink } from "@sketchi/shared";
import { fetchJson } from "./api";

type ParseShareLink = typeof parseExcalidrawShareLink;
type FetchJson = typeof fetchJson;

export type ResolveShareUrlDeps = {
  parseShareLink?: ParseShareLink;
  fetchJson?: FetchJson;
};

export function isJsonShareUrl(url: string): boolean {
  return url.includes("#json=");
}

export async function resolveExcalidrawFromShareUrl(input: {
  shareUrl: string;
  apiBase: string;
  traceId?: string;
  abort?: AbortSignal;
  deps?: ResolveShareUrlDeps;
}): Promise<{ elements: Record<string, unknown>[]; appState: Record<string, unknown> }> {
  const parseShareLink = input.deps?.parseShareLink ?? parseExcalidrawShareLink;
  const fetchJsonImpl = input.deps?.fetchJson ?? fetchJson;

  if (isJsonShareUrl(input.shareUrl)) {
    const parsed = await parseShareLink(input.shareUrl);
    return {
      elements: parsed.elements as Record<string, unknown>[],
      appState: parsed.appState ?? {},
    };
  }

  const parseUrl = new URL("/api/diagrams/parse", input.apiBase);
  parseUrl.searchParams.set("shareUrl", input.shareUrl);

  const response = await fetchJsonImpl<{
    elements: unknown[];
    appState: Record<string, unknown>;
  }>(
    parseUrl.toString(),
    {
      method: "GET",
      headers: input.traceId ? { "x-trace-id": input.traceId } : undefined,
    },
    input.abort
  );

  return {
    elements: (response.elements ?? []) as Record<string, unknown>[],
    appState: response.appState ?? {},
  };
}

