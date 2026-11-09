import { checkRequestCoverage } from "@sketchi/diagram-core";
import { describe, expect, it } from "vitest";

import { diagramScenarios } from "./diagram-scenarios";

/**
 * Generation repairs a diagram once for each coverage issue, so an issue on a diagram that draws
 * its request correctly is a wasted model call. Every scenario's reference diagram draws its
 * prompt as intended, so none may have one. Class references draw a typed field only as a
 * relationship role, where the class check asks for the attribute too, so they are not read here.
 */
const references = diagramScenarios.filter((scenario) => scenario.diagramType !== "class");

describe("coverage checks on the scenario corpus", () => {
	it.each(references.map((scenario) => [scenario.id, scenario] as const))(
		"finds nothing missing from the reference diagram of %s",
		(_id, scenario) => {
			expect(checkRequestCoverage(scenario.prompt, scenario.expectedDiagram)).toEqual([]);
		},
	);
});
