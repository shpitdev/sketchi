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

// Hand-drawn connectors (with arrowheads) in the 0–100 space the nodes sit in.
const wires: readonly { d: string; delay: number }[] = [
  { d: "M28 21 C 34 17, 40 17, 45 21 M42.5 19 L45 21 L42.5 23", delay: 0.15 },
  { d: "M52 28 C 50 35, 54 41, 52 46 M50 43.5 L52 46 L54 43.5", delay: 0.45 },
  // yes → ship
  { d: "M60 53 C 68 51, 74 52, 78 53 M75.5 51 L78 53 L75.5 55", delay: 0.85 },
  // no → back to build
  {
    d: "M44 54 C 31 52, 33 31, 45 27 M42.6 29.5 L45 27 L47.4 29.5",
    delay: 1.15,
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
          <p className="sk-eyebrow sk-rise" style={rise(0)}>
            Prompt to diagram
          </p>
          <h1 className="home-hero__title sk-rise" style={rise(1)}>
            Describe it.
            <br />
            Sketchi <em>draws it.</em>
          </h1>
          <p className="home-hero__lead sk-rise" style={rise(2)}>
            Turn a sentence into a clean, editable diagram — with the real logos
            of the tools in your stack. In the playground, or right inside your
            coding agent.
          </p>
          <div className="home-hero__actions sk-rise" style={rise(3)}>
            <a className="sk-btn sk-btn--primary" href={primaryHref}>
              Open the playground
            </a>
            <a className="sk-btn sk-btn--ghost" href={agentsHref}>
              Add to your agent
            </a>
          </div>
        </div>

        <div className="home-hero__visual sk-rise" style={rise(2)}>
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
              <svg
                className="sketch-board__wires"
                fill="none"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                {wires.map((wire) => (
                  <path
                    className="wire"
                    d={wire.d}
                    key={wire.d}
                    pathLength={1}
                    style={{ "--delay": `${wire.delay}s` } as CSSProperties}
                  />
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
