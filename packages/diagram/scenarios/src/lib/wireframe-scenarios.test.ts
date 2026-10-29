import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import type { WireframeComponent, WireframeDiagram } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { Effect } from "effect";

import { evaluateScenarioDiagram } from "./evaluate.js";
import { FixtureGenerationClientLayer } from "./fixture-client.js";
import { candidateFromMcpResult } from "./mcp-results.js";
import { toDiagramGenerationPrompt } from "./prompt.js";
import {
	wireframeDrawnCheck,
	wireframeLayoutCheck,
	wireframeScenarios,
} from "./wireframe-scenarios.js";

const scenario = (id: string) => wireframeScenarios.find((entry) => entry.id === id)!;
const failed = (id: string, diagram: WireframeDiagram) =>
	evaluateScenarioDiagram(scenario(id), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const login = scenario("mobile-login-wireframe").expectedDiagram;
const dashboard = scenario("saas-dashboard-wireframe").expectedDiagram;
const settings = scenario("account-settings-wireframe").expectedDiagram;
const product = scenario("product-page-wireframe").expectedDiagram;
const signup = scenario("signup-flow-wireframe").expectedDiagram;

/** The diagram with every component `change` maps, depth first; returning undefined drops it. */
function edit(
	diagram: WireframeDiagram,
	change: (component: WireframeComponent) => WireframeComponent | undefined,
): WireframeDiagram {
	const visit = (components: readonly WireframeComponent[]): WireframeComponent[] =>
		components.flatMap((component) => {
			const changed = change(component);
			if (!changed) return [];
			return [changed.children ? { ...changed, children: visit(changed.children) } : changed];
		});
	return {
		...diagram,
		screens: diagram.screens.map((screen) => ({ ...screen, children: visit(screen.children) })),
	};
}
/** A model's spec retained from an eval, as the diagram it decodes to. */
const fixture = (name: string) =>
	({
		...JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")),
		type: "wireframe",
	}) as WireframeDiagram;
const named = (text: string) => (component: WireframeComponent) =>
	component.text === text || component.label === text || component.title === text;

describe("prompt-grounded wireframe scenarios", () => {
	it("covers a phone form, a dense dashboard, a settings page of states and a two-column product page", () => {
		expect(wireframeScenarios.map((entry) => entry.id)).toEqual([
			"mobile-login-wireframe",
			"saas-dashboard-wireframe",
			"account-settings-wireframe",
			"product-page-wireframe",
			"signup-flow-wireframe",
		]);
		expect(wireframeScenarios.map((entry) => entry.difficulty)).toContain("challenge");
		for (const entry of wireframeScenarios) {
			expect(entry.tags).toContain("wireframe");
			// frontierclimb's logo rule fires on either word.
			expect(entry.prompt).not.toMatch(/\blogo|\bicon/iu);
		}
	});

	it("passes its own expected diagram, including what the scene draws and its layout", () => {
		for (const entry of wireframeScenarios)
			expect(failed(entry.id, entry.expectedDiagram), entry.id).toEqual([]);
	});

	it("accepts the equivalent forms a model may write", () => {
		// A header over only the main column, KPI values in another spelling, extra wrappers and unstated levels.
		const header = dashboard.screens[0]!.children.find((component) => component.type === "header")!;
		const reshaped: WireframeDiagram = {
			...dashboard,
			screens: [
				{
					...dashboard.screens[0]!,
					children: dashboard.screens[0]!.children.filter(
						(component) => component.type !== "header",
					).map((component) =>
						component.type === "main"
							? {
									...component,
									children: [header, { type: "column", children: component.children! }],
								}
							: component,
					),
				},
			],
		};
		const respelled = edit(reshaped, (component) =>
			component.text === "$48,200"
				? { type: "text", text: "$48.2k" }
				: component.type === "heading"
					? (({ level: _level, ...rest }) => rest)(component)
					: component,
		);
		expect(failed("saas-dashboard-wireframe", respelled)).toEqual([]);
		// A switch is a toggle and a dropdown a select once the contract reads them; a select may show its value as a placeholder.
		const placeholders = edit(settings, (component) =>
			component.type === "select"
				? { ...component, placeholder: component.value!, value: undefined as never }
				: component,
		);
		expect(
			failed(
				"account-settings-wireframe",
				edit(placeholders, (component) => {
					const { value: _value, ...rest } = component;
					return component.type === "select" ? rest : component;
				}),
			),
		).toEqual([]);
		// An input named by its placeholder alone.
		expect(
			failed(
				"mobile-login-wireframe",
				edit(login, (component) =>
					component.label === "Password" ? { type: "input", placeholder: "Password" } : component,
				),
			),
		).toEqual([]);
	});

	it.each([
		[
			"mobile-login-wireframe",
			"a desktop screen",
			() => ({ ...login, screens: [{ ...login.screens[0]!, device: "desktop" as const }] }),
			["device:login"],
		],
		[
			"mobile-login-wireframe",
			"a secondary sign-in button",
			() =>
				edit(login, (component) =>
					named("Sign in")(component) ? { ...component, variant: "secondary" } : component,
				),
			["state:sign-in"],
		],
		[
			"mobile-login-wireframe",
			"a button for the forgot link",
			() =>
				edit(login, (component) =>
					named("Forgot password?")(component)
						? { type: "button", text: "Forgot password?" }
						: component,
				),
			["component:forgot", "order:login"],
		],
		[
			"mobile-login-wireframe",
			"an invented button",
			() => ({
				...login,
				screens: [
					{
						...login.screens[0]!,
						children: [
							...login.screens[0]!.children.slice(0, 6),
							{ type: "button", text: "Sign in with Google" },
							...login.screens[0]!.children.slice(6),
						],
					},
				],
			}),
			["controls-stated"],
		],
		[
			"mobile-login-wireframe",
			"the email placeholder dropped",
			() =>
				edit(login, (component) =>
					named("Email")(component) ? { type: "input", label: "Email" } : component,
				),
			["state:email"],
		],
		[
			"saas-dashboard-wireframe",
			"the nav items out of order",
			() =>
				edit(dashboard, (component) =>
					component.type === "nav"
						? { ...component, items: [...component.items!].reverse() }
						: component,
				),
			["order:nav"],
		],
		[
			"saas-dashboard-wireframe",
			"the sidebar on the right",
			() =>
				edit(dashboard, (component) =>
					component.type === "sidebar" ? { ...component, side: "right" } : component,
				),
			["side:sidebar-left"],
		],
		[
			"saas-dashboard-wireframe",
			"a KPI value changed",
			() =>
				edit(dashboard, (component) =>
					component.text === "1,284" ? { ...component, text: "1,248" } : component,
				),
			["component:subscriptions", "order:main", "side:kpi-row"],
		],
		[
			"saas-dashboard-wireframe",
			"a table column dropped",
			() =>
				edit(dashboard, (component) =>
					component.type === "table"
						? { ...component, columns: ["Order ID", "Customer", "Plan", "Amount", "Status"] }
						: component,
				),
			["columns:orders"],
		],
		[
			"account-settings-wireframe",
			"a toggle drawn as a checkbox",
			() =>
				edit(settings, (component) =>
					named("Weekly digest")(component)
						? { type: "checkbox", label: "Weekly digest", checked: true }
						: component,
				),
			[
				"component:weekly-digest",
				"inside:weekly-digest",
				"state:weekly-digest",
				"order:email-notifications",
			],
		],
		[
			"account-settings-wireframe",
			"a toggle left off",
			() =>
				edit(settings, (component) =>
					named("Mentions")(component) ? { type: "toggle", label: "Mentions" } : component,
				),
			["state:mentions"],
		],
		[
			"account-settings-wireframe",
			"the wrong active tab",
			() =>
				edit(settings, (component) =>
					component.type === "tabs" ? { ...component, active: "General" } : component,
				),
			["state:tabs"],
		],
		[
			"account-settings-wireframe",
			"the save bar at the top",
			() => ({
				...settings,
				screens: [
					{
						...settings.screens[0]!,
						children: [settings.screens[0]!.children[1]!, settings.screens[0]!.children[0]!].map(
							(component) =>
								component.type === "footer"
									? { type: "row" as const, align: "end" as const, children: component.children! }
									: component,
						),
					},
				],
			}),
			["side:save-bar-bottom"],
		],
		[
			"account-settings-wireframe",
			"a toggle in the wrong section",
			() =>
				edit(
					edit(settings, (component) =>
						named("Marketing emails")(component) ? undefined : component,
					),
					(component) =>
						component.title === "Push notifications"
							? {
									...component,
									children: [...component.children!, { type: "toggle", label: "Marketing emails" }],
								}
							: component,
				),
			["inside:marketing"],
		],
		[
			"product-page-wireframe",
			"the details column left of the image",
			() =>
				edit(product, (component) =>
					component.type === "row" &&
					component.children?.length === 2 &&
					component.children[0]!.type === "column"
						? { ...component, children: [...component.children].reverse() }
						: component,
				),
			["order:page", "side:image-left"],
		],
		[
			"product-page-wireframe",
			"three thumbnails",
			() =>
				edit(product, (component) =>
					component.type === "grid"
						? { ...component, children: component.children!.slice(0, 3) }
						: component,
				),
			["side:thumbnails"],
		],
		[
			"product-page-wireframe",
			"the size select showing another size",
			() =>
				edit(product, (component) =>
					named("Size")(component) ? { ...component, value: "S" } : component,
				),
			["state:size"],
		],
		[
			"product-page-wireframe",
			"a review missing",
			() =>
				edit(product, (component) =>
					component.type === "list"
						? { ...component, items: component.items!.slice(0, 2) }
						: component,
				),
			["list:review-list"],
		],
	])("%s: %s fails exactly its checks", (id, _name, mutate, expected) => {
		expect(failed(id, mutate() as WireframeDiagram).toSorted()).toEqual([...expected].toSorted());
	});

	it("reads what the prompt places at the bottom of a screen only in its footer, which the renderer pins there", () => {
		// A model's spec: "New here?" and "Create account" follow the form in the flow, mid-screen on a tall phone.
		const inFlow = {
			...JSON.parse(
				readFileSync(
					new URL("./fixtures/wireframe-login-bottom-in-flow.json", import.meta.url),
					"utf8",
				),
			),
			type: "wireframe",
		} as WireframeDiagram;
		expect(failed("mobile-login-wireframe", inFlow)).toEqual(["side:login-bottom"]);
		// The two in the screen's footer, as the docs advise and the expected diagram does.
		expect(failed("mobile-login-wireframe", login)).toEqual([]);
		// The two in one row, the last block of the flow, still render mid-screen.
		const lastRow = edit(login, (component) =>
			component.type === "footer" ? { ...component, type: "row" } : component,
		);
		expect(failed("mobile-login-wireframe", lastRow)).toEqual(["side:login-bottom"]);
	});

	it("reads a card or section titled by the text or heading that leads it", () => {
		// A model's spec from the dashboard prompt: each KPI card leads with its title as text, then its value.
		const titledByChild = {
			...JSON.parse(
				readFileSync(
					new URL("./fixtures/wireframe-kpi-cards-child-titles.json", import.meta.url),
					"utf8",
				),
			),
			type: "wireframe",
		} as WireframeDiagram;
		expect(failed("saas-dashboard-wireframe", titledByChild)).toEqual([]);
		const leadWithTitle = (component: WireframeComponent): WireframeComponent => {
			const { title, ...rest } = component;
			return (component.type === "card" || component.type === "section") && title
				? { ...rest, children: [{ type: "heading", text: title }, ...(component.children ?? [])] }
				: component;
		};
		expect(failed("account-settings-wireframe", edit(settings, leadWithTitle))).toEqual([]);
		expect(failed("product-page-wireframe", edit(product, leadWithTitle))).toEqual([]);
		// The title still leads, and the value sits in another child.
		const cards = [
			"component:mrr",
			"component:subscriptions",
			"component:arpa",
			"component:churn",
			"order:main",
			"side:kpi-row",
		];
		const kpis = (change: (card: WireframeComponent) => WireframeComponent) =>
			edit(titledByChild, (component) =>
				component.type === "card" && component.children?.length === 2
					? change(component)
					: component,
			);
		expect(
			failed(
				"saas-dashboard-wireframe",
				kpis((card) => ({ ...card, children: [...card.children!].reverse() })),
			),
		).toEqual(cards);
		expect(
			failed(
				"saas-dashboard-wireframe",
				kpis((card) => ({
					...card,
					children: [
						{ type: "text", text: `${card.children![0]!.text} ${card.children![1]!.text}` },
					],
				})),
			),
		).toEqual(cards);
	});

	it("expects a field to show its value rather than its placeholder, as the renderer draws it", () => {
		const hinted = edit(product, (component) =>
			component.label === "Quantity" ? { ...component, placeholder: "Enter quantity" } : component,
		);
		expect(failed("product-page-wireframe", hinted)).toEqual([]);
		// With no value, the placeholder is what it shows.
		const scene = renderDiagram(login);
		const unhinted = {
			...scene,
			elements: scene.elements.filter(
				(element) => !(element.type === "text" && element.text === "you@example.com"),
			),
		};
		expect(wireframeDrawnCheck(login, unhinted).message).toContain('"you@example.com"');
	});

	it.each([
		[
			"a Continue button that opens nothing",
			() =>
				edit(signup, (component) =>
					component.target === "choose-plan"
						? { ...component, target: undefined as never }
						: component,
				),
			["navigation:verify-email->choose-plan", "navigations-exact"],
		],
		[
			"a Continue button that opens the wrong screen",
			() =>
				edit(signup, (component) =>
					component.target === "choose-plan"
						? { ...component, target: "create-account" }
						: component,
				),
			["navigation:verify-email->choose-plan"],
		],
		[
			"an unstated navigation",
			() =>
				edit(signup, (component) =>
					component.text === "Resend code" ? { ...component, target: "create-account" } : component,
				),
			["navigations-exact"],
		],
	])("signup flow: %s fails exactly its checks", (_name, mutate, expected) => {
		const diagram = mutate();
		const cleaned = edit(diagram, (component) => {
			if (component.target !== undefined) return component;
			const { target: _target, ...rest } = component;
			return rest;
		});
		expect(failed("signup-flow-wireframe", cleaned).toSorted()).toEqual([...expected].toSorted());
	});

	it("reads each navigation arrow off the drawing", () => {
		const scene = renderDiagram(signup);
		expect(wireframeDrawnCheck(signup, scene).passed).toBe(true);
		const dropped = {
			...scene,
			elements: scene.elements.filter((element) => element.id !== "nav:create-account:4"),
		};
		expect(wireframeDrawnCheck(signup, dropped).message).toContain("arrow to verify-email");
	});

	it("requires exactly the stated screens", () => {
		const twice = { ...login, screens: [...login.screens, { ...login.screens[0]!, id: "copy" }] };
		expect(failed("mobile-login-wireframe", twice)).toContain("screens-exact");
	});

	it("reads the drawing: a dropped label or a moved component fails the scene checks", () => {
		const scene = renderDiagram(login);
		expect(wireframeDrawnCheck(login, scene).passed).toBe(true);
		const unlabeled = {
			...scene,
			elements: scene.elements.filter((element) => element.id !== "wf:login:5:label"),
		};
		expect(wireframeDrawnCheck(login, unlabeled).message).toContain('"Sign in"');
		const moved = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "node" && element.id === "wf:login:5:box"
					? { ...element, y: element.y - 30 }
					: element,
			),
		};
		expect(wireframeLayoutCheck(moved).passed).toBe(false);
		const spilled = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "node" && element.id === "wf:login:2:box"
					? { ...element, x: element.x + 200 }
					: element,
			),
		};
		expect(wireframeLayoutCheck(spilled).passed).toBe(false);
	});

	it("serves the fixture model's diagram, meeting its screen count and names", async () => {
		const candidate = await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* DiagramGenerationClient;
				return yield* client.generate({
					model: "fixture",
					prompt: toDiagramGenerationPrompt(scenario("mobile-login-wireframe")),
				});
			}).pipe(Effect.provide(FixtureGenerationClientLayer)),
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toEqual(login);
	});

	it("reads a container's title as a stated heading when none is drawn", () => {
		// Sonnet's spec from the dashboard prompt (DT574 k5ci): "Northstar" is the sidebar's own title.
		const sidebarTitle = fixture("wireframe-sidebar-title-k5ci.json");
		expect(failed("saas-dashboard-wireframe", sidebarTitle)).toEqual([]);
		// The title still has to say the stated words, in the stated container.
		const retitle = (from: string, to: string) => (component: WireframeComponent) =>
			component.type === from ? { ...component, title: to } : component;
		expect(
			failed("saas-dashboard-wireframe", edit(sidebarTitle, retitle("sidebar", "North Star HQ"))),
		).toEqual(["component:product-name", "inside:product-name"]);
		const inHeader = edit(
			edit(sidebarTitle, ({ title, ...component }) =>
				component.type === "sidebar" ? component : { ...component, ...(title ? { title } : {}) },
			),
			retitle("header", "Northstar"),
		);
		expect(failed("saas-dashboard-wireframe", inHeader)).toEqual(["inside:product-name"]);
		// A drawn heading with the words still wins, wherever it sits.
		const drawnHeading = edit(sidebarTitle, (component) =>
			component.type === "main"
				? { ...component, children: [{ type: "text", text: "Northstar" }, ...component.children!] }
				: component,
		);
		expect(failed("saas-dashboard-wireframe", drawnHeading)).toEqual(["inside:product-name"]);
	});

	it("reads adjacent links in the stated container as the stated nav", () => {
		// Sonnet's spec from the product page prompt (DT574 gsf2): the header's nav is four links.
		const headerLinks = fixture("wireframe-header-links-gsf2.json");
		expect(failed("product-page-wireframe", headerLinks)).toEqual([]);
		const header = (change: (children: readonly WireframeComponent[]) => WireframeComponent[]) =>
			edit(headerLinks, (component) =>
				component.type === "header"
					? { ...component, children: change(component.children!) }
					: component,
			);
		const link = (text: string): WireframeComponent => ({ type: "link", text });
		const [store, , , , , search, cart] = headerLinks.screens[0]!.children[0]!.children!;
		// Reordered, missing or extra items still fail, and so do links split apart.
		expect(
			failed(
				"product-page-wireframe",
				header(() => [
					store!,
					link("Women"),
					link("Men"),
					link("Gear"),
					link("Sale"),
					search!,
					cart!,
				]),
			),
		).toEqual(["order:nav"]);
		expect(
			failed(
				"product-page-wireframe",
				header(() => [store!, link("Men"), link("Women"), link("Gear"), search!, cart!]),
			),
		).toEqual(["order:nav", "controls-stated"]);
		expect(
			failed(
				"product-page-wireframe",
				header(() => [
					store!,
					link("Men"),
					link("Women"),
					link("Gear"),
					link("Sale"),
					cart!,
					search!,
				]),
			),
		).toEqual(["order:nav", "order:header"]);
		expect(
			failed(
				"product-page-wireframe",
				header(() => [
					store!,
					link("Men"),
					link("Women"),
					search!,
					link("Gear"),
					link("Sale"),
					cart!,
				]),
			),
		).toEqual(["order:nav"]);
		// One link is not a nav.
		expect(
			failed(
				"product-page-wireframe",
				header(() => [store!, link("Men"), search!, cart!]),
			),
		).toEqual(expect.arrayContaining(["component:nav"]));
		// Links outside the stated container are not its nav.
		const inMain = edit(headerLinks, (component) =>
			component.type === "header"
				? { ...component, children: [store!, search!, cart!] }
				: component.type === "column" && component.children?.[0]?.type === "heading"
					? {
							...component,
							children: [
								link("Men"),
								link("Women"),
								link("Gear"),
								link("Sale"),
								...component.children,
							],
						}
					: component,
		);
		expect(failed("product-page-wireframe", inMain)).toEqual(
			expect.arrayContaining(["inside:nav", "side:header-top"]),
		);
		expect(failed("product-page-wireframe", inMain)).not.toContain("order:nav");
		// Links carry no active item, so a stated active nav item still needs a nav.
		const sidebarLinks = edit(dashboard, (component) =>
			component.type === "sidebar"
				? {
						...component,
						children: component.children!.flatMap((child) =>
							child.type === "nav" ? child.items!.map(link) : [child],
						),
					}
				: component,
		);
		expect(failed("saas-dashboard-wireframe", sidebarLinks)).toEqual(["state:nav"]);
	});

	it("grades a buildWireframe receipt from an MCP execute", () => {
		const receipt = {
			ok: true,
			status: "accepted",
			operation: "buildWireframe",
			buildId: "build-1",
			normalizedSpec: { ...settings, type: undefined },
			quality: { accepted: true },
		};
		const candidate = candidateFromMcpResult(
			{ ok: true, result: { ok: true, status: "accepted", buildId: "build-1" }, builds: [receipt] },
			"wireframe",
		);
		expect(candidate?.ok).toBe(true);
		if (!candidate?.ok) throw new Error("Expected the accepted receipt.");
		expect(failed("account-settings-wireframe", candidate.diagram as WireframeDiagram)).toEqual([]);
	});
});
