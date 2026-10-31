import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const corpusRoot = resolve(process.cwd(), "packages/icons/catalog/svg");
const fixturesRoot = resolve(process.cwd(), "packages/svg-excalidraw/tests/fixtures");

function corpusFixture(relativePath: string): {
	readonly source: string;
	readonly sourceName: string;
} {
	return {
		source: readFileSync(resolve(corpusRoot, relativePath), "utf8"),
		sourceName: relativePath,
	};
}

/**
 * The catalog's original 1,716-path Linux mark. The catalog now ships a
 * compact version (#353), so the stress input lives here unchanged.
 */
const linuxStressFixture = {
	source: readFileSync(resolve(fixturesRoot, "linux-stress.svg"), "utf8"),
	sourceName: "operating-systems/linux.svg",
} as const;

export const corpusFixtures = {
	counter: corpusFixture("ai-model-providers/ai21labsai.svg"),
	gradient: corpusFixture("programming-languages/kotlin.svg"),
	linuxStress: linuxStressFixture,
	multicolor: corpusFixture("ai-infrastructure/vllm.svg"),
	nonzeroSelfIntersection: corpusFixture("ai-apps-agents/agentvoice.svg"),
	nonzeroTouchingContours: corpusFixture("ai-ecosystem/perplexity.svg"),
	nonzeroZeroAreaContours: corpusFixture("devtools-ci/vitess.svg"),
	realClip: corpusFixture("ai-ecosystem/jimeng.svg"),
	strokeOnly: corpusFixture("gcp-legacy/connectivity-test.svg"),
	strokeDasharray: corpusFixture("programming-languages/lua.svg"),
	stylePaint: corpusFixture("gcp-legacy/cloud-router.svg"),
	usePath: corpusFixture("gcp-legacy/os-inventory-management.svg"),
	v1DisjointMultipath: corpusFixture("operating-systems/windows11.svg"),
} as const;
