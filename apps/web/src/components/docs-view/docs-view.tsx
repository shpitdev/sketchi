import {
  DEFAULT_WEB_SURFACE_URLS,
  surfaceLinkLabel,
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
  { href: "#surfaces", label: "App surfaces" },
  { href: "#pipeline", label: "Generation pipeline" },
  { href: "#diagram-types", label: "Diagram types" },
  { href: "#no-auth", label: "No-auth status" },
  { href: "#deploy", label: "Deploy" },
];

const appSurfaceRows = [
  {
    desc: "The no-auth diagram workspace built on the same pipeline.",
    key: "excalidraw",
    label: "excalidraw.sketchi.app",
    title: "Excalidraw workspace",
  },
  {
    desc: "A browser for the curated Sketchi icon output.",
    key: "icons",
    label: "icons.sketchi.app",
    title: "Icon library",
  },
  {
    desc: "Scenario evaluation and prompt-output inspection.",
    key: "playground",
    label: "playground.sketchi.app",
    title: "Scenario playground",
  },
] satisfies ReadonlyArray<{
  desc: string;
  key: keyof WebSurfaceUrls;
  label: string;
  title: string;
}>;

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
        <p className="sk-eyebrow">Documentation</p>
        <h1 className="sk-section__title">How Sketchi v2 is put together</h1>
        <p className="docs-article__intro">
          Sketchi makes diagram generation boring in the best way: inputs are
          validated, rendering is deterministic, and UI states are exercised
          outside the app shell. These docs cover the contracts that matter for
          the current no-auth phase.
        </p>

        <section className="docs-section" id="overview">
          <h2>
            <span className="docs-section__idx">01</span> Overview
          </h2>
          <p>
            A prompt is compiled into a typed intermediate representation (IR),
            validated, rendered into a deterministic scene, and converted into
            real Excalidraw elements. Each stage lives in its own package, so a
            defect fails close to its cause instead of somewhere downstream.
          </p>
          <p>
            The first high-reliability path is decision-heavy{" "}
            <code>flowchart</code> generation. Code owns layout, arrow routing,
            and text wrapping; the model only produces typed IR.
          </p>
        </section>

        <section className="docs-section" id="surfaces">
          <h2>
            <span className="docs-section__idx">02</span> App surfaces
          </h2>
          <p>
            The workspace ships five independently deployable surfaces. Each one
            owns its UI; shared diagram primitives stay in the studio package.
          </p>
          <div className="docs-surface-map">
            <article className="docs-surface-map__home">
              <span className="docs-surface-map__k">Home</span>
              <h3>sketchi.app</h3>
              <p>This home and the product documentation.</p>
            </article>
            {appSurfaceRows.map((surface) => {
              const href = surfaceUrls[surface.key];

              return (
                <a
                  className="docs-surface-map__link"
                  href={href}
                  key={surface.key}
                >
                  <span className="docs-surface-map__k">
                    {surfaceLinkLabel(href, surface.label)}
                  </span>
                  <h3>{surface.title}</h3>
                  <p>{surface.desc}</p>
                </a>
              );
            })}
            <article className="docs-surface-map__home">
              <span className="docs-surface-map__k">studio.sketchi.app</span>
              <h3>Studio</h3>
              <p>The no-auth agentic generation and artifact review surface.</p>
            </article>
          </div>
          <div className="docs-callout">
            <span className="docs-callout__k">Current URLs</span>
            <span>
              Review and production proof use direct <code>workers.dev</code>{" "}
              links until the custom domains are attached manually.
            </span>
          </div>
        </section>

        <section className="docs-section" id="pipeline">
          <h2>
            <span className="docs-section__idx">03</span> Generation pipeline
          </h2>
          <p>
            The pipeline keeps model output, typed IR, deterministic scenes, and
            Excalidraw conversion as separate, testable surfaces.
          </p>
          <dl className="docs-defs">
            <div className="docs-defs__row">
              <dt>diagram-core</dt>
              <dd>The IR, semantic validation, and reusable fixtures.</dd>
            </div>
            <div className="docs-defs__row">
              <dt>diagram-renderer</dt>
              <dd>Validated diagrams become a deterministic scene model.</dd>
            </div>
            <div className="docs-defs__row">
              <dt>diagram-excalidraw</dt>
              <dd>Scenes become persisted Excalidraw elements, validated.</dd>
            </div>
            <div className="docs-defs__row">
              <dt>diagram-scenarios</dt>
              <dd>Maintained prompts and assertions run against fixtures.</dd>
            </div>
          </dl>
          <p>Run the canonical fixture evaluation locally:</p>
          <pre className="docs-codeblock">
            <span className="tok-c">
              # deterministic IR → Excalidraw, no model
            </span>
            {"\n"}
            pnpm nx scenario diagram-scenarios -- \{"\n"}
            {"  "}--scenario pharma-batch-disposition --fixture
          </pre>
        </section>

        <section className="docs-section" id="diagram-types">
          <h2>
            <span className="docs-section__idx">04</span> Diagram types
          </h2>
          <p>
            Every registered diagram type is guarded by tests: it must have
            core, renderer, and Storybook coverage. New types are scaffolded
            with the workspace generator so they are previewable before being
            wired to generation.
          </p>
          <dl className="docs-defs">
            <div className="docs-defs__row">
              <dt>flowchart</dt>
              <dd>
                Start, process, decision, and end nodes with labeled branches —
                the first hard reliability target.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>mindmap</dt>
              <dd>A radial fixture used to keep the type registry honest.</dd>
            </div>
          </dl>
          <pre className="docs-codeblock">
            <span className="tok-c">
              # scaffold a new generated diagram type
            </span>
            {"\n"}
            pnpm nx g @sketchi/generators:diagram-type mindmap
          </pre>
        </section>

        <section className="docs-section" id="no-auth">
          <h2>
            <span className="docs-section__idx">05</span> No-auth status
          </h2>
          <div className="docs-callout">
            <span className="docs-callout__k">Current</span>
            <span>
              The deployable surfaces require no sign-in. Auth, persistence,
              billing, and multi-user collaboration are intentionally out of
              scope for this phase. States are designed so auth can be added
              later without a rewrite.
            </span>
          </div>
        </section>

        <section className="docs-section" id="deploy">
          <h2>
            <span className="docs-section__idx">06</span> Deploy
          </h2>
          <p>
            Pull requests deploy each app to a PR-specific Cloudflare Worker.
            Merges to <code>main</code> deploy production Workers to their{" "}
            <code>workers.dev</code> URLs without claiming the final{" "}
            <code>sketchi.app</code> domains.
          </p>
          <div className="docs-callout">
            <span className="docs-callout__k">Manual</span>
            <span>
              Domain attachment is a deliberate, manual{" "}
              <code>app-production-deploy</code> workflow dispatch. DNS cutover
              is never automatic.
            </span>
          </div>
        </section>
      </article>
    </div>
  );
}
