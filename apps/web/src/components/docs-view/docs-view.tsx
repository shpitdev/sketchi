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
  { href: "#diagram-types", label: "Diagram types" },
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
          Sketchi turns a plain-language prompt into a clean, editable diagram,
          brand logos and all. You can use it two ways.
        </p>

        <section className="docs-section" id="how">
          <h2>Two paths</h2>
          <p>
            You describe it. Sketchi structures and validates the request before
            drawing, so the result stays consistent, not a best-guess sketch.
            What differs between the two paths is where that happens and who
            keeps the file.
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
                Sketchi holds it as an unlisted link tied to your browser. No
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
                Your harness and machine keep the file; Sketchi just draws it.
                Setup for each agent lives on the{" "}
                <a href="/agents">agents page</a>.
              </p>
            </div>
          </div>

          <div className="docs-callout">
            <span className="docs-callout__k">See it live</span>
            <span>
              Open the{" "}
              <a href={liveExampleUrl}>interactive read-only diagram</a>, a real
              Sketchi diagram you can pan and zoom.
            </span>
          </div>
        </section>

        <section className="docs-section" id="open-source">
          <h2>Open source</h2>
          <p>
            Sketchi is built in the open and MIT-licensed: the diagram engine,
            the icon set, the agent runtime, even these pages. Read the code,
            file an issue, or run your own copy.
          </p>
          <div className="docs-callout">
            <span className="docs-callout__k">Source</span>
            <span>
              Browse the code at <a href={repoUrl}>{repoLabel(repoUrl)}</a>.
            </span>
          </div>
        </section>

        <section className="docs-section" id="diagram-types">
          <h2>Diagram types</h2>
          <dl className="docs-defs">
            <div className="docs-defs__row">
              <dt>Flowchart</dt>
              <dd>
                Start, process, decision, and end steps with labeled branches.
                The best-supported type today.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>Mindmap</dt>
              <dd>Radial breakdowns of an idea into related branches.</dd>
            </div>
          </dl>
        </section>

        <section className="docs-section" id="faq">
          <h2>FAQ</h2>
          <dl className="docs-defs">
            <div className="docs-defs__row">
              <dt>Do I need an account?</dt>
              <dd>No. The playground needs no sign-up.</dd>
            </div>
            <div className="docs-defs__row">
              <dt>Does my work save?</dt>
              <dd>
                Not to an account yet. Diagrams are tied to your browser, so
                export anything you want to keep.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>Are the diagrams editable?</dt>
              <dd>
                Yes. Every element is a real object you can move, relabel, and
                restyle.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>Can I export?</dt>
              <dd>Yes. Take it to your docs, slides, or pull request.</dd>
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
