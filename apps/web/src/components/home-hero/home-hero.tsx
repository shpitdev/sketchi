import { Button } from "@sketchi/ui/components/button";
import type { CSSProperties } from "react";

import { DEFAULT_WEB_SURFACE_URLS } from "../../lib/surface-urls";
import { getAgentSetupEntry } from "../agent-setup-view/agent-setup-data.js";
import { HomeDiagram } from "../home-diagram/index.js";

export interface HomeHeroProps {
	agentsHref?: string;
	primaryHref?: string;
}

/** Agents shown on the hero action, each backed by a setup page. */
const heroAgents = (["codex", "claude-code", "opencode"] as const).map(getAgentSetupEntry);
const heroAgentList = new Intl.ListFormat("en", { type: "disjunction" }).format(
	heroAgents.map((entry) => entry.name),
);

/** What Sketchi does, the two ways to start, and a diagram it made that you can edit. */
export function HomeHero({
	agentsHref = "/agents",
	primaryHref = DEFAULT_WEB_SURFACE_URLS.playground,
}: HomeHeroProps) {
	return (
		<section>
			<div className="sk-shell home-hero__inner">
				<div className="home-hero__copy">
					<h1 className="home-hero__title">Excalidraw diagrams from a description</h1>
					<p className="home-hero__lead">
						Describe a system or a process in a sentence. Sketchi draws it with each product&rsquo;s
						logo, and every part stays editable.
					</p>
					<div className="home-hero__actions">
						<Button asChild size="xl" variant="brand">
							<a href={primaryHref}>Open Playground</a>
						</Button>
						<Button asChild size="xl" variant="outline">
							<a
								className="agent-action"
								href={agentsHref}
								title={`Set up Sketchi in ${heroAgentList}`}
							>
								<span aria-hidden="true" className="agent-action__stack">
									{heroAgents.map((entry, index) => (
										<span
											className="agent-action__logo"
											key={entry.id}
											style={{ "--n": index } as CSSProperties}
										>
											<img alt="" height={20} src={entry.icon} width={20} />
										</span>
									))}
								</span>
								Add to your agent
							</a>
						</Button>
					</div>
				</div>

				<HomeDiagram />
			</div>
		</section>
	);
}
