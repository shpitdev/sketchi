import type { CSSProperties, ReactNode } from "react";

import { getAgentSetupEntry } from "../agent-setup-view/agent-setup-data.js";

/** Agents whose setup pages ship a plugin or MCP config today. */
const stripAgents = (["codex", "claude-code", "opencode"] as const).map(getAgentSetupEntry);

interface Benefit {
	id: string;
	title: string;
	visual: ReactNode;
}

// Each line is checked against the product: Studio and the CLI download a
// .excalidraw file, Codex and Claude Code install a plugin while other agents
// use the skill and MCP server, and neither the CLI nor the MCP endpoint asks
// for an account, key, or payment. The price covers Sketchi only; an agent's
// own model usage is billed by its provider, so the copy claims no more.
const benefits: readonly Benefit[] = [
	{ id: "native", title: "Native .excalidraw files", visual: <EditableShapes /> },
	{ id: "agents", title: "Works in your agent or CLI", visual: <AgentMarks /> },
	{
		id: "free",
		title: "No account or API key",
		visual: <span className="benefit__price">$0</span>,
	},
];

/** Three facts about what you get, in one row under the hero. */
export function BenefitStrip() {
	return (
		<section aria-label="Why Sketchi" className="benefit-strip">
			<ul className="sk-shell benefit-strip__list">
				{benefits.map(({ id, title, visual }, index) => (
					<li className="benefit sk-rise" key={id} style={{ "--i": index + 2 } as CSSProperties}>
						<span className="benefit__visual" data-benefit={id}>
							{visual}
						</span>
						<strong className="benefit__title">{title}</strong>
					</li>
				))}
			</ul>
		</section>
	);
}

/**
 * Two shapes and an arrow in the diagram's own stroke, the second one
 * selected with Excalidraw-style handles: the file opens as shapes you edit.
 */
function EditableShapes() {
	return (
		<svg
			aria-hidden="true"
			className="benefit__shapes"
			fill="none"
			height="40"
			viewBox="0 0 72 40"
			width="72"
		>
			<rect className="benefit__shape" height="18" rx="4" width="20" x="2" y="11" />
			<path className="benefit__arrow" d="M23.5 20 C 31 18.6, 37 18.6, 44 20" />
			<path className="benefit__arrow" d="M40.6 16.9 L44.4 20 L40.4 23" />
			<rect
				className="benefit__shape benefit__shape--selected"
				height="18"
				rx="4"
				width="20"
				x="48"
				y="11"
			/>
			<rect className="benefit__selection" height="26" width="28" x="44" y="7" />
			{[
				[44, 7],
				[72, 7],
				[44, 33],
				[72, 33],
			].map(([x, y]) => (
				<rect
					className="benefit__handle"
					height="4"
					key={`${x}-${y}`}
					width="4"
					x={(x ?? 0) - 2}
					y={(y ?? 0) - 2}
				/>
			))}
		</svg>
	);
}

function AgentMarks() {
	return (
		<span aria-hidden="true" className="benefit__agents">
			{stripAgents.map((entry, index) => (
				<span className="benefit__agent" key={entry.id} style={{ "--n": index } as CSSProperties}>
					<img alt="" height={22} src={entry.icon} width={22} />
				</span>
			))}
		</span>
	);
}
