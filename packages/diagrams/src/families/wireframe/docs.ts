import { WIREFRAME_RULES } from "./rules";
const PROMPT = "the prompt";
const DELIVERY_OPTIONS = `{ artifactFormats: ["scene", "excalidraw", "png"], inlineArtifacts: [] }`;

export const docs = {
	choice: { label: "Wireframe", hint: "best for low-fidelity screens, forms and app layouts" },
	summary: "UI wireframes and mockups: screens of components",
	fastPath: `spec: { title, screens: [{ name, device: "desktop" | "tablet" | "mobile", children }] }. Containers (children, title?): header, footer (at the bottom), sidebar, main, section, card, modal, column, row (align?: "between" | "center" | "end"), grid (columns: n). Widgets: heading (text, level?), text (text or lines), badge (text), link (text, target?: screen id), button (text, variant?, target?), input, textarea, select, search (label?, placeholder?, value?), checkbox, radio, toggle (label, checked?), tabs, nav (items, active?), breadcrumbs, list (items), avatar, icon, image, chart (label?), table (columns: string[]), divider. ${WIREFRAME_RULES.stateCompact}`,
	codeHint: "UI mockups",
	catalogOrder: 16,
	fastPathOrder: 12,
	studioOrder: 12,
	toolName: "build_wireframe" as const,
	toolDescription:
		'Build and persist a native low-fidelity wireframe: each screen a frame the size of its device, its header across the top, footer along the bottom and sidebars down their sides, and every component laid out and grouped. Give each screen a name, device ("desktop", "tablet" or "mobile") and children: containers (header, footer, sidebar, main, section, card, modal, row, column, grid with columns: n) hold children; widgets are heading, text, link, badge and button (text), input, textarea, select, search, checkbox, radio and toggle (label, placeholder or value), tabs, nav, breadcrumbs and list (items), and avatar, icon, image, chart, table (columns) and divider placeholders. A target (a screen id) on a button or link draws an arrow to the screen it opens. The host lays out every screen. Repair structured issues, up to three total attempts.',

	entry: (requestType: string) => ({
		id: "buildWireframe",
		kind: "operation" as const,
		title: "buildWireframe",
		topic: "buildWireframe" as const,
		keywords: ["wireframe", "mockup", "ui", "screen", "layout", "form", "dashboard", "app", "page"],
		snippet:
			"Create a native low-fidelity wireframe: screens on a device, each a tree of components.",
		content: [
			'buildWireframe accepts { spec: { id?, title, screens: [{ id?, name, device?: "desktop" | "tablet" | "mobile", align?, children }] }, options? }. Each screen draws as a frame the size of its device. The renderer places everything: a header spans the top, a footer the bottom, a sidebar one side, a modal floats over the rest, and every other component stacks down the content area. No field takes a coordinate or size.',
			`${WIREFRAME_RULES.containers(PROMPT)} ${WIREFRAME_RULES.rows} ${WIREFRAME_RULES.sizing}`,
			`${WIREFRAME_RULES.widgets} ${WIREFRAME_RULES.nav} ${WIREFRAME_RULES.target}`,
			`${WIREFRAME_RULES.state} ${WIREFRAME_RULES.copy} ${WIREFRAME_RULES.screens}`,
			requestType,
		].join("\n\n"),
		examples: [
			{
				title: "A phone login screen",
				language: "js" as const,
				code: `async () => sketchi.buildWireframe({ spec: { title: "Login", screens: [{ name: "Login", device: "mobile", children: [{ type: "heading", text: "Welcome back" }, { type: "input", label: "Email", placeholder: "you@example.com" }, { type: "input", label: "Password" }, { type: "checkbox", label: "Remember me", checked: true }, { type: "button", text: "Sign in", variant: "primary" }, { type: "link", text: "Forgot password?" }] }] }, options: ${DELIVERY_OPTIONS} })`,
			},
		],
	}),
};
