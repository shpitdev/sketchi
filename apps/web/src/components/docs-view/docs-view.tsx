import { CommandBlock } from "../command-block/index.js";
import {
	CLI_INSTALL_COMMAND,
	CLI_NODE_REQUIREMENT,
	CLI_NPM_INSTALL_COMMAND,
	CLI_NPM_URL,
	REPO_URL,
} from "../../lib/cli-package";
import { DEFAULT_WEB_SURFACE_URLS, type WebSurfaceUrls } from "../../lib/surface-urls";

export interface DocsNavEntry {
	href: string;
	label: string;
}

export interface DocsViewProps {
	nav?: readonly DocsNavEntry[];
	repoUrl?: string;
	surfaceUrls?: WebSurfaceUrls;
}

const defaultNav: readonly DocsNavEntry[] = [
	{ href: "#how", label: "How it works" },
	{ href: "#cli", label: "CLI" },
	{ href: "#diagram-types", label: "Diagram types" },
	{ href: "#faq", label: "FAQ" },
];

export function DocsView({
	nav = defaultNav,
	repoUrl = REPO_URL,
	surfaceUrls = DEFAULT_WEB_SURFACE_URLS,
}: DocsViewProps) {
	const liveExampleUrl = `${surfaceUrls.playground}/examples/how-it-works`;

	return (
		<div className="sk-shell docs-view">
			<nav aria-label="Docs sections" className="docs-nav">
				<ul className="docs-nav__list">
					{nav.map((entry) => (
						<li key={entry.href}>
							<a href={entry.href}>{entry.label}</a>
						</li>
					))}
				</ul>
			</nav>

			<article className="docs-article">
				<h1 className="sk-section__title">How Sketchi works</h1>
				<p className="docs-article__intro">
					Describe a diagram and Sketchi draws it as an editable Excalidraw scene. Use it in the
					playground, your coding agent, or the CLI.
				</p>

				<section className="docs-section" id="how">
					<h2>Three ways to use it</h2>

					<div className="docs-paths docs-paths--three">
						<div className="docs-lane docs-lane--human">
							<h3 className="docs-lane__tag">Playground</h3>
							<ol className="docs-lane__steps">
								<li>Describe a diagram in the browser.</li>
								<li>Edit it on the canvas.</li>
								<li>Export PNG or Excalidraw.</li>
							</ol>
							<p className="docs-lane__state">
								Kept as an unlisted link tied to your browser. Export anything you want to keep.
							</p>
						</div>

						<div className="docs-lane docs-lane--agent">
							<h3 className="docs-lane__tag">Coding agent</h3>
							<ol className="docs-lane__steps">
								<li>Ask your agent for a diagram.</li>
								<li>It calls Sketchi over MCP.</li>
								<li>The diagram is saved in your project.</li>
							</ol>
							<p className="docs-lane__state">
								Set up on the <a href="/agents">agents page</a>.
							</p>
						</div>

						<div className="docs-lane docs-lane--cli">
							<h3 className="docs-lane__tag">CLI</h3>
							<ol className="docs-lane__steps">
								<li>
									Run <code>sketchi generate --prompt "…"</code>.
								</li>
								<li>Sketchi validates the diagram and keeps a record.</li>
								<li>The PNG is written to the current directory.</li>
							</ol>
							<p className="docs-lane__state">
								Records live in <code>~/.sketchi/diagrams</code>.
							</p>
						</div>
					</div>

					<p>
						Example: <a href={liveExampleUrl}>a read-only diagram you can pan and zoom</a>.
					</p>
				</section>

				<section className="docs-section" id="cli">
					<h2>CLI</h2>
					<p>
						<a href={CLI_NPM_URL}>sketchi on npm</a>. Requires {CLI_NODE_REQUIREMENT}.
					</p>
					<CommandBlock label="npm install command" value={CLI_NPM_INSTALL_COMMAND} />
					<p className="docs-install-alt">
						Or use the install script, which also sets up shell completions:
					</p>
					<CommandBlock label="install script" value={CLI_INSTALL_COMMAND} />

					<h3 className="docs-h3">Commands</h3>
					<dl className="docs-defs">
						<div className="docs-defs__row">
							<dt>
								<code>generate</code>
							</dt>
							<dd>Turn a prompt into a validated diagram and write its PNG. No account or key.</dd>
						</div>
						<div className="docs-defs__row">
							<dt>
								<code>create</code>, <code>edit</code>, <code>patch</code>
							</dt>
							<dd>
								Write or revise a diagram from JSON, or apply style and layout operations. Offline.
							</dd>
						</div>
						<div className="docs-defs__row">
							<dt>
								<code>show</code>, <code>list</code>, <code>restore</code>
							</dt>
							<dd>Inspect a record, list records, or restore an earlier revision. Offline.</dd>
						</div>
						<div className="docs-defs__row">
							<dt>
								<code>export</code>
							</dt>
							<dd>Write PNG or Excalidraw. Offline.</dd>
						</div>
						<div className="docs-defs__row">
							<dt>
								<code>share</code>, <code>pull</code>
							</dt>
							<dd>
								Publish an encrypted excalidraw.com link, then pull edits made there back into the
								record. Anyone with the full link can open it, and Sketchi cannot revoke it.
							</dd>
						</div>
					</dl>

					<p>
						For scripts and agents, every command takes <code>--output json</code>.{" "}
						<code>create</code>, <code>edit</code> and <code>patch</code> read JSON from{" "}
						<code>--json</code> or <code>--file</code>, and <code>--dest -</code> writes the
						artifact to stdout. <code>sketchi docs</code> prints the full contracts.
					</p>
				</section>

				<section className="docs-section" id="diagram-types">
					<h2>Diagram types</h2>
					<p>
						Flowchart, mindmap, sequence, timeline, chart, state machine, Gantt, ER, class, org
						chart, Venn, journey map, Sankey, wireframe and quadrant chart.
					</p>
				</section>

				<section className="docs-section" id="faq">
					<h2>FAQ</h2>
					<dl className="docs-defs">
						<div className="docs-defs__row">
							<dt>Do I need an account?</dt>
							<dd>No.</dd>
						</div>
						<div className="docs-defs__row">
							<dt>Where are my diagrams saved?</dt>
							<dd>
								The playground keeps them as unlisted links tied to your browser. Agents and the CLI
								save them on your machine.
							</dd>
						</div>
						<div className="docs-defs__row">
							<dt>Can I edit the result?</dt>
							<dd>Yes. Every shape, arrow and label is editable.</dd>
						</div>
						<div className="docs-defs__row">
							<dt>Is it open source?</dt>
							<dd>
								Yes, MIT-licensed: <a href={repoUrl}>{repoLabel(repoUrl)}</a>.
							</dd>
						</div>
					</dl>
				</section>
			</article>
		</div>
	);
}

function repoLabel(url: string): string {
	try {
		return `${new URL(url).host}${new URL(url).pathname}`.replace(/\/$/, "");
	} catch {
		return url;
	}
}
