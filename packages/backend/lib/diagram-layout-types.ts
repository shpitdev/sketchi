import type { ArrowElement, ShapeElement } from "./diagram-structure";

export type LayoutDirection = "TB" | "LR" | "BT" | "RL";
export type EdgeRouting = "straight" | "elbow";

export interface LayoutConfig {
  edgeRouting: EdgeRouting;
  edgesep: number;
  nodesep: number;
  rankdir: LayoutDirection;
  ranksep: number;
}

export interface PositionedShape extends ShapeElement {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface PositionedArrow extends ArrowElement {
  elbowed: boolean;
  height: number;
  points: [number, number][];
  width: number;
  x: number;
  y: number;
}

export interface LayoutedDiagram {
  arrows: PositionedArrow[];
  shapes: PositionedShape[];
}

export interface LayoutOverrides {
  direction?: LayoutDirection;
  edgeRouting?: EdgeRouting;
  edgesep?: number;
  nodesep?: number;
  ranksep?: number;
}
