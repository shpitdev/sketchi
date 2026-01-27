const MIN_POINTS = 8;
const MAX_POINTS = 240;
const SAMPLE_STEP = 6;
const TARGET_SIZE = 100;

const randomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};

const randomInt = () => Math.floor(Math.random() * 2 ** 31);

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const transformPoint = (
  svg: SVGSVGElement,
  ctm: DOMMatrix | null,
  x: number,
  y: number
) => {
  if (!ctm) {
    return { x, y };
  }

  const svgPoint = svg.createSVGPoint();
  svgPoint.x = x;
  svgPoint.y = y;
  const transformed = svgPoint.matrixTransform(ctm);
  return { x: transformed.x, y: transformed.y };
};

const sampleGeometryPoints = (
  element: SVGGeometryElement,
  svg: SVGSVGElement
) => {
  let length = 0;
  try {
    length = element.getTotalLength();
  } catch {
    length = 0;
  }

  const ctm = element.getCTM();

  if (!Number.isFinite(length) || length <= 0) {
    try {
      const bounds = element.getBBox();
      if (bounds.width <= 0 || bounds.height <= 0) {
        return [];
      }

      const boxPoints = [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y },
      ];

      return boxPoints.map((point) =>
        transformPoint(svg, ctm, point.x, point.y)
      );
    } catch {
      return [];
    }
  }

  const samples = clamp(
    Math.ceil(length / SAMPLE_STEP),
    MIN_POINTS,
    MAX_POINTS
  );
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i <= samples; i += 1) {
    const point = element.getPointAtLength((length * i) / samples);
    points.push(transformPoint(svg, ctm, point.x, point.y));
  }

  return points;
};

const computeBounds = (points: { x: number; y: number }[]) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
};

interface ExcalidrawBaseElement {
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  id: string;
  fillStyle: "solid" | "hachure" | "cross-hatch" | "zigzag";
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  roughness: number;
  opacity: number;
  angle: number;
  x: number;
  y: number;
  strokeColor: string;
  backgroundColor: string;
  width: number;
  height: number;
  seed: number;
  groupIds: string[];
  roundness: { type: number; value?: number } | null;
  frameId: string | null;
  boundElements: { id: string; type: "arrow" | "text" }[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  index: string | null;
}

export interface ExcalidrawFreedrawElement extends ExcalidrawBaseElement {
  type: "freedraw";
  points: [number, number][];
  simulatePressure: boolean;
  pressures: number[];
}

export interface ExcalidrawTextElement extends ExcalidrawBaseElement {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  containerId: string | null;
  originalText: string;
  autoResize: boolean;
  lineHeight: number;
}

export type ExcalidrawElement =
  | ExcalidrawFreedrawElement
  | ExcalidrawTextElement;

export interface StyleSettings {
  fillStyle: "solid" | "hachure" | "cross-hatch" | "zigzag";
  roughness: number;
  bowing: number;
  randomize: boolean;
  pencilFilter: boolean;
  showLabel: boolean;
  labelSize: number;
}

const SVG_EXTENSION_REGEX = /\.svg$/i;
const SEPARATOR_REGEX = /[-_]/g;

const formatLabelText = (filename: string) =>
  filename
    .replace(SVG_EXTENSION_REGEX, "")
    .replace(SEPARATOR_REGEX, " ")
    .trim();

export const svgToExcalidrawElements = (
  svgText: string,
  styleSettings: StyleSettings,
  iconName?: string
): ExcalidrawElement[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const parsedSvg = doc.querySelector("svg") as SVGSVGElement | null;
  const parseError = doc.querySelector("parsererror");

  if (!parsedSvg || parseError) {
    throw new Error("Unable to parse SVG.");
  }

  let container: HTMLDivElement | null = null;
  let svg = parsedSvg;

  if (typeof document !== "undefined" && document.body) {
    container = document.createElement("div");
    container.style.cssText =
      "position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;visibility:hidden;";
    container.appendChild(document.importNode(parsedSvg, true));
    document.body.appendChild(container);
    const attached = container.querySelector("svg") as SVGSVGElement | null;
    if (attached) {
      svg = attached;
    }
  }

  try {
    const geometryElements = Array.from(
      svg.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon")
    ).filter((element) => "getTotalLength" in element) as SVGGeometryElement[];

    const pathPoints = geometryElements
      .map((element) => sampleGeometryPoints(element, svg))
      .filter((points) => points.length > 1);

    if (pathPoints.length === 0) {
      throw new Error("SVG has no usable geometry.");
    }

    const flattened = pathPoints.flat();
    const bounds = computeBounds(flattened);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const scale =
      width > 0 || height > 0 ? TARGET_SIZE / Math.max(width, height) : 1;

    const groupId = randomId();
    const updated = Date.now();

    const scaledWidth = width * scale;
    const scaledHeight = height * scale;

    const freedrawElements: ExcalidrawFreedrawElement[] = pathPoints.map(
      (points, index) => {
        const scaledPoints = points.map((point) => ({
          x: (point.x - bounds.minX) * scale,
          y: (point.y - bounds.minY) * scale,
        }));

        const localBounds = computeBounds(scaledPoints);
        const elementX = localBounds.minX;
        const elementY = localBounds.minY;
        const elementPoints = scaledPoints.map(
          (point) =>
            [point.x - localBounds.minX, point.y - localBounds.minY] as [
              number,
              number,
            ]
        );

        return {
          type: "freedraw",
          version: 1,
          versionNonce: randomInt(),
          isDeleted: false,
          id: randomId(),
          fillStyle: styleSettings.fillStyle,
          strokeWidth: 2,
          strokeStyle: "solid",
          roughness: styleSettings.roughness,
          opacity: 100,
          angle: 0,
          x: elementX,
          y: elementY,
          strokeColor: "#000000",
          backgroundColor: "transparent",
          width: localBounds.maxX - localBounds.minX,
          height: localBounds.maxY - localBounds.minY,
          seed: randomInt(),
          groupIds: [groupId],
          roundness: null,
          frameId: null,
          boundElements: null,
          updated,
          link: null,
          locked: false,
          index: `a${index}`,
          points: elementPoints,
          simulatePressure: true,
          pressures: [],
        } satisfies ExcalidrawFreedrawElement;
      }
    );

    const elements: ExcalidrawElement[] = [...freedrawElements];

    if (styleSettings.showLabel && iconName) {
      const labelText = formatLabelText(iconName);
      const fontSize = styleSettings.labelSize;
      const lineHeight = 1.25;
      const textHeight = fontSize * lineHeight;
      const labelPadding = 8;

      const textElement: ExcalidrawTextElement = {
        type: "text",
        version: 1,
        versionNonce: randomInt(),
        isDeleted: false,
        id: randomId(),
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        angle: 0,
        x: scaledWidth / 2 - (labelText.length * fontSize * 0.5) / 2,
        y: scaledHeight + labelPadding,
        strokeColor: "#000000",
        backgroundColor: "transparent",
        width: labelText.length * fontSize * 0.5,
        height: textHeight,
        seed: randomInt(),
        groupIds: [groupId],
        roundness: null,
        frameId: null,
        boundElements: null,
        updated,
        link: null,
        locked: false,
        index: null,
        text: labelText,
        fontSize,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "top",
        containerId: null,
        originalText: labelText,
        autoResize: true,
        lineHeight: lineHeight as number & { _brand: "unitlessLineHeight" },
      };

      elements.push(textElement);
    }

    return elements;
  } finally {
    container?.remove();
  }
};
