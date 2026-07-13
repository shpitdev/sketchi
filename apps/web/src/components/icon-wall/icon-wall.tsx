import { BrandIcon } from "../brand-icon/index.js";
import { DEFAULT_WEB_SURFACE_URLS } from "../../lib/surface-urls";

export interface IconWallProps {
  /** Link to the full icon library surface. */
  iconsHref?: string;
}

const rowOne = [
  "react",
  "typescript",
  "nextjs",
  "tailwindcss",
  "nodejs",
  "python",
  "go",
  "rust",
  "graphql",
  "prisma",
  "figma",
  "linear",
  "notion",
  "slack",
];

const rowTwo = [
  "cloudflare",
  "aws",
  "googlecloud",
  "vercel",
  "docker",
  "kubernetes",
  "postgresql",
  "redis",
  "mongodb",
  "supabase",
  "github",
  "openai",
  "anthropic",
];

function label(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function Rail({
  slugs,
  reverse,
}: {
  slugs: readonly string[];
  reverse?: boolean;
}) {
  // The track is duplicated so the marquee can loop seamlessly.
  const doubled = [...slugs, ...slugs];

  return (
    <div className="icon-rail">
      <div
        className={`icon-rail__track${
          reverse ? " icon-rail__track--reverse" : ""
        }`}
      >
        {doubled.map((slug, index) => (
          <BrandIcon
            key={`${slug}-${index}`}
            label={label(slug)}
            loading="eager"
            size={30}
            src={`/brand/${slug}.svg`}
            tile
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A moving wall of Sketchi's own brand icons — the library made tangible.
 */
export function IconWall({
  iconsHref = DEFAULT_WEB_SURFACE_URLS.icons,
}: IconWallProps) {
  return (
    <section className="sk-section icon-wall" id="icons">
      <div className="sk-shell">
        <div className="icon-wall__head">
          <div className="icon-wall__copy">
            <h2 className="sk-section__title">
              Every logo you need, already sketched.
            </h2>
            <p className="sk-section__lead">
              Search 1,400+ curated brand and tech icons, the same set Sketchi
              drops straight into your diagrams.
            </p>
          </div>
          <a className="sk-btn sk-btn--ghost" href={iconsHref}>
            Browse the library →
          </a>
        </div>

        <div className="icon-wall__rails" aria-hidden="true">
          <Rail slugs={rowOne} />
          <Rail reverse slugs={rowTwo} />
        </div>
      </div>
    </section>
  );
}
