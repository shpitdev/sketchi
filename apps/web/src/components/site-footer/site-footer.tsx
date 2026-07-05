import {
  DEFAULT_WEB_SURFACE_URLS,
  type WebSurfaceUrls,
} from "../../lib/surface-urls";

export interface SiteFooterProps {
  colophon?: string;
  surfaceUrls?: WebSurfaceUrls;
}

export function SiteFooter({
  colophon = "Sketchi v2 — typed diagram generation",
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
            Prompt-to-diagram tooling with validated IR, deterministic
            rendering, and artifact-ready output.
          </p>
        </div>

        <div className="site-footer__col">
          <h3>Product</h3>
          <ul>
            <li>
              <a href="/#pipeline">Pipeline</a>
            </li>
            <li>
              <a href="/docs">Docs</a>
            </li>
            <li>
              <a href={surfaceUrls.playground}>Playground</a>
            </li>
            <li>
              <a href="/agents">Agent setup</a>
            </li>
          </ul>
        </div>

        <div className="site-footer__col">
          <h3>Surfaces</h3>
          <ul>
            <li>
              <a href={surfaceUrls.icons}>Icons</a>
            </li>
            <li>
              <a href="/docs#studio-beta">Studio beta</a>
            </li>
            <li>
              <a href="/docs#surfaces">Surface map</a>
            </li>
          </ul>
        </div>

        <div className="site-footer__col">
          <h3>Project</h3>
          <ul>
            <li>
              <a href="/docs#deploy">Deploy</a>
            </li>
            <li>
              <a href="/docs#no-auth">No-auth status</a>
            </li>
            <li>
              <a href="https://github.com/shpitdev/sketchi">Upstream</a>
            </li>
          </ul>
        </div>
      </div>

      <div className="site-footer__base">
        <div className="sk-shell site-footer__base-inner">
          <span>{colophon}</span>
          <span>No sign-in · PR previews · workers.dev production</span>
        </div>
      </div>
    </footer>
  );
}
