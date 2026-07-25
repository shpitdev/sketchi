export const ICONS_CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Headers":
    "Content-Type, MCP-Protocol-Version, MCP-Session-Id",
  "Access-Control-Allow-Methods": "DELETE, GET, HEAD, OPTIONS, POST",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Type, MCP-Session-Id",
  "Access-Control-Max-Age": "86400",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export function corsHeaders(
  initial?: HeadersInit,
  additional?: HeadersInit,
): Headers {
  const headers = new Headers(initial);
  for (const [name, value] of Object.entries(ICONS_CORS_HEADERS)) {
    headers.set(name, value);
  }
  if (additional) {
    const extra = new Headers(additional);
    extra.forEach((value, name) => headers.set(name, value));
  }
  return headers;
}

export function corsJson(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, {
    ...init,
    headers: corsHeaders(init.headers),
  });
}

export function corsText(
  value: string | null,
  init: ResponseInit = {},
): Response {
  return new Response(value, {
    ...init,
    headers: corsHeaders(init.headers),
  });
}

export function corsPreflight(): Response {
  return corsText(null, { status: 204 });
}

export function withCors(response: Response): Response {
  return new Response(response.body, {
    headers: corsHeaders(response.headers),
    status: response.status,
    statusText: response.statusText,
  });
}
