import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { appRouter, createOrpcContext } from "@/lib/orpc/router";

const handler = new OpenAPIHandler(appRouter);

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: "/api",
    context: createOrpcContext(),
  });

  return response ?? new Response("Not Found", { status: 404 });
}

export { handleRequest as GET, handleRequest as POST };
