import { fetchJson } from "./api";

type FetchJson = typeof fetchJson;

export interface ResolveShareUrlDeps {
  fetchJson?: FetchJson;
}

export async function resolveExcalidrawFromShareUrl(input: {
  shareUrl: string;
  apiBase: string;
  traceId?: string;
  abort?: AbortSignal;
  deps?: ResolveShareUrlDeps;
}): Promise<{
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
}> {
  const fetchJsonImpl = input.deps?.fetchJson ?? fetchJson;

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
