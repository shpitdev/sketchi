import { BrandIcon } from "../brand-icon/index.js";
import { CopyButton } from "../copy-button/index.js";
import {
  CLI_NODE_REQUIREMENT,
  CLI_NPM_URL,
  CLI_PACKAGE_NAME,
  cliInstallOptions,
} from "../../lib/cli-package";
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
  { href: "#cli", label: "CLI" },
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
          brand logos and all. You can use it three ways.
        </p>

        <section className="docs-section" id="how">
          <h2>Three paths</h2>
          <p>
            You describe it. Sketchi structures and validates the request before
            drawing, so the result stays consistent, not a best-guess sketch.
            What differs between the three paths is where that happens and who
            keeps the file.
          </p>

          <div className="docs-paths docs-paths--three">
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

            <div className="docs-lane docs-lane--cli">
              <p className="docs-lane__tag">The terminal</p>
              <ol className="docs-lane__steps">
                <li>
                  Run <code>sketchi generate --prompt "…"</code>.
                </li>
                <li>Sketchi validates it and commits a local record.</li>
                <li>Export PNG or Excalidraw offline.</li>
              </ol>
              <p className="docs-lane__state">
                Your machine keeps the file, under{" "}
                <code>~/.sketchi/diagrams</code>. Install it{" "}
                <a href="#cli">below</a>.
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

        <section className="docs-section" id="cli">
          <h2>The CLI</h2>
          <p>
            <code>{CLI_PACKAGE_NAME}</code> is published on npm and authors
            diagrams from your shell. Records live under{" "}
            <code>~/.sketchi/diagrams</code> with the canonical document, the
            Excalidraw artifact, and every prior revision, so nothing you make
            is trapped in a browser tab.
          </p>

          <h3 className="docs-h3">Install</h3>
          {cliInstallOptions.map((option) => (
            <div className="docs-install" key={option.command}>
              <div className="code-snippet">
                <pre className="docs-codeblock">
                  <code>{option.command}</code>
                </pre>
                <CopyButton label={option.label} value={option.command} />
              </div>
              <p className="docs-install__note">{option.detail}</p>
            </div>
          ))}
          <p className="docs-install__note">Requires {CLI_NODE_REQUIREMENT}.</p>

          <h3 className="docs-h3">What the commands do</h3>
          <dl className="docs-defs">
            <div className="docs-defs__row">
              <dt>
                <code>generate</code>
              </dt>
              <dd>
                Turn one prompt into a validated diagram. Makes a single
                credential-free HTTPS request — no key, token, account, or
                login.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>
                <code>create</code>, <code>edit</code>, <code>patch</code>
              </dt>
              <dd>
                Author and revise from canonical JSON, or apply semantic style
                and layout operations. Fully offline.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>
                <code>show</code>, <code>list</code>, <code>restore</code>
              </dt>
              <dd>
                Inspect a record, list the local store, and recover any retained
                revision. Fully offline.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>
                <code>export</code>
              </dt>
              <dd>
                Write PNG or Excalidraw. PNG rendering is deterministic and
                local; it never starts a browser or uses the network.
              </dd>
            </div>
            <div className="docs-defs__row">
              <dt>
                <code>share</code>, <code>pull</code>
              </dt>
              <dd>
                Publish an encrypted excalidraw.com snapshot link, then pull
                browser edits back into the record. One HTTPS request each. A
                share URL is a bearer secret: anyone with the full link can
                decrypt it, and Sketchi cannot revoke it.
              </dd>
            </div>
          </dl>

          <div className="docs-callout">
            <span className="docs-callout__k">For agents</span>
            <span>
              Every command takes <code>--output json</code> for a stable result
              envelope. <code>create</code>, <code>edit</code>, and{" "}
              <code>patch</code> take their JSON noninteractively through{" "}
              <code>--json</code> or <code>--file</code>; <code>generate</code>{" "}
              takes <code>--prompt</code>; and <code>export --dest -</code>{" "}
              streams raw bytes to stdout. Shell completions ship for zsh, bash,
              and fish.
            </span>
          </div>

          <div className="docs-callout">
            <span className="docs-callout__k">Package</span>
            <span>
              <a className="docs-npm-link" href={CLI_NPM_URL}>
                <BrandIcon label="npm" size={15} src="/brand/npm.svg" />
                npmjs.com/package/{CLI_PACKAGE_NAME}
              </a>
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
            <div className="docs-defs__row">
              <dt>Is there a CLI?</dt>
              <dd>
                Yes — <code>{CLI_PACKAGE_NAME}</code> on npm. See{" "}
                <a href="#cli">the CLI section</a> for install and commands.
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
