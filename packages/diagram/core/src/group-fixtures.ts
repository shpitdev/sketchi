import { parseFlowchartDiagram } from "./types/flowchart.js";
import expenseApprovalByTeam from "./fixtures/groups/expense-approval-by-team.js";
import expenseApprovalResubmit from "./fixtures/groups/expense-approval-resubmit.js";
import fiveTeamRow from "./fixtures/groups/five-team-row.js";
import groupedApproval from "./fixtures/groups/grouped-approval.js";
import manyGroups from "./fixtures/groups/many-groups.js";
import mixedMembership from "./fixtures/groups/mixed-membership.js";
import mixedMembershipRow from "./fixtures/groups/mixed-membership-row.js";
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
 * Grouped flowcharts: teams, network zones and partial grouping; stress cases
 * whose members sit far apart, whose label is long, and whose groups are many
 * or hold every node; two generated rows of team groups too long to read as
 * one row; a row of teams between ungrouped steps that no wrap reads better;
 * and a five-team row that wraps once its ends are polished. Their groups must stay apart, hold only their own members, keep
 * labels clear and route edges around other groups.
 */
export const groupFixtures = {
	"grouped-approval": flowchart(groupedApproval),
	"three-zone-service": flowchart(threeZoneService, "LR"),
	"mixed-membership": flowchart(mixedMembership),
	"scattered-members": flowchart(scatteredMembers),
	"many-groups": flowchart(manyGroups),
	"single-group": flowchart(singleGroup),
	"expense-approval-by-team": flowchart(expenseApprovalByTeam, "LR"),
	"expense-approval-resubmit": flowchart(expenseApprovalResubmit, "LR"),
	"mixed-membership-row": flowchart(mixedMembershipRow, "LR"),
	"five-team-row": flowchart(fiveTeamRow, "LR"),
};
