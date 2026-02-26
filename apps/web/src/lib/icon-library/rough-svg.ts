const STYLE_RULE_REGEX = /([^{}]+)\{([^{}]+)\}/g;
const STYLE_DECLARATION_REGEX = /([a-z-]+)\s*:\s*([^;]+)\s*;?/gi;
const VIEWBOX_SPLIT_REGEX = /[,\s]+/;
const IMPORTANT_SUFFIX_REGEX = /\s*!important\s*$/i;
const QUOTED_VALUE_REGEX = /^(["'])(.*)\1$/;

const PRESENTATION_PROPERTIES = new Set([
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
]);

const INHERITABLE_PRESENTATION_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "opacity",
] as const;

const DRAWABLE_SELECTOR = "path,rect,circle,ellipse,line,polyline,polygon,use";
const MIN_VIEWBOX_PADDING = 2;
const VIEWBOX_PADDING_RATIO = 0.04;

const parseStyleDeclarations = (declarations: string) => {
  const output = new Map<string, string>();

  for (const match of declarations.matchAll(STYLE_DECLARATION_REGEX)) {
    const property = match[1]?.trim().toLowerCase();
    if (!(property && PRESENTATION_PROPERTIES.has(property))) {
      continue;
    }

    const value = match[2]
      ?.replace(IMPORTANT_SUFFIX_REGEX, "")
      .trim()
      .replace(QUOTED_VALUE_REGEX, "$2");

    if (!value) {
      continue;
    }

    output.set(property, value);
  }

  return output;
};

const parseRuleSelectors = (selectorsText: string) =>
  selectorsText
    .split(",")
    .map((selector) => selector.trim())
    .filter(Boolean);

const querySelectorSafe = (svg: SVGSVGElement, selector: string) => {
  try {
    return svg.querySelectorAll<SVGElement>(selector);
  } catch {
    return null;
  }
};

const applyDeclarationsToSelector = (
  svg: SVGSVGElement,
  selector: string,
  declarations: Map<string, string>
) => {
  const elements = querySelectorSafe(svg, selector);
  if (!elements) {
    return;
  }

  for (const element of elements) {
    for (const [property, value] of declarations) {
      element.setAttribute(property, value);
    }
  }
};

const applyStyleRule = (
  svg: SVGSVGElement,
  selectorsText: string,
  declarationsText: string
) => {
  const declarations = parseStyleDeclarations(declarationsText);
  if (declarations.size === 0) {
    return;
  }

  for (const selector of parseRuleSelectors(selectorsText)) {
    applyDeclarationsToSelector(svg, selector, declarations);
  }
};

const applyInlineStylesFromStylesheetRules = (svg: SVGSVGElement) => {
  const styleElements = Array.from(svg.querySelectorAll("style"));

  for (const styleElement of styleElements) {
    const cssText = styleElement.textContent;
    if (!cssText) {
      continue;
    }

    for (const rule of cssText.matchAll(STYLE_RULE_REGEX)) {
      const selectorsText = rule[1]?.trim();
      const declarationsText = rule[2];
      if (!(selectorsText && declarationsText)) {
        continue;
      }

      applyStyleRule(svg, selectorsText, declarationsText);
    }
  }
};

const inheritParentPresentationAttributes = (svg: SVGSVGElement) => {
  const drawables = svg.querySelectorAll<SVGElement>(DRAWABLE_SELECTOR);

  for (const drawable of drawables) {
    for (const property of INHERITABLE_PRESENTATION_PROPERTIES) {
      if (drawable.hasAttribute(property)) {
        continue;
      }

      let ancestor: Element | null = drawable.parentElement;
      while (ancestor && ancestor !== svg) {
        const value = ancestor.getAttribute(property);
        if (value) {
          drawable.setAttribute(property, value);
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }
  }
};

const parseViewBox = (value: string | null) => {
  if (!value) {
    return null;
  }

  const values = value
    .trim()
    .split(VIEWBOX_SPLIT_REGEX)
    .filter(Boolean)
    .map((part) => Number.parseFloat(part));

  if (values.length !== 4 || values.some((part) => Number.isNaN(part))) {
    return null;
  }

  return {
    minX: values[0],
    minY: values[1],
    width: Math.abs(values[2]),
    height: Math.abs(values[3]),
  };
};

const parseDimension = (value: string | null) => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  if (!(Number.isFinite(parsed) && parsed > 0)) {
    return null;
  }
  return parsed;
};

const getBoundsForDisplay = (svg: SVGSVGElement) => {
  const parsedViewBox = parseViewBox(svg.getAttribute("viewBox"));
  const fallbackWidth = parseDimension(svg.getAttribute("width")) ?? 24;
  const fallbackHeight = parseDimension(svg.getAttribute("height")) ?? 24;

  let minX = parsedViewBox?.minX ?? 0;
  let minY = parsedViewBox?.minY ?? 0;
  let maxX = minX + (parsedViewBox?.width ?? fallbackWidth);
  let maxY = minY + (parsedViewBox?.height ?? fallbackHeight);

  try {
    const renderedBounds = svg.getBBox();
    if (renderedBounds.width > 0 && renderedBounds.height > 0) {
      minX = Math.min(minX, renderedBounds.x);
      minY = Math.min(minY, renderedBounds.y);
      maxX = Math.max(maxX, renderedBounds.x + renderedBounds.width);
      maxY = Math.max(maxY, renderedBounds.y + renderedBounds.height);
    }
  } catch {
    // Ignore getBBox failures and keep fallback bounds.
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return { minX, minY, width, height };
};

export const inlineSvgPaintStyles = (svg: SVGSVGElement) => {
  applyInlineStylesFromStylesheetRules(svg);
  inheritParentPresentationAttributes(svg);
};

export const makeRenderedSvgScalable = (container: HTMLElement) => {
  const svg = container.querySelector("svg");
  if (!svg) {
    return;
  }

  const bounds = getBoundsForDisplay(svg);
  const padding = Math.max(
    MIN_VIEWBOX_PADDING,
    Math.max(bounds.width, bounds.height) * VIEWBOX_PADDING_RATIO
  );

  svg.setAttribute(
    "viewBox",
    `${bounds.minX - padding} ${bounds.minY - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`
  );
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
};
