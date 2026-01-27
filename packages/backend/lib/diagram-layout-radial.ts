import { sortArrows, sortShapes } from "./diagram-layout-sorting";
import type {
  LayoutedDiagram,
  PositionedArrow,
  PositionedShape,
} from "./diagram-layout-types";
import type { ArrowElement, Diagram, ShapeElement } from "./diagram-structure";

interface TreeNode {
  id: string;
  children: TreeNode[];
  depth: number;
  angle: number;
  startAngle: number;
  endAngle: number;
}

function buildTree(
  shapes: ShapeElement[],
  arrows: ArrowElement[]
): TreeNode | null {
  const childMap = new Map<string, string[]>();
  const parentSet = new Set<string>();

  for (const arrow of arrows) {
    const children = childMap.get(arrow.fromId) ?? [];
    children.push(arrow.toId);
    childMap.set(arrow.fromId, children);
    parentSet.add(arrow.toId);
  }

  for (const children of childMap.values()) {
    children.sort((a, b) => a.localeCompare(b));
  }

  const roots = shapes.filter((shape) => !parentSet.has(shape.id));
  if (roots.length === 0) {
    return null;
  }

  const rootShape = roots[0];
  if (!rootShape) {
    return null;
  }
  const rootId = rootShape.id;
  const visited = new Set<string>();

  function buildNode(id: string, depth: number): TreeNode | null {
    if (visited.has(id)) {
      return null;
    }
    visited.add(id);
    const childIds = childMap.get(id) ?? [];
    const children: TreeNode[] = [];

    for (const childId of childIds) {
      const child = buildNode(childId, depth + 1);
      if (!child) {
        return null;
      }
      children.push(child);
    }

    return {
      id,
      depth,
      children,
      angle: 0,
      startAngle: 0,
      endAngle: 0,
    };
  }

  return buildNode(rootId, 0);
}

function assignRadialAngles(
  node: TreeNode,
  startAngle: number,
  endAngle: number
): void {
  node.startAngle = startAngle;
  node.endAngle = endAngle;
  node.angle = (startAngle + endAngle) / 2;

  if (node.children.length === 0) {
    return;
  }

  const sweep = endAngle - startAngle;
  const childSweep = sweep / node.children.length;
  let currentAngle = startAngle;

  for (const child of node.children) {
    assignRadialAngles(child, currentAngle, currentAngle + childSweep);
    currentAngle += childSweep;
  }
}

export function applyRadialLayout(diagram: Diagram): LayoutedDiagram {
  const shapes = sortShapes(diagram.shapes);
  const arrows = sortArrows(diagram.arrows);
  const root = buildTree(shapes, arrows);
  const layerThickness = 200;
  const centerX = 400;
  const centerY = 400;

  if (!root) {
    return { shapes: [], arrows: [] };
  }

  assignRadialAngles(root, 0, 2 * Math.PI);

  const nodePositions = new Map<string, { x: number; y: number }>();

  function positionNodes(node: TreeNode): void {
    const radius = node.depth * layerThickness;
    const x = centerX + Math.cos(node.angle) * radius;
    const y = centerY + Math.sin(node.angle) * radius;
    nodePositions.set(node.id, { x, y });

    for (const child of node.children) {
      positionNodes(child);
    }
  }

  positionNodes(root);

  const shapeMap = new Map<string, PositionedShape>();
  const positionedShapes: PositionedShape[] = shapes.map((shape) => {
    const pos = nodePositions.get(shape.id) ?? { x: centerX, y: centerY };
    const width = shape.width ?? 140;
    const height = shape.height ?? 60;
    const positioned: PositionedShape = {
      ...shape,
      x: pos.x - width / 2,
      y: pos.y - height / 2,
      width,
      height,
    };
    shapeMap.set(shape.id, positioned);
    return positioned;
  });

  const positionedArrows: PositionedArrow[] = arrows.map((arrow) => {
    const startShape = shapeMap.get(arrow.fromId);
    const endShape = shapeMap.get(arrow.toId);

    if (!(startShape && endShape)) {
      return {
        ...arrow,
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        points: [
          [0, 0],
          [100, 0],
        ] as [number, number][],
        elbowed: false,
      };
    }

    const startCx = startShape.x + startShape.width / 2;
    const startCy = startShape.y + startShape.height / 2;
    const endCx = endShape.x + endShape.width / 2;
    const endCy = endShape.y + endShape.height / 2;

    const dx = endCx - startCx;
    const dy = endCy - startCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;

    const startX = startCx + ux * (startShape.width / 2);
    const startY = startCy + uy * (startShape.height / 2);
    const endX = endCx - ux * (endShape.width / 2);
    const endY = endCy - uy * (endShape.height / 2);

    return {
      ...arrow,
      x: startX,
      y: startY,
      width: endX - startX,
      height: endY - startY,
      points: [
        [0, 0],
        [endX - startX, endY - startY],
      ] as [number, number][],
      elbowed: false,
    };
  });

  return { shapes: positionedShapes, arrows: positionedArrows };
}
