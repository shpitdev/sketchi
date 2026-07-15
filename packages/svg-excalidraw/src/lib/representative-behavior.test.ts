// @vitest-environment node

import { describe, expect, it } from "vitest";

import { corpusFixtures } from "../../tests/corpus-fixtures";
import {
  nonzeroDecompositionFixture,
  nonzeroDecompositionTraceChecksum,
} from "../../tests/determinism-fixtures";
import { inspectSvgCapabilities } from "./capabilities";
import { convertSvgToExcalidraw } from "./convert";
import {
  deterministicLibraryChecksum,
  serializeExcalidrawLibrary,
} from "./library";
import {
  constructNativeTrace,
  deterministicTraceChecksum,
  PROVISIONAL_POINT_BUDGET,
} from "./native";
import { parseSvg } from "./parse";

const representativeFixtures = [
  corpusFixtures.counter,
  corpusFixtures.gradient,
  corpusFixtures.linuxStress,
  corpusFixtures.multicolor,
  corpusFixtures.nonzeroSelfIntersection,
  corpusFixtures.nonzeroTouchingContours,
  corpusFixtures.nonzeroZeroAreaContours,
  corpusFixtures.realClip,
  corpusFixtures.strokeOnly,
  corpusFixtures.stylePaint,
  corpusFixtures.v1DisjointMultipath,
];

describe("representative SVG conversion behavior", () => {
  it.each(representativeFixtures)(
    "parses and classifies $sourceName deterministically",
    (fixture) => {
      const first = parseSvg(fixture.source, {
        sourceName: fixture.sourceName,
      });
      const second = parseSvg(fixture.source, {
        sourceName: fixture.sourceName,
      });

      expect(second).toEqual(first);
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const capability = inspectSvgCapabilities(first.document);
      const converted = convertSvgToExcalidraw(first.document, {
        fillStyle: "solid",
        roughness: 0,
      });
      expect(converted.ok).toBe(capability.nativeTrace === "supported");
      if (!converted.ok) return;

      expect(converted.elements.length).toBeGreaterThan(0);
      expect(
        converted.elements.every((element) => element.type === "line"),
      ).toBe(true);
      expect(
        converted.elements.every((element) =>
          [element.x, element.y, element.width, element.height]
            .concat(element.points.flat())
            .every(Number.isFinite),
        ),
      ).toBe(true);

      const library = serializeExcalidrawLibrary([
        {
          elements: converted.elements,
          id: `svg:${converted.sourceHash}`,
          name: fixture.sourceName,
        },
      ]);
      expect(deterministicLibraryChecksum(library)).toBe(
        deterministicLibraryChecksum(
          serializeExcalidrawLibrary([
            {
              elements: converted.elements,
              id: `svg:${converted.sourceHash}`,
              name: fixture.sourceName,
            },
          ]),
        ),
      );
    },
  );

  it("keeps adaptive flattening deterministic and point budgets warning-only", () => {
    for (const tolerance of [0.25, 0.5, 1]) {
      const parsed = parseSvg(corpusFixtures.linuxStress.source, {
        flattening: { tolerance },
        sourceName: corpusFixtures.linuxStress.sourceName,
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;

      const first = constructNativeTrace(parsed.document, {
        fillStyle: "solid",
        roughness: 1,
        strategy: "keyhole",
      });
      const second = constructNativeTrace(parsed.document, {
        fillStyle: "solid",
        roughness: 1,
        strategy: "keyhole",
      });
      expect(second).toEqual(first);
      expect(first.metrics.points).toBeGreaterThan(
        PROVISIONAL_POINT_BUDGET.perIcon,
      );
      expect(first.exceedsProvisionalBudget).toBe(true);
    }
  });

  it.each([
    corpusFixtures.nonzeroSelfIntersection,
    corpusFixtures.nonzeroTouchingContours,
    corpusFixtures.nonzeroZeroAreaContours,
  ])("decomposes real nonzero topology in $sourceName", (fixture) => {
    const parsed = parseSvg(fixture.source, {
      sourceName: fixture.sourceName,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const capability = inspectSvgCapabilities(parsed.document);
    const first = convertSvgToExcalidraw(parsed.document, { roughness: 0 });
    const second = convertSvgToExcalidraw(parsed.document, { roughness: 0 });

    expect(capability.nativeTrace).toBe("supported");
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(
      capability.diagnostics.map((diagnostic) => diagnostic.code),
    ).not.toContain("native-unsupported-topology");
  });

  it("locks the nonzero decomposition checksum for Chromium", () => {
    const parsed = parseSvg(nonzeroDecompositionFixture, {
      sourceName: "ai-apps-agents/agentvoice.svg",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const trace = constructNativeTrace(parsed.document, {
      fillStyle: "solid",
      roughness: 1,
      strategy: "keyhole",
    });

    expect(deterministicTraceChecksum(trace)).toBe(
      nonzeroDecompositionTraceChecksum,
    );
  });
});
