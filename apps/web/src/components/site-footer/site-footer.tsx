import { BrandIcon } from "../brand-icon/index.js";
import { CLI_NPM_URL } from "../../lib/cli-package";
import {
  DEFAULT_WEB_SURFACE_URLS,
  type WebSurfaceUrls,
} from "../../lib/surface-urls";

export interface SiteFooterProps {
  colophon?: string;
  // Every surface that renders this footer must actually serve the file it
  // points at; pass an absolute URL when the surface has no llms.txt of its own.
  llmsTxtUrl?: string;
  npmUrl?: string;
  repoUrl?: string;
  surfaceUrls?: WebSurfaceUrls;
}

const DEFAULT_REPO_URL = "https://github.com/shpitdev/sketchi";
const DEFAULT_LLMS_TXT_URL = "/llms.txt";

export function SiteFooter({
  colophon = "Made for people who'd rather describe a diagram than draw one.",
  llmsTxtUrl = DEFAULT_LLMS_TXT_URL,
  npmUrl = CLI_NPM_URL,
  repoUrl = DEFAULT_REPO_URL,
  surfaceUrls = DEFAULT_WEB_SURFACE_URLS,
}: SiteFooterProps) {
  return (
    <footer className="site-footer">
      <div className="sk-shell site-footer__inner">
        <div className="site-footer__about">
          <span className="site-footer__brand">
            <img
              alt=""
              className="sk-icon"
              height="30"
              src="/icon.svg"
              width="30"
            />
            <span>Sketchi</span>
          </span>
          <p className="site-footer__tagline">
            Prompts become real, editable diagrams, logos included.
          </p>
          <a
            aria-label="Sketchi on GitHub"
            className="site-footer__gh"
            href={repoUrl}
            rel="noreferrer"
            target="_blank"
          >
            <span aria-hidden="true" className="gh-mark" />
            <span>Open source on GitHub</span>
          </a>
        </div>

        <div className="site-footer__col">
          <h3>Product</h3>
          <ul>
            <li>
              <a href={surfaceUrls.playground}>Playground</a>
            </li>
            <li>
              <a href={surfaceUrls.icons}>Icons</a>
            </li>
            <li>
              <a href="/#cli">CLI</a>
            </li>
            <li>
              <a href="/agents">Agents</a>
            </li>
            <li>
              <a href="/docs">Docs</a>
            </li>
          </ul>
        </div>

        <div className="site-footer__col">
          <h3>Agents</h3>
          <ul>
            <li>
              <a href="/agents/claude-code">Claude Code</a>
            </li>
            <li>
              <a href="/agents/codex">Codex</a>
            </li>
            <li>
              <a href="/agents/opencode">OpenCode</a>
            </li>
            <li>
              <a href="/agents/antigravity">Antigravity</a>
            </li>
          </ul>
        </div>

        <div className="site-footer__col">
          <h3>More</h3>
          <ul>
            <li>
              <a href="/docs">How it works</a>
            </li>
            <li>
              <a className="site-footer__npm" href={npmUrl}>
                <BrandIcon label="npm" size={15} src="/brand/npm.svg" />
                npm package
              </a>
            </li>
            <li>
              <a href={repoUrl}>GitHub</a>
            </li>
            <li>
              <a href={llmsTxtUrl}>llms.txt</a>
            </li>
          </ul>
        </div>
      </div>

      <div className="site-footer__base">
        <div className="sk-shell site-footer__base-inner">
          <span>{colophon}</span>
          <span>© Sketchi</span>
        </div>
      </div>
    </footer>
  );
}
