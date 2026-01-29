import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { appRouter } from "./router";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

let cachedSpec: unknown | null = null;

export async function getOpenApiSpec() {
  if (cachedSpec) {
    return cachedSpec;
  }

  cachedSpec = await generator.generate(appRouter, {
    info: {
      title: "Sketchi Diagram API",
      version: "1.0.0",
      description: "Generate, modify, parse, and share Excalidraw diagrams.",
    },
    servers: [{ url: "/api" }],
  });

  return cachedSpec;
}
