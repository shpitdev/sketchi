import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";

import appStyles from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        name: "description",
        content:
          "Search, copy, and download more than 1,400 SVG icons from Sketchi.",
      },
      { name: "theme-color", content: "#f6f1e7" },
      { title: "Sketchi Icons" },
    ],
    links: [
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      // Excalifont's Latin subset backs the wordmark; preload it so the
      // lockup paints in the product's own hand instead of reflowing
      // through the sans fallback.
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "/fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2",
        crossOrigin: "anonymous",
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Hanken+Grotesk:wght@400..700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
      },
      { rel: "stylesheet", href: appStyles },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

function NotFoundComponent() {
  return (
    <main className="sketchi-icons-not-found">
      <h1>Not found</h1>
      <a href="/">Browse icons</a>
    </main>
  );
}
