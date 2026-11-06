import type { RuleSource } from "./source.js";

/** How a request becomes a wireframe; see FLOWCHART_RULES. */
export const WIREFRAME_RULES = {
	readingOrder: "Every component sits under a screen's children, in reading order.",
	containers: (source: RuleSource) =>
		`Containers hold children: header (top), footer (holds whatever ${source} puts at the bottom), sidebar (side: left or right), main, section, card and modal (title?), grid (columns: n), row and column.`,
	rows: 'A row sets its children side by side and wraps them; align spreads them ("between"), centers or ends them.',
	sizing: "Rows and grids keep containers one height, buttons hug their text and fields stretch.",
	widgets:
		'Widgets: heading (text, level 1-3), text (text, or lines for placeholder copy), link and badge (text), button (text, variant "primary" | "secondary"), input, textarea, select, search (label, placeholder, or value when it shows one), checkbox, radio, toggle (label, checked), tabs and nav (items, active), breadcrumbs and list (items), avatar and icon (label), image (label, aspect "wide" | "square" | "tall"), chart (label, kind "bar" | "line" | "pie"), table (columns: an array of header strings, rows: placeholder count), divider.',
	nav: "A nav inside a sidebar stacks; any other runs across.",
	target: "A button or link with target: a screen id opens that screen, drawn as an arrow to it.",
	state:
		"State: variant primary on the screen's main button, checked: true on what is on or selected, active on the selected tab or nav item, value on a field showing one.",
	/** The execute code parameter's form of `state`. */
	stateCompact: 'Set variant "primary", checked and active as stated.',
	copy: "Copy every screen, component, text and state stated, in order; invent none.",
	screens:
		"Each screen a flow moves through is its own screen; set target only on the control stated to open one.",
} as const;
