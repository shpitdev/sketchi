import { Badge } from "@sketchi/ui/components/badge";
import type { CSSProperties } from "react";

import { BrandIcon } from "../brand-icon/index.js";
import { CommandBlock } from "../command-block/index.js";
import {
	agentSetupEntries,
	codeModeMcpEndpoint,
	getAgentSetupEntry,
	type AgentSetupEntry,
	type AgentSetupId,
} from "./agent-setup-data.js";

export interface AgentSetupViewProps {
	agentId?: AgentSetupId;
}

export function AgentSetupView({ agentId }: AgentSetupViewProps) {
	if (agentId !== undefined) {
		return <AgentSetupDetail entry={getAgentSetupEntry(agentId)} />;
	}

	return <AgentSetupHub />;
}

function AgentSetupHub() {
	return (
		<section className="sk-section agent-page">
			<div className="sk-shell">
				<h1 className="agent-page__title">Add Sketchi to your agent</h1>
				<p className="agent-page__fact">No account or API key needed.</p>

				<div className="agent-grid">
					{agentSetupEntries.map((entry) => (
						<a
							className="agent-card"
							href={entry.href}
							key={entry.id}
							style={{ "--tile-accent": entry.accent } as CSSProperties}
						>
							<BrandIcon label="" size={30} src={entry.icon} tile />
							<span className="agent-card__label">
								<span className="agent-card__name">{entry.name}</span>
								<Badge variant="outline">{entry.badge}</Badge>
							</span>
							<span className="agent-card__cta">Set up →</span>
						</a>
					))}
				</div>

				<div className="agent-endpoint">
					<h2 className="agent-endpoint__title">Other MCP clients</h2>
					<CommandBlock label="MCP server URL" value={codeModeMcpEndpoint} />
				</div>
			</div>
		</section>
	);
}

function AgentSetupDetail({ entry }: { entry: AgentSetupEntry }) {
	return (
		<section
			className="sk-section agent-page"
			style={{ "--tile-accent": entry.accent } as CSSProperties}
		>
			<div className="sk-shell agent-detail">
				<a className="agent-backlink" href="/agents">
					← All agents
				</a>
				<div className="agent-detail__title">
					<BrandIcon label="" size={40} src={entry.icon} tile />
					<h1>{entry.name}</h1>
					<Badge variant="outline">{entry.badge}</Badge>
				</div>
				<p className="agent-page__fact">No account or API key needed.</p>

				<ol className="agent-steps">
					{entry.steps.map((step) => (
						<li className="agent-step" key={step.label}>
							<h2>{step.label}</h2>
							<CommandBlock
								kind={step.kind === "prompt" ? "prose" : "code"}
								label={step.label}
								value={step.value}
							/>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
