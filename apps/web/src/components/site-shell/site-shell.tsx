import type { ReactNode } from "react";
import type { WebSurfaceUrls } from "../../lib/surface-urls";
import { SiteHeader } from "../site-header/index.js";
import { SiteFooter } from "../site-footer/index.js";

export function SiteShell({
  activePath,
  surfaceUrls,
  children,
}: {
  activePath: string;
  surfaceUrls: WebSurfaceUrls;
  children: ReactNode;
}) {
  return (
    <div className="sketchi-web">
      <SiteHeader activePath={activePath} surfaceUrls={surfaceUrls} />
      <main id={activePath === "/" ? "top" : undefined}>{children}</main>
      <SiteFooter surfaceUrls={surfaceUrls} />
    </div>
  );
}
