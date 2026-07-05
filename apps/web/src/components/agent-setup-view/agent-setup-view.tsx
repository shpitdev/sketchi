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
    <div className="agent-page">
      <section className="agent-hero">
        <div className="sk-shell agent-hero__inner">
          <div className="agent-hero__copy">
            <p className="sk-eyebrow">Agent setup</p>
            <h1>Connect Sketchi to your coding agent.</h1>
            <p>
              Sketchi Code Mode exposes one remote MCP server for supported
              agent clients. Pick the agent you use, install the tracked
              package where one exists, and keep generated diagrams as Sketchi
              artifacts instead of local wrapper files.
            </p>
          </div>
          <div className="agent-endpoint" aria-label="Current MCP endpoint">
            <span className="agent-endpoint__label">MCP endpoint</span>
            <code>{codeModeMcpEndpoint}</code>
            <span className="agent-endpoint__meta">
              Verified Workers URL until custom Studio domains are attached.
            </span>
          </div>
        </div>
      </section>

      <section className="sk-section agent-list" aria-label="Supported agents">
        <div className="sk-shell">
          <div className="agent-grid">
            {agentSetupEntries.map((entry) => (
              <a className="agent-card" href={entry.href} key={entry.id}>
                <span className="agent-card__status">{entry.status}</span>
                <h2>{entry.name}</h2>
                <p>{entry.summary}</p>
                <span className="agent-card__cta">Open setup</span>
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
    <div className="agent-page agent-detail">
      <section className="agent-hero agent-hero--detail">
        <div className="sk-shell agent-hero__inner">
          <div className="agent-hero__copy">
            <a className="agent-backlink" href="/agents">
              Agent setup
            </a>
            <p className="sk-eyebrow">{entry.status}</p>
            <h1>{entry.name} setup</h1>
            <p>{entry.summary}</p>
          </div>
          <div className="agent-endpoint" aria-label="Current MCP endpoint">
            <span className="agent-endpoint__label">MCP endpoint</span>
            <code>{codeModeMcpEndpoint}</code>
            <span className="agent-endpoint__meta">
              The current deployed endpoint is no-auth and backed by the Studio
              Worker.
            </span>
          </div>
        </div>
      </section>

      <section className="sk-section">
        <div className="sk-shell agent-detail__layout">
          <div className="agent-steps">
            <h2>Setup commands</h2>
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
                <h2>MCP config shape</h2>
                <pre className="docs-codeblock">
                  <code>{entry.config}</code>
                </pre>
              </div>
            )}
          </div>

          <aside className="agent-notes" aria-label={`${entry.name} notes`}>
            <h2>Notes</h2>
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
