import type { ArrowElement, ShapeElement } from "./diagram-structure";

export type LayoutDirection = "TB" | "LR" | "BT" | "RL";
export type EdgeRouting = "straight" | "elbow";

export interface LayoutConfig {
  rankdir: LayoutDirection;
  nodesep: number;
  ranksep: number;
  edgesep: number;
  edgeRouting: EdgeRouting;
}

export interface PositionedShape extends ShapeElement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedArrow extends ArrowElement {
  x: number;
  y: number;
  width: number;
  height: number;
  points: [number, number][];
  elbowed: boolean;
}

export interface LayoutedDiagram {
  shapes: PositionedShape[];
  arrows: PositionedArrow[];
}

export interface LayoutOverrides {
  direction?: LayoutDirection;
  nodesep?: number;
  ranksep?: number;
  edgesep?: number;
  edgeRouting?: EdgeRouting;
}
