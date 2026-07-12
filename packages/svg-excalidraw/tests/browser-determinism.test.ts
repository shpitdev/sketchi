import { describe, expect, it } from "vitest";

import {
  constructNativeTrace,
  deterministicTraceChecksum,
  deterministicTraceJson,
  parseSvgForFillSpike,
} from "../src";

const corpusMulticolorFixture =
  '<svg style="flex:none;line-height:1" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><g transform="translate(36.685 30.72) scale(19.576)"><title>vLLM</title><path d="M0 4.973h9.324V23L0 4.973z" fill="#FDB515"></path><path d="M13.986 4.351L22.378 0l-6.216 23H9.324l4.662-18.649z" fill="#30A2FF"></path></g></svg>';

describe("browser construction determinism", () => {
  it("matches the Node checksum byte-for-byte in Chromium", () => {
    const document = parseSvgForFillSpike(corpusMulticolorFixture, {
      sourceName: "ai-infrastructure/vllm.svg",
    });
    const first = constructNativeTrace(document, {
      strategy: "keyhole",
      roughness: 1,
      fillStyle: "solid",
    });
    const second = constructNativeTrace(document, {
      strategy: "keyhole",
      roughness: 1,
      fillStyle: "solid",
    });

    expect(deterministicTraceJson(first)).toBe(deterministicTraceJson(second));
    expect(deterministicTraceChecksum(first)).toBe("6977f090");
  });
});
