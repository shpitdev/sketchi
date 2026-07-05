import {
  DEFAULT_WEB_SURFACE_URLS,
  PRODUCT_SURFACE_HOSTS,
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
  { href: "#surfaces", label: "Product routes" },
  { href: "#agent-setup", label: "Agent setup" },
  { href: "#pipeline", label: "Generation pipeline" },
  { href: "#diagram-types", label: "Diagram types" },
  { href: "#internal-surfaces", label: "Internal surfaces" },
  { href: "#no-auth", label: "No-auth status" },
  { href: "#deploy", label: "Deploy" },
];

const appSurfaceRows = [
  {
    desc: "A browser for the curated Sketchi icon output.",
    key: "icons",
    label: PRODUCT_SURFACE_HOSTS.icons,
    title: "Icon library",
  },
  {
    desc: "Anonymous prompt-to-diagram generation and artifact handoff.",
    key: "playground",
    label: PRODUCT_SURFACE_HOSTS.playground,
    title: "Sketchi Playground",
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
          outside the app shell. These docs name the product routes users can
          follow and the internal harnesses that stay out of public navigation.
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
            <span className="docs-section__idx">02</span> Product routes
          </h2>
          <p>
            Public links point to Sketchi product routes: homepage/docs,
            Playground, Icons, and agent setup. Studio is planned for persisted
            authenticated projects, but it is not the public try-it-now path
            until persistence exists.
          </p>
          <div className="docs-surface-map">
            <article className="docs-surface-map__home">
              <span className="docs-surface-map__k">Home</span>
              <h3>sketchi.app</h3>
              <p>Homepage, product documentation, and setup guides.</p>
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
            <article className="docs-surface-map__home" id="studio-beta">
              <span className="docs-surface-map__k">
                {PRODUCT_SURFACE_HOSTS.studio}
              </span>
              <h3>Studio</h3>
              <p>
                Private beta direction for authenticated projects, sessions,
                history, and collaboration.
              </p>
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

        <section className="docs-section" id="agent-setup">
          <h2>
            <span className="docs-section__idx">03</span> Agent setup
          </h2>
          <p>
            Agent setup now lives at <a href="/agents">sketchi.app/agents</a>.
            Keep user-facing setup links there; do not route users through the
            eval harness.
          </p>
          <dl className="docs-defs">
            <div className="docs-defs__row">
              <dt>Codex, Claude Code, OpenCode, Antigravity</dt>
              <dd>
                Plugin and MCP setup docs live in the repo docs and plugins
                directories while the product hub is built.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>Code Mode APIs</dt>
              <dd>
                Harness-facing APIs remain hosted by the Studio Worker, but the
                public setup path should describe Sketchi product behavior.
              </dd>
            </div>
          </dl>
        </section>

        <section className="docs-section" id="pipeline">
          <h2>
            <span className="docs-section__idx">04</span> Generation pipeline
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
            <span className="docs-section__idx">05</span> Diagram types
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

        <section className="docs-section" id="internal-surfaces">
          <h2>
            <span className="docs-section__idx">06</span> Internal surfaces
          </h2>
          <p>
            The eval harness and standalone Excalidraw app are not public
            product destinations. The harness remains for scenario fixtures,
            model-output inspection, and regression review. Excalidraw remains
            an implementation/editor capability exposed through product artifact
            routes.
          </p>
          <div className="docs-callout">
            <span className="docs-callout__k">Routing rule</span>
            <span>
              Public navigation must not link to the eval harness or a
              standalone <code>excalidraw.sketchi.app</code> product route.
            </span>
          </div>
        </section>

        <section className="docs-section" id="no-auth">
          <h2>
            <span className="docs-section__idx">07</span> No-auth status
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
            <span className="docs-section__idx">08</span> Deploy
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
