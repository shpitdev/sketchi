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
  surfaceUrls?: WebSurfaceUrls;
}

const defaultNav: readonly DocsNavEntry[] = [
  { href: "#overview", label: "Overview" },
  { href: "#how", label: "How it works" },
  { href: "#agents", label: "In your agent" },
  { href: "#diagram-types", label: "Diagram types" },
  { href: "#icons", label: "Icons" },
  { href: "#faq", label: "FAQ" },
];

export function DocsView({
  nav = defaultNav,
  surfaceUrls = DEFAULT_WEB_SURFACE_URLS,
}: DocsViewProps) {
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
        <p className="sk-eyebrow">Docs</p>
        <h1 className="sk-section__title">Everything Sketchi can do</h1>
        <p className="docs-article__intro">
          Sketchi turns a plain-language prompt into a clean, editable diagram —
          brand logos and all. Use it in the{" "}
          <a href={surfaceUrls.playground}>Sketchi Playground</a> with no
          sign-up, or connect it to the coding agent you already use.
        </p>

        <section className="docs-section" id="overview">
          <h2>
            <span className="docs-section__idx">01</span> Overview
          </h2>
          <p>
            You describe what you want to see — a system, a flow, an
            architecture — and Sketchi draws it. The result isn&rsquo;t a flat
            image: it&rsquo;s a real diagram made of shapes, arrows, and labels
            you can rearrange, restyle, and export.
          </p>
          <div className="docs-callout">
            <span className="docs-callout__k">Start here</span>
            <span>
              The fastest way to see it is the{" "}
              <a href={surfaceUrls.playground}>Sketchi Playground</a> — type a
              prompt and watch it become a diagram.
            </span>
          </div>
        </section>

        <section className="docs-section" id="how">
          <h2>
            <span className="docs-section__idx">02</span> How it works
          </h2>
          <p>
            Sketchi keeps you in charge of the words and takes care of the
            drawing. Under the hood it structures and checks your request before
            anything is drawn, so the diagram is consistent and correct — not a
            best-guess sketch.
          </p>
          <dl className="docs-defs">
            <div className="docs-defs__row">
              <dt>You describe</dt>
              <dd>Write what the diagram should show, in plain language.</dd>
            </div>
            <div className="docs-defs__row">
              <dt>Sketchi builds</dt>
              <dd>
                It lays out the nodes, routes the arrows, and drops in the right
                brand logos.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>You edit</dt>
              <dd>
                Open the diagram on the canvas, adjust anything by hand, and
                export it.
              </dd>
            </div>
          </dl>
        </section>

        <section className="docs-section" id="agents">
          <h2>
            <span className="docs-section__idx">03</span> In your coding agent
          </h2>
          <p>
            Sketchi plugs into Claude Code, Codex, OpenCode, and Antigravity.
            Connect it once and ask for a diagram in chat — you&rsquo;ll get a
            real, editable Sketchi diagram back without leaving your editor.
            Full instructions live on the <a href="/agents">agents page</a>.
          </p>
        </section>

        <section className="docs-section" id="diagram-types">
          <h2>
            <span className="docs-section__idx">04</span> Diagram types
          </h2>
          <p>
            Every diagram type is held to the same bar for layout and
            readability before it ships.
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
            clouds, frameworks, AI models, and more — so your diagrams look like
            your actual stack. The same set is available to browse and copy on
            its own.
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
              <dt>Are the diagrams editable?</dt>
              <dd>
                Yes. Every element is a real object you can move, relabel, and
                restyle on the canvas.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>Can I export?</dt>
              <dd>
                Yes — take your diagram to your docs, slides, or pull request.
              </dd>
            </div>
          </dl>
        </section>
      </article>
    </div>
  );
}
