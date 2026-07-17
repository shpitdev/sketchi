import {
  DEFAULT_WEB_SURFACE_URLS,
  type WebSurfaceUrls,
} from "../../lib/surface-urls";

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
  { href: "#open-source", label: "Open source" },
  { href: "#agents", label: "In your agent" },
  { href: "#diagram-types", label: "Diagram types" },
  { href: "#icons", label: "Icons" },
  { href: "#faq", label: "FAQ" },
];

const DEFAULT_REPO_URL = "https://github.com/shpitdev/sketchi";

export function DocsView({
  nav = defaultNav,
  repoUrl = DEFAULT_REPO_URL,
  surfaceUrls = DEFAULT_WEB_SURFACE_URLS,
}: DocsViewProps) {
  const liveExampleUrl = `${surfaceUrls.playground}/examples/how-it-works`;

  return (
    <div className="sk-shell docs-view">
      <nav aria-label="Docs sections" className="docs-nav">
        <p className="docs-nav__label">On this page</p>
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
          Sketchi turns a plain-language prompt into a clean, editable diagram —
          brand logos and all. There are two ways to use it, and which one you
          pick decides everything else.
        </p>

        <section className="docs-section" id="how">
          <h2>
            <span className="docs-section__idx">01</span> Two paths
          </h2>
          <p>
            You describe what you want to see. Sketchi structures and checks the
            request before it draws, so the diagram is consistent — not a
            best-guess sketch. The difference is <em>where</em> that happens and{" "}
            <em>who keeps the result</em>.
          </p>

          <div className="docs-paths">
            <div className="docs-lane docs-lane--human">
              <p className="docs-lane__tag">You, in the playground</p>
              <ol className="docs-lane__steps">
                <li>Describe a diagram in the browser.</li>
                <li>Sketchi draws it on the canvas.</li>
                <li>Edit and export it.</li>
              </ol>
              <p className="docs-lane__state">
                Sketchi holds it — as an unlisted link, tied to your browser. No
                account yet, so treat it as temporary.
              </p>
            </div>

            <div className="docs-lane docs-lane--agent">
              <p className="docs-lane__tag">Your coding agent</p>
              <ol className="docs-lane__steps">
                <li>Ask your agent for a diagram in chat.</li>
                <li>It calls Sketchi over MCP and gets one back.</li>
                <li>The diagram lands in your project.</li>
              </ol>
              <p className="docs-lane__state">
                Your harness and machine keep the file — Sketchi just draws it.
                State lives where your code does.
              </p>
            </div>
          </div>

          <div className="docs-callout">
            <span className="docs-callout__k">See it live</span>
            <span>
              Open the{" "}
              <a href={liveExampleUrl}>interactive read-only diagram</a> — a real
              Sketchi diagram you can pan and zoom, drawn from these very steps.
            </span>
          </div>
        </section>

        <section className="docs-section" id="open-source">
          <h2>
            <span className="docs-section__idx">02</span> Open source
          </h2>
          <p>
            Sketchi is built in the open. The whole thing — the diagram engine,
            the icon set, the agent runtime, even these pages — lives on GitHub.
            Read how it works, file an issue, fork it, or run your own copy.
          </p>
          <div className="docs-callout">
            <span className="docs-callout__k">Source</span>
            <span>
              Browse the code at <a href={repoUrl}>{repoLabel(repoUrl)}</a>.
            </span>
          </div>
        </section>

        <section className="docs-section" id="agents">
          <h2>
            <span className="docs-section__idx">03</span> In your coding agent
          </h2>
          <p>
            Sketchi plugs into Claude Code, Codex, OpenCode, and Antigravity.
            Connect it once and ask for a diagram in chat — you&rsquo;ll get a
            real, editable Sketchi diagram back without leaving your editor. Full
            setup lives on the <a href="/agents">agents page</a>.
          </p>
        </section>

        <section className="docs-section" id="diagram-types">
          <h2>
            <span className="docs-section__idx">04</span> Diagram types
          </h2>
          <p>
            Every type is held to the same bar for layout and readability before
            it ships.
          </p>
          <dl className="docs-defs">
            <div className="docs-defs__row">
              <dt>Flowchart</dt>
              <dd>
                Start, process, decision, and end steps with labeled branches —
                the best-supported type today.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>Mindmap</dt>
              <dd>Radial breakdowns of an idea into related branches.</dd>
            </div>
          </dl>
        </section>

        <section className="docs-section" id="icons">
          <h2>
            <span className="docs-section__idx">05</span> The icon library
          </h2>
          <p>
            Sketchi ships with 1,400+ curated brand and tech icons — databases,
            clouds, frameworks, AI models — so your diagrams look like your
            actual stack. The same set is browsable on its own.
          </p>
          <div className="docs-callout">
            <span className="docs-callout__k">Browse</span>
            <span>
              Open the <a href={surfaceUrls.icons}>Sketchi icon library</a> to
              search and copy any logo.
            </span>
          </div>
        </section>

        <section className="docs-section" id="faq">
          <h2>
            <span className="docs-section__idx">06</span> FAQ
          </h2>
          <dl className="docs-defs">
            <div className="docs-defs__row">
              <dt>Do I need an account?</dt>
              <dd>No — the playground is open and requires no sign-up.</dd>
            </div>
            <div className="docs-defs__row">
              <dt>Does my work save?</dt>
              <dd>
                Not to an account yet. Saved diagrams are tied to your browser,
                so treat them as temporary — export anything you want to keep.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>Are the diagrams editable?</dt>
              <dd>
                Yes. Every element is a real object you can move, relabel, and
                restyle on the canvas.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>Can I export?</dt>
              <dd>Yes — take it to your docs, slides, or pull request.</dd>
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
