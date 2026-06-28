import { useState } from "react";

import {
  DEFAULT_WEB_SURFACE_URLS,
  type WebSurfaceUrls,
} from "../../lib/surface-urls";

export interface SiteHeaderNavItem {
  href: string;
  label: string;
}

export interface SiteHeaderProps {
  activePath?: string;
  navItems?: readonly SiteHeaderNavItem[];
  surfaceUrls?: WebSurfaceUrls;
}

const defaultNavItems: readonly SiteHeaderNavItem[] = [
  { href: "/#pipeline", label: "Pipeline" },
  { href: "/#surfaces", label: "Surfaces" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader({
  activePath,
  navItems = defaultNavItems,
  surfaceUrls = DEFAULT_WEB_SURFACE_URLS,
}: SiteHeaderProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="sk-shell site-header__bar">
        <a aria-label="Sketchi home" className="site-header__brand" href="/">
          <img
            alt=""
            className="sk-icon"
            height="30"
            src="/icon.svg"
            width="30"
          />
          <span className="sk-wordmark">Sketchi</span>
        </a>

        <nav aria-label="Primary" className="site-header__nav">
          {navItems.map((item) => (
            <a
              aria-current={activePath === item.href ? "page" : undefined}
              className="site-header__link"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="site-header__actions">
          <a className="site-header__link" href={surfaceUrls.icons}>
            Icons
          </a>
          <a
            className="sk-btn sk-btn--primary site-header__cta"
            href={surfaceUrls.excalidraw}
          >
            Open app
          </a>
        </div>

        <button
          aria-controls="site-menu"
          aria-expanded={open}
          aria-label="Toggle menu"
          className="site-header__burger"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="20"
            viewBox="0 0 20 20"
            width="20"
          >
            {open ? (
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            ) : (
              <path
                d="M3 6h14M3 10h14M3 14h14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <div className="sk-shell site-header__sheet" id="site-menu">
          {navItems.map((item) => (
            <a
              aria-current={activePath === item.href ? "page" : undefined}
              className="site-header__link"
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <div className="site-header__sheet-actions">
            <a className="sk-btn sk-btn--ghost" href={surfaceUrls.icons}>
              Icons
            </a>
            <a className="sk-btn sk-btn--primary" href={surfaceUrls.excalidraw}>
              Open app
            </a>
          </div>
        </div>
      ) : null}
    </header>
  );
}
