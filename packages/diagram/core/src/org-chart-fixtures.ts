import {
	type OrgChartDiagram,
	orgChartDiagramType,
	parseOrgChartDiagram,
	resolveOrgChartShorthand,
} from "./types/org-chart.js";

const FIRST = [
	"Ada",
	"Grace",
	"Alan",
	"Barbara",
	"Edsger",
	"Frances",
	"Donald",
	"Hedy",
	"John",
	"Katherine",
	"Leslie",
	"Mary",
	"Niklaus",
	"Radia",
	"Tim",
	"Shafi",
	"Vint",
	"Lynn",
	"Ken",
	"Sophie",
];
const LAST = [
	"Lovelace",
	"Hopper",
	"Turing",
	"Liskov",
	"Dijkstra",
	"Allen",
	"Knuth",
	"Lamarr",
	"Backus",
	"Johnson",
	"Lamport",
	"Keller",
	"Wirth",
	"Perlman",
	"Berners-Lee",
	"Goldwasser",
	"Cerf",
	"Conway",
	"Thompson",
	"Wilson",
];
const DEPARTMENTS = ["Engineering", "Product", "Sales", "Marketing", "Operations", "Finance"];
const TITLES = [
	"Chief Executive Officer",
	"Vice President",
	"Director",
	"Engineering Manager",
	"Team Lead",
	"Senior Engineer",
	"Engineer",
];

/** A deterministic name for the n-th person. */
function nameOf(index: number): string {
	return `${FIRST[index % FIRST.length]} ${LAST[(index * 7 + Math.floor(index / FIRST.length)) % LAST.length]}`;
}

/**
 * An org chart grown from report counts: `shape[d]` lists how many reports
 * each person at depth d has, cycling through the list for wider levels. Every
 * person below the top takes the department of the top-level branch they sit
 * in.
 */
function grown(
	id: string,
	title: string,
	shape: readonly (readonly number[])[],
	extra: Record<string, unknown> = {},
): OrgChartDiagram {
	const people: Record<string, unknown>[] = [
		{ id: "p0", name: nameOf(0), title: TITLES[0], department: "Executive" },
	];
	let level = [{ id: "p0", department: "Executive" }];
	for (const [depth, counts] of shape.entries()) {
		const next: { id: string; department: string }[] = [];
		level.forEach((manager, index) => {
			const count = counts[index % counts.length]!;
			for (let report = 0; report < count; report += 1) {
				const number = people.length;
				const department =
					depth === 0 ? DEPARTMENTS[report % DEPARTMENTS.length]! : manager.department;
				const person = { id: `p${number}`, department };
				people.push({
					id: person.id,
					name: nameOf(number),
					title: TITLES[Math.min(depth + 1, TITLES.length - 1)],
					department,
					manager: manager.id,
				});
				next.push(person);
			}
		});
		level = next;
	}
	return parseOrgChartDiagram(
		resolveOrgChartShorthand({ id, title, type: orgChartDiagramType, people, ...extra }),
	);
}

/**
 * Org charts that stress the layout: eighty people across four levels, a
 * manager with twenty reports, a chain six levels deep, a department of
 * twenty-five with a manager of eight, twelve vice presidents in one row, a
 * forest of three trees, and departments drawn as regions.
 */
export const orgChartStressFixtures = {
	eighty: grown("eighty-people", "Eighty people", [
		[6],
		[3, 2, 4],
		[3, 4, 2, 3, 3, 3, 4, 3, 2, 3, 4, 3, 2, 3, 3, 3, 4, 3],
	]),
	twentyReports: grown("twenty-reports", "Twenty reports", [[1], [20]]),
	deep: grown("six-levels", "Six levels deep", [[2], [2, 1], [1, 2], [2, 1], [1, 2]]),
	department: grown("department", "Department of twenty-five", [[3], [8, 6, 7]]),
	wide: grown("wide-top", "Twelve vice presidents", [[12], [2, 3, 1]]),
	forest: parseOrgChartDiagram(
		resolveOrgChartShorthand({
			id: "three-boards",
			title: "Three boards",
			type: orgChartDiagramType,
			forest: true,
			people: [
				{ id: "a", name: "North Board", title: "Chair" },
				{ id: "a1", name: "Ada Lovelace", title: "Member", manager: "a" },
				{ id: "a2", name: "Alan Turing", title: "Member", manager: "a" },
				{ id: "b", name: "South Board", title: "Chair" },
				{ id: "b1", name: "Grace Hopper", title: "Member", manager: "b" },
				{ id: "c", name: "West Board", title: "Chair" },
			],
		}),
	),
	regions: grown("regions", "Departments as regions", [[4], [3, 2, 1, 4], [0, 2, 1]], {
		groupByDepartment: true,
	}),
} satisfies Record<string, OrgChartDiagram>;
