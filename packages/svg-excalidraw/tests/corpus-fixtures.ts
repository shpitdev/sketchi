import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const corpusRoot = resolve(
  process.cwd(),
  "apps/icons/public/output/upload-ready/svg",
);

function corpusFixture(relativePath: string): {
  readonly source: string;
  readonly sourceName: string;
} {
  return {
    source: readFileSync(resolve(corpusRoot, relativePath), "utf8"),
    sourceName: relativePath,
  };
}

export const corpusFixtures = {
  counter: corpusFixture("ai-model-providers/ai21labsai.svg"),
  gradient: corpusFixture("programming-languages/kotlin.svg"),
  linuxStress: corpusFixture("operating-systems/linux.svg"),
  multicolor: corpusFixture("ai-infrastructure/vllm.svg"),
  realClip: corpusFixture("ai-ecosystem/jimeng.svg"),
  strokeOnly: corpusFixture("gcp-legacy/connectivity-test.svg"),
  stylePaint: corpusFixture("gcp-legacy/cloud-router.svg"),
  v1DisjointMultipath: corpusFixture("operating-systems/windows11.svg"),
} as const;
