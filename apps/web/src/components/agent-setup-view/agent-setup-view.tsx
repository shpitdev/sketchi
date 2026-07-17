import type { CSSProperties } from "react";

import { BrandIcon } from "../brand-icon/index.js";
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

function EndpointCard({ meta }: { meta: string }) {
  return (
    <div className="agent-endpoint" aria-label="Sketchi server URL">
      <span className="agent-endpoint__label">Server URL</span>
      <code>{codeModeMcpEndpoint}</code>
      <span className="agent-endpoint__meta">{meta}</span>
    </div>
  );
}

function AgentSetupHub() {
  return (
    <div className="agent-page">
      <section className="agent-hero">
        <div className="sk-shell agent-hero__inner">
          <div className="agent-hero__copy">
            <h1>Sketch diagrams without leaving your agent.</h1>
            <p>
              Connect Sketchi once and ask for a diagram in plain language.
              Whatever you&rsquo;re building, your agent hands back a real,
              editable Sketchi diagram — not a wall of ASCII.
            </p>
          </div>
          <EndpointCard meta="Add this URL wherever your agent keeps its MCP config." />
        </div>
      </section>

      <section className="sk-section agent-list" aria-label="Supported agents">
        <div className="sk-shell">
          <div className="agent-grid">
            {agentSetupEntries.map((entry) => (
              <a
                className="agent-card"
                href={entry.href}
                key={entry.id}
                style={{ "--tile-accent": entry.accent } as CSSProperties}
              >
                <div className="agent-card__head">
                  <BrandIcon
                    label={entry.name}
                    size={30}
                    src={entry.icon}
                    tile
                  />
                  <span className="agent-card__status">{entry.status}</span>
                </div>
                <h2>{entry.name}</h2>
                <p className="agent-card__tag">{entry.tagline}</p>
                <p>{entry.summary}</p>
                <span className="agent-card__cta">Set up →</span>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function AgentSetupDetail({ entry }: { entry: AgentSetupEntry }) {
  return (
    <div
      className="agent-page agent-detail"
      style={{ "--tile-accent": entry.accent } as CSSProperties}
    >
      <section className="agent-hero agent-hero--detail">
        <div className="sk-shell agent-hero__inner">
          <div className="agent-hero__copy">
            <a className="agent-backlink" href="/agents">
              ← All agents
            </a>
            <div className="agent-hero__title">
              <BrandIcon label={entry.name} size={40} src={entry.icon} tile />
              <div>
                <h1>{entry.name}</h1>
                <p className="agent-hero__tag">{entry.tagline}</p>
              </div>
            </div>
            <p>{entry.summary}</p>
          </div>
          <EndpointCard meta="Public endpoint used by the setup below." />
        </div>
      </section>

      <section className="sk-section">
        <div className="sk-shell agent-detail__layout">
          <div className="agent-steps">
            <h2>Set up</h2>
            {entry.commands.map((command, index) => (
              <div className="agent-command" key={command.label}>
                <span className="agent-command__index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{command.label}</h3>
                  <pre className="docs-codeblock">
                    <code>{command.value}</code>
                  </pre>
                </div>
              </div>
            ))}

            {entry.config === undefined ? null : (
              <div className="agent-config">
                <h2>{entry.configLabel ?? "Add the public MCP server"}</h2>
                <pre className="docs-codeblock">
                  <code>{entry.config}</code>
                </pre>
              </div>
            )}
          </div>

          <aside className="agent-notes" aria-label={`${entry.name} notes`}>
            <h2>Good to know</h2>
            <ul>
              {entry.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </aside>
        </div>
      </section>
    </div>
  );
}
