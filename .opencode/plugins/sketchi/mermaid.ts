import { randomUUID } from "node:crypto";
import { tool } from "@opencode-ai/plugin";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import sharp from "sharp";

const DEFAULT_THEME = "default";

let domInitialized = false;
let mermaidInstance: typeof import("mermaid").default | null = null;

function ensureDom(): void {
  if (domInitialized) return;

  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  (globalThis as unknown as { window: Window }).window =
    dom.window as unknown as Window;
  (globalThis as unknown as { document: Document }).document =
    dom.window.document as unknown as Document;
  (globalThis as unknown as { navigator: Navigator }).navigator =
    dom.window.navigator as unknown as Navigator;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement;
  (globalThis as unknown as { SVGElement: typeof SVGElement }).SVGElement =
    dom.window.SVGElement as unknown as typeof SVGElement;
  const dompurifyInstance = createDOMPurify(dom.window as unknown as Window);
  Object.assign(createDOMPurify, dompurifyInstance);
  (globalThis as unknown as { DOMPurify: typeof createDOMPurify }).DOMPurify =
    dompurifyInstance;
  (dom.window as unknown as { DOMPurify: typeof createDOMPurify }).DOMPurify =
    dompurifyInstance;

  domInitialized = true;
}

async function getMermaid(): Promise<typeof import("mermaid").default> {
  if (mermaidInstance) return mermaidInstance;
  ensureDom();
  const { default: mermaid } = await import("mermaid");
  mermaidInstance = mermaid;
  return mermaid;
}

async function initializeMermaid(
  theme: string
): Promise<typeof import("mermaid").default> {
  const mermaid = await getMermaid();
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: "strict",
  });
  return mermaid;
}

async function validateMermaid(
  source: string
): Promise<{ valid: boolean; error?: string }> {
  const mermaid = await initializeMermaid(DEFAULT_THEME);

  try {
    await mermaid.parse(source);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function renderSvg(
  source: string,
  theme: string
): Promise<{ svg: string }> {
  const mermaid = await initializeMermaid(theme);

  const renderId = `mermaid-${randomUUID()}`;
  const { svg } = await mermaid.render(renderId, source);

  return { svg };
}

async function svgToPng(
  svg: string,
  backgroundColor?: string
): Promise<Buffer> {
  let pipeline = sharp(Buffer.from(svg));

  if (backgroundColor) {
    pipeline = pipeline.flatten({ background: backgroundColor });
  }

  return pipeline.png().toBuffer();
}

export const MermaidPlugin = async () => {
  return {
    tool: {
      mermaid_validate: tool({
        description: "Validate Mermaid syntax.",
        args: {
          source: tool.schema.string().describe("Mermaid source code"),
        },
        async execute(args) {
          const result = await validateMermaid(args.source);
          return JSON.stringify(result, null, 2);
        },
      }),
      mermaid_render: tool({
        description: "Render Mermaid to SVG or PNG (base64).",
        args: {
          source: tool.schema.string().describe("Mermaid source code"),
          format: tool.schema.enum(["svg", "png"]).default("svg"),
          theme: tool.schema.string().optional().describe("Mermaid theme"),
          backgroundColor: tool.schema
            .string()
            .optional()
            .describe("Optional background color for PNG"),
        },
        async execute(args) {
          const theme = args.theme ?? DEFAULT_THEME;
          const { svg } = await renderSvg(args.source, theme);

          if (args.format === "svg") {
            return JSON.stringify({ format: "svg", svg }, null, 2);
          }

          const png = await svgToPng(svg, args.backgroundColor);
          return JSON.stringify(
            {
              format: "png",
              pngBase64: png.toString("base64"),
            },
            null,
            2
          );
        },
      }),
    },
  };
};

export default MermaidPlugin;
