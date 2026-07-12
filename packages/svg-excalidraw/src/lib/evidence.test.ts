// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import checkedEvidence from "../../evidence/slice-1-ir-capability-metrics.json";
import { corpusFixtures } from "../../tests/corpus-fixtures";
import { inspectSvgCapabilities } from "./capabilities";
import { constructNativeTrace, PROVISIONAL_POINT_BUDGET } from "./native";
import { parseSvg } from "./parse";
import type { CanonicalSvgDocument, SvgFeatureCounts } from "./types";

const representativeFixtures = [
  corpusFixtures.counter,
  corpusFixtures.gradient,
  corpusFixtures.linuxStress,
  corpusFixtures.multicolor,
  corpusFixtures.realClip,
  corpusFixtures.strokeOnly,
  corpusFixtures.stylePaint,
  corpusFixtures.v1DisjointMultipath,
];

function researchAtTolerance(tolerance: number) {
  return representativeFixtures.map((fixture) => {
    const result = parseSvg(fixture.source, {
      flattening: { tolerance },
      sourceName: fixture.sourceName,
    });
    if (!result.ok) {
      throw new Error(JSON.stringify(result.diagnostics));
    }
    const trace = constructNativeTrace(result.document, {
      fillStyle: "solid",
      roughness: 1,
      strategy: "keyhole",
    });
    return {
      fixture: fixture.sourceName,
      sourceBytes: Buffer.byteLength(fixture.source),
      shapes: result.document.metrics.shapes,
      canonicalPoints: result.document.metrics.points,
      nativeElements: trace.metrics.elements,
      nativePoints: trace.metrics.points,
      maxPointsPerElement: trace.metrics.maxPointsPerElement,
      exceedsProvisionalBudget: trace.exceedsProvisionalBudget,
    };
  });
}

function corpusCapabilities() {
  const corpusRoot = resolve(
    process.cwd(),
    "apps/icons/public/output/upload-ready/svg",
  );
  const paths = readdirSync(corpusRoot, { recursive: true })
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.endsWith(".svg"),
    )
    .sort();
  const documents = paths.map((relativePath): CanonicalSvgDocument | null => {
    const source = readFileSync(resolve(corpusRoot, relativePath), "utf8");
    const result = parseSvg(source, { sourceName: relativePath });
    if (!result.ok) {
      return null;
    }
    return result.document;
  });
  const featureFiles = (feature: keyof SvgFeatureCounts) =>
    documents.filter((document) => (document?.features[feature] ?? 0) > 0)
      .length;
  const nativeSupported = documents.filter(
    (document) =>
      document && inspectSvgCapabilities(document).nativeTrace === "supported",
  ).length;
  const diagnosticFiles = (
    code: CanonicalSvgDocument["diagnostics"][number]["code"],
  ) =>
    documents.filter((document) =>
      document?.diagnostics.some((entry) => entry.code === code),
    ).length;
  return {
    files: documents.length,
    nativeSupported,
    nativeUnsupported: documents.length - nativeSupported,
    diagnosticFiles: {
      cssAtRuleUnsupported: diagnosticFiles("css-at-rule-unsupported"),
      cssNestingUnsupported: diagnosticFiles("css-nesting-unsupported"),
      cssSelectorUnsupported: diagnosticFiles("css-selector-unsupported"),
      invalidTransform: diagnosticFiles("invalid-transform"),
      parseError: diagnosticFiles("parse-error"),
      symbolViewportUnsupported: diagnosticFiles("symbol-viewport-unsupported"),
      unsupportedElement: diagnosticFiles("unsupported-element"),
      unsupportedPresentationProperty: diagnosticFiles(
        "unsupported-presentation-property",
      ),
      useCycle: diagnosticFiles("use-cycle"),
      useExpansionLimitExceeded: diagnosticFiles(
        "use-expansion-limit-exceeded",
      ),
      useReferenceMissing: diagnosticFiles("use-reference-missing"),
    },
    featureFiles: {
      clipPath: featureFiles("clipPath"),
      filter: featureFiles("filter"),
      gradient: featureFiles("gradient"),
      image: featureFiles("image"),
      mask: featureFiles("mask"),
      pattern: featureFiles("pattern"),
      style: featureFiles("style"),
      text: featureFiles("text"),
      use: featureFiles("use"),
    },
    realClipFiles: documents.filter(
      (document) =>
        document && inspectSvgCapabilities(document).summary.realClip,
    ).length,
    trivialClipFiles: documents.filter(
      (document) =>
        document &&
        inspectSvgCapabilities(document).summary.trivialClipsRemoved > 0,
    ).length,
  };
}

describe("checked Slice 1 evidence", () => {
  it("locks representative adaptive-flattening and point-budget measurements", () => {
    const research = {
      defaultTolerance: 0.5,
      provisionalPointBudget: PROVISIONAL_POINT_BUDGET,
      toleranceMatrix: [0.25, 0.5, 1].map((tolerance) => ({
        tolerance,
        fixtures: researchAtTolerance(tolerance),
      })),
    };
    expect(research).toEqual(checkedEvidence.pointBudgetResearch);
  });

  it("locks deduplicated file-level corpus capability metrics", () => {
    const census = corpusCapabilities();
    expect(census).toEqual(checkedEvidence.corpusCensus);
  });
});
