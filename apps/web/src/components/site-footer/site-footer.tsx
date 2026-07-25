import { CLI_NPM_URL } from "../../lib/cli-package";
import {
  DEFAULT_WEB_SURFACE_URLS,
  type WebSurfaceUrls,
} from "../../lib/surface-urls";

export interface SiteFooterProps {
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
              <a
                aria-label="sketchi on npm"
                className="site-footer__npm"
                href={npmUrl}
              >
                <span aria-hidden="true" className="npm-mark npm-mark--sm" />
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
          <span>© Sketchi</span>
        </div>
      </div>
    </footer>
  );
}
