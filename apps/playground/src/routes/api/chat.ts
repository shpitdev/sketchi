import { createFileRoute } from "@tanstack/react-router";
import type { UIMessage } from "ai";

function isUIMessageArray(value: unknown): value is UIMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as UIMessage).role === "string" &&
        Array.isArray((item as UIMessage).parts),
    )
  );
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { messages?: unknown };

          if (!isUIMessageArray(body.messages)) {
            return new Response("No messages provided.", { status: 400 });
          }

          const [{ runStudioAgent }, { getStudioBindings }] = await Promise.all(
            [
              import("@/server/chat/agent.server"),
              import("@/server/bindings/cloudflare-bindings.server"),
            ],
          );

          return runStudioAgent(
            getStudioBindings(),
            body.messages,
            new URL(request.url).origin,
          );
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : "Chat request failed.",
            { status: 400 },
          );
        }
      },
    },
  },
});
