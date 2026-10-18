import { parseFlowchartDiagram } from "./types/flowchart.js";
import groupedApproval from "./fixtures/groups/grouped-approval.js";
import manyGroups from "./fixtures/groups/many-groups.js";
import mixedMembership from "./fixtures/groups/mixed-membership.js";
import scatteredMembers from "./fixtures/groups/scattered-members.js";
import singleGroup from "./fixtures/groups/single-group.js";
import threeZoneService from "./fixtures/groups/three-zone-service.js";

function flowchart(fixture: object, direction: "LR" | "TB" = "TB") {
	return parseFlowchartDiagram({
		...fixture,
		type: "flowchart",
		layout: { direction, edgeRouting: "orthogonal" },
	});
}

/**
 * Grouped flowcharts: teams, network zones and partial grouping, plus stress
 * cases whose members sit far apart, whose label is long, and whose groups are
 * many or hold every node. Their groups must stay apart, hold only their own
 * members, keep labels clear and route edges around other groups.
 */
export const groupFixtures = {
	"grouped-approval": flowchart(groupedApproval),
	"three-zone-service": flowchart(threeZoneService, "LR"),
	"mixed-membership": flowchart(mixedMembership),
	"scattered-members": flowchart(scatteredMembers),
	"many-groups": flowchart(manyGroups),
	"single-group": flowchart(singleGroup),
};
