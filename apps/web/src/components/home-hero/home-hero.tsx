import type { CSSProperties } from "react";

import { DEFAULT_WEB_SURFACE_URLS } from "../../lib/surface-urls";

export interface HomeHeroProps {
  agentsHref?: string;
  primaryHref?: string;
}

interface SketchNode {
  icon?: string;
  id: string;
  label: string;
  left: number;
  top: number;
  variant?: "decision" | "ship" | "start";
}

const nodes: readonly SketchNode[] = [
  {
    icon: "/brand/github.svg",
    id: "push",
    label: "push",
    left: 20,
    top: 21,
    variant: "start",
  },
  { icon: "/brand/docker.svg", id: "build", label: "build", left: 52, top: 21 },
  {
    id: "decision",
    label: "tests pass?",
    left: 52,
    top: 53,
    variant: "decision",
  },
  {
    icon: "/brand/cloudflare.svg",
    id: "ship",
    label: "ship",
    left: 82,
    top: 53,
    variant: "ship",
  },
];

// Each connector runs beneath its source and target node. The nodes mask the
// overlap, so every visible line meets an edge cleanly at every board width.
const wires: readonly {
  arrowD: string;
  d: string;
  delay: number;
  drawLength: number;
}[] = [
  {
    arrowD: "M41.5 18.5 L44.5 21 L41.5 23.5",
    d: "M20 21 C 31 18.5, 42 18.5, 52 21",
    delay: 0.15,
    drawLength: 220,
  },
  {
    arrowD: "M49.5 41.5 L52 44.5 L54.5 41.5",
    d: "M52 21 C 51.2 31, 52.8 42, 52 53",
    delay: 0.45,
    drawLength: 150,
  },
  // yes → ship
  {
    arrowD: "M72 50.7 L75 53 L72 55.3",
    d: "M52 53 C 62 51.5, 72 52, 82 53",
    delay: 0.85,
    drawLength: 200,
  },
  // no → back to build
  {
    arrowD: "M43.8 24.2 L47 25 L46.1 28.2",
    d: "M52 53 L39 53 C 35 53, 34 50, 34 46 L34 36 C 34 32, 37 29, 41 29 L52 21",
    delay: 1.15,
    drawLength: 310,
  },
];

/**
 * Hero: the thesis. A prompt becomes a hand-sketched flowchart whose nodes
 * carry Sketchi's own brand icons — text in, a real diagram out.
 */
export function HomeHero({
  agentsHref = "/agents",
  primaryHref = DEFAULT_WEB_SURFACE_URLS.playground,
}: HomeHeroProps) {
  return (
    <section className="home-hero">
      <div className="sk-shell home-hero__inner">
        <div className="home-hero__copy">
          <h1 className="home-hero__title sk-rise" style={rise(0)}>
            Describe it.
            <br />
            Sketchi <em>draws it.</em>
          </h1>
          <p className="home-hero__lead sk-rise" style={rise(1)}>
            Turn a sentence into a clean, editable diagram, with the real logos
            of your stack.
          </p>
          <div className="home-hero__actions sk-rise" style={rise(2)}>
            <a className="sk-btn sk-btn--accent" href={primaryHref}>
              Open the playground
            </a>
            <a className="sk-btn sk-btn--ghost" href={agentsHref}>
              Add to your agent
            </a>
          </div>
        </div>

        <div className="home-hero__visual sk-rise" style={rise(1)}>
          <div
            aria-label="A prompt reading 'diagram our deploy pipeline' turning into a hand-drawn flowchart with GitHub, Docker, and Cloudflare icons"
            className="sketch-board"
            role="img"
          >
            <div className="sketch-board__bar">
              <span className="sketch-board__dots">
                <i />
                <i />
                <i />
              </span>
              <span className="sketch-board__file">deploy-flow.sketchi</span>
            </div>

            <div className="sketch-board__prompt">
              <PencilGlyph />
              <span className="sketch-board__typed">
                Diagram our deploy pipeline
              </span>
              <span className="sketch-board__caret" aria-hidden="true" />
            </div>

            <div className="sketch-board__canvas">
              {/* Wires and nodes share one scene box so they scale together
                  as a unit on narrow screens, staying connected. */}
              <div className="sketch-board__scene">
                <svg
                  className="sketch-board__wires"
                  fill="none"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 100"
                >
                  {wires.map((wire) => (
                    <g
                      className="wire-group"
                      key={wire.d}
                      style={
                        {
                          "--delay": `${wire.delay}s`,
                          // The stroke does not scale, so the draw dash uses
                          // a rendered-pixel upper bound for every board size.
                          "--wire-length": wire.drawLength,
                        } as CSSProperties
                      }
                    >
                      <path className="wire" d={wire.d} />
                      <path className="wire-head" d={wire.arrowD} />
                    </g>
                  ))}
                </svg>

                <span className="sketch-tag sketch-tag--yes">yes</span>
                <span className="sketch-tag sketch-tag--no">no</span>

                {nodes.map((node) => (
                  <div
                    className={`sketch-node${
                      node.variant ? ` sketch-node--${node.variant}` : ""
                    }`}
                    key={node.id}
                    style={
                      {
                        left: `${node.left}%`,
                        top: `${node.top}%`,
                      } as CSSProperties
                    }
                  >
                    {node.icon ? (
                      <img
                        alt=""
                        className="sketch-node__icon"
                        height={24}
                        src={node.icon}
                        width={24}
                      />
                    ) : null}
                    <span className="sketch-node__label">{node.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function rise(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

function PencilGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="sketch-board__pencil"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <path
        d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3L11 2.5z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}
