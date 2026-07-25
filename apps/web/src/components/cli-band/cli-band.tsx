import { BrandIcon } from "../brand-icon/index.js";
import { CopyButton } from "../copy-button/index.js";
import {
  CLI_EXAMPLE_COMMAND,
  CLI_NODE_REQUIREMENT,
  CLI_NPM_URL,
  CLI_PACKAGE_NAME,
  cliCapabilities,
  cliInstallOptions,
} from "../../lib/cli-package";

export interface CliBandProps {
  /** Link to the published npm package. */
  npmUrl?: string;
  /** Where the fuller CLI writeup lives. */
  docsHref?: string;
}

/**
 * The third way in. The playground and the agent route both get a full section
 * on this page; the terminal is a peer of both, so it gets one too — the
 * install command is the section, copy-pasteable, not a link to go find it.
 */
export function CliBand({
  docsHref = "/docs#cli",
  npmUrl = CLI_NPM_URL,
}: CliBandProps) {
  return (
    <section className="sk-section cli-band" id="cli">
      <div className="sk-shell cli-band__inner">
        <div className="cli-band__copy">
          <h2 className="sk-section__title cli-band__title">
            Or never leave the terminal.
          </h2>
          <p className="cli-band__lead">
            <code>{CLI_PACKAGE_NAME}</code> is a real command-line tool, not a
            wrapper around this website. It keeps your diagrams in{" "}
            <code>~/.sketchi/diagrams</code>, does its authoring, export, and
            recovery work offline, and speaks <code>--output json</code> on
            every command so an agent can drive it.
          </p>

          <dl className="cli-band__points">
            {cliCapabilities.map((capability) => (
              <div className="cli-band__point" key={capability.title}>
                <dt>{capability.title}</dt>
                <dd>{capability.description}</dd>
              </div>
            ))}
          </dl>

          <div className="cli-band__links">
            <a className="sk-btn sk-btn--ghost cli-band__npm" href={npmUrl}>
              <BrandIcon label="npm" size={18} src="/brand/npm.svg" />
              View on npm
            </a>
            <a className="cli-band__docs-link" href={docsHref}>
              Read the CLI docs →
            </a>
          </div>
        </div>

        <div className="cli-band__terminal">
          <div className="cli-band__bar" aria-hidden="true">
            <span className="cli-band__dots">
              <i />
              <i />
              <i />
            </span>
            <span className="cli-band__shell">zsh</span>
          </div>

          <div className="cli-band__body">
            {cliInstallOptions.map((option) => (
              <div className="cli-band__step" key={option.command}>
                <div className="code-snippet">
                  <pre className="docs-codeblock">
                    <code>{option.command}</code>
                  </pre>
                  <CopyButton label={option.label} value={option.command} />
                </div>
                <p className="cli-band__note">{option.detail}</p>
              </div>
            ))}

            <p className="cli-band__then">Then ask for a diagram:</p>
            <div className="code-snippet">
              <pre className="docs-codeblock">
                <code>{CLI_EXAMPLE_COMMAND}</code>
              </pre>
              <CopyButton label="example command" value={CLI_EXAMPLE_COMMAND} />
            </div>
            <p className="cli-band__req">Requires {CLI_NODE_REQUIREMENT}.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
