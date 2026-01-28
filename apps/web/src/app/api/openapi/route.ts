import { getOpenApiSpec } from "@/lib/orpc/openapi";

export async function GET() {
  const spec = await getOpenApiSpec();
  return Response.json(spec);
}
