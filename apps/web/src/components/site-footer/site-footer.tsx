import {
  DEFAULT_WEB_SURFACE_URLS,
  type WebSurfaceUrls,
} from "../../lib/surface-urls";

export interface SiteFooterProps {
  colophon?: string;
  surfaceUrls?: WebSurfaceUrls;
}

export function SiteFooter({
  colophon = "Made for people who'd rather describe a diagram than draw one.",
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
            Prompts become real, editable diagrams — logos included.
          </p>
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
              <a href="https://github.com/shpitdev/sketchi">GitHub</a>
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
