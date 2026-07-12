import type { CanonicalPaint, PaintSource, SvgDiagnostic } from "./types";

export type SvgAttributes = Readonly<Record<string, string>>;

export interface SvgElementDescriptor {
  readonly classes: readonly string[];
  readonly id: string | null;
  readonly name: string;
}

interface CssDeclaration {
  readonly important: boolean;
  readonly property: string;
  readonly value: string;
}

interface CssSpecificity {
  readonly classes: number;
  readonly ids: number;
  readonly types: number;
}

export interface CssRule {
  readonly declarations: readonly CssDeclaration[];
  readonly order: number;
  readonly selector: string;
  readonly specificity: CssSpecificity;
}

interface CascadedValue {
  readonly important: boolean;
  readonly order: number;
  readonly source: PaintSource;
  readonly specificity: CssSpecificity;
  readonly value: string;
}

interface InheritedValue {
  readonly inherited: boolean;
  readonly source: PaintSource;
  readonly value: string;
}

export interface PaintContext {
  readonly color: InheritedValue;
  readonly displayed: boolean;
  readonly fill: InheritedValue;
  readonly fillOpacity: number;
  readonly fillRule: "evenodd" | "nonzero";
  readonly opacity: number;
  readonly stroke: InheritedValue;
  readonly strokeOpacity: number;
  readonly strokeWidth: number;
  readonly visibility: "hidden" | "visible";
}

export interface ComputedElementStyle {
  readonly clipPath: string | null;
  readonly paint: PaintContext;
  readonly unsupportedProperties: readonly string[];
}

const ZERO_SPECIFICITY: CssSpecificity = { classes: 0, ids: 0, types: 0 };
const INLINE_SPECIFICITY: CssSpecificity = {
  classes: 0,
  ids: 1_000_000,
  types: 0,
};

export const DEFAULT_PAINT_CONTEXT: PaintContext = {
  color: { inherited: false, source: "default", value: "#000000" },
  displayed: true,
  fill: { inherited: false, source: "default", value: "#000000" },
  fillOpacity: 1,
  fillRule: "nonzero",
  opacity: 1,
  stroke: { inherited: false, source: "default", value: "none" },
  strokeOpacity: 1,
  strokeWidth: 1,
  visibility: "visible",
};

const PRESENTATION_PROPERTIES = new Set([
  "clip-path",
  "color",
  "display",
  "fill",
  "fill-opacity",
  "fill-rule",
  "opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "visibility",
]);

const UNSUPPORTED_PRESENTATION_PROPERTIES = new Set([
  "filter",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "paint-order",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "vector-effect",
]);

function recognizedProperty(property: string): boolean {
  return (
    PRESENTATION_PROPERTIES.has(property) ||
    UNSUPPORTED_PRESENTATION_PROPERTIES.has(property)
  );
}

function parseDeclarations(value: string): readonly CssDeclaration[] {
  return value.split(";").flatMap((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 0) {
      return [];
    }
    const property = entry.slice(0, separator).trim().toLowerCase();
    const rawValue = entry.slice(separator + 1).trim();
    if (!property || !rawValue) {
      return [];
    }
    const important = /!important\s*$/i.test(rawValue);
    const normalizedValue = rawValue.replace(/!important\s*$/i, "").trim();
    return normalizedValue
      ? [{ important, property, value: normalizedValue }]
      : [];
  });
}

function selectorSpecificity(selector: string): CssSpecificity | null {
  const normalized = selector.trim();
  if (!normalized || /[>+~:[\]]/.test(normalized)) {
    return null;
  }
  let ids = 0;
  let classes = 0;
  let types = 0;
  for (const token of normalized.split(/\s+/)) {
    ids += token.match(/#[\w-]+/g)?.length ?? 0;
    classes += token.match(/\.[\w-]+/g)?.length ?? 0;
    const type = /^[A-Za-z][\w-]*/.exec(token)?.[0];
    if (type && type !== "*") {
      types += 1;
    }
    if (!/^(?:\*|[A-Za-z][\w-]*)?(?:[.#][\w-]+)*$/.test(token)) {
      return null;
    }
  }
  return { classes, ids, types };
}

export function parseCssRules(
  styles: readonly { readonly css: string; readonly sourcePath: string }[],
): {
  readonly diagnostics: readonly SvgDiagnostic[];
  readonly rules: readonly CssRule[];
} {
  const diagnostics: SvgDiagnostic[] = [];
  const rules: CssRule[] = [];
  let order = 0;
  for (const style of styles) {
    const css = style.css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
    let cursor = 0;
    while (cursor < css.length) {
      while (/\s|;/.test(css[cursor] ?? "")) {
        cursor += 1;
      }
      if (cursor >= css.length) {
        break;
      }
      const openBrace = css.indexOf("{", cursor);
      if (openBrace < 0) {
        const remainder = css.slice(cursor).trim();
        if (remainder) {
          diagnostics.push({
            code: remainder.startsWith("@")
              ? "css-at-rule-unsupported"
              : "css-nesting-unsupported",
            elementId: null,
            feature: "style",
            message: `Unsupported CSS syntax: ${remainder}`,
            severity: "warning",
            sourcePath: style.sourcePath,
          });
        }
        break;
      }
      const selectorText = css.slice(cursor, openBrace).trim();
      let depth = 1;
      let nested = false;
      let quote: '"' | "'" | null = null;
      let closeBrace = openBrace + 1;
      for (; closeBrace < css.length && depth > 0; closeBrace += 1) {
        const character = css[closeBrace];
        if (quote) {
          if (character === quote && css[closeBrace - 1] !== "\\") {
            quote = null;
          }
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === "{") {
          depth += 1;
          nested = true;
        } else if (character === "}") {
          depth -= 1;
        }
      }
      const bodyEnd = depth === 0 ? closeBrace - 1 : css.length;
      cursor = closeBrace;
      if (selectorText.startsWith("@")) {
        diagnostics.push({
          code: "css-at-rule-unsupported",
          elementId: null,
          feature: "style",
          message: `Unsupported CSS at-rule: ${selectorText}`,
          severity: "warning",
          sourcePath: style.sourcePath,
        });
        continue;
      }
      if (nested || depth !== 0) {
        diagnostics.push({
          code: "css-nesting-unsupported",
          elementId: null,
          feature: "style",
          message: `Unsupported nested CSS rule: ${selectorText}`,
          severity: "warning",
          sourcePath: style.sourcePath,
        });
        continue;
      }
      const declarations = parseDeclarations(css.slice(openBrace + 1, bodyEnd));
      for (const rawSelector of selectorText.split(",")) {
        const selector = rawSelector.trim();
        const specificity = selectorSpecificity(selector);
        if (specificity === null) {
          diagnostics.push({
            code: "css-selector-unsupported",
            elementId: null,
            feature: "style",
            message: `Unsupported CSS selector: ${selector}`,
            severity: "warning",
            sourcePath: style.sourcePath,
          });
          continue;
        }
        rules.push({ declarations, order, selector, specificity });
        order += 1;
      }
    }
  }
  return { diagnostics, rules };
}

function tokenMatches(token: string, element: SvgElementDescriptor): boolean {
  const type = /^[A-Za-z][\w-]*/.exec(token)?.[0];
  if (type && type.toLowerCase() !== element.name.toLowerCase()) {
    return false;
  }
  const id = /#([\w-]+)/.exec(token)?.[1];
  if (id && id !== element.id) {
    return false;
  }
  const classes = [...token.matchAll(/\.([\w-]+)/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  return classes.every((className) => element.classes.includes(className));
}

function selectorMatches(
  selector: string,
  ancestry: readonly SvgElementDescriptor[],
): boolean {
  const tokens = selector.trim().split(/\s+/);
  let ancestorIndex = ancestry.length - 1;
  for (let tokenIndex = tokens.length - 1; tokenIndex >= 0; tokenIndex -= 1) {
    const token = tokens[tokenIndex];
    if (!token) {
      return false;
    }
    let matched = false;
    while (ancestorIndex >= 0) {
      const element = ancestry[ancestorIndex];
      ancestorIndex -= 1;
      if (element && tokenMatches(token, element)) {
        matched = true;
        break;
      }
      if (tokenIndex === tokens.length - 1) {
        return false;
      }
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}

function compareSpecificity(
  left: CssSpecificity,
  right: CssSpecificity,
): number {
  return (
    left.ids - right.ids ||
    left.classes - right.classes ||
    left.types - right.types
  );
}

function wins(
  candidate: CascadedValue,
  current: CascadedValue | undefined,
): boolean {
  if (!current) {
    return true;
  }
  if (candidate.important !== current.important) {
    return candidate.important;
  }
  return (
    compareSpecificity(candidate.specificity, current.specificity) > 0 ||
    (compareSpecificity(candidate.specificity, current.specificity) === 0 &&
      candidate.order >= current.order)
  );
}

function cascadedValues(
  attributes: SvgAttributes,
  ancestry: readonly SvgElementDescriptor[],
  rules: readonly CssRule[],
): ReadonlyMap<string, CascadedValue> {
  const values = new Map<string, CascadedValue>();
  for (const [property, value] of Object.entries(attributes)) {
    if (!recognizedProperty(property)) {
      continue;
    }
    values.set(property, {
      important: false,
      order: -1,
      source: "presentation",
      specificity: ZERO_SPECIFICITY,
      value,
    });
  }
  for (const rule of rules) {
    if (!selectorMatches(rule.selector, ancestry)) {
      continue;
    }
    for (const declaration of rule.declarations) {
      if (!recognizedProperty(declaration.property)) {
        continue;
      }
      const candidate: CascadedValue = {
        important: declaration.important,
        order: rule.order,
        source: "stylesheet",
        specificity: rule.specificity,
        value: declaration.value,
      };
      if (wins(candidate, values.get(declaration.property))) {
        values.set(declaration.property, candidate);
      }
    }
  }
  for (const declaration of parseDeclarations(attributes.style ?? "")) {
    if (!recognizedProperty(declaration.property)) {
      continue;
    }
    const candidate: CascadedValue = {
      important: declaration.important,
      order: Number.MAX_SAFE_INTEGER,
      source: "inline",
      specificity: INLINE_SPECIFICITY,
      value: declaration.value,
    };
    if (wins(candidate, values.get(declaration.property))) {
      values.set(declaration.property, candidate);
    }
  }
  return values;
}

function opacity(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const percentage = /^(.*)%$/.exec(value.trim())?.[1];
  const parsed = Number(percentage ?? value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(
    0,
    Math.min(1, percentage === undefined ? parsed : parsed / 100),
  );
}

function finiteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inheritedValue(
  local: CascadedValue | undefined,
  parent: InheritedValue,
  initial: string,
): InheritedValue {
  if (!local || local.value === "inherit" || local.value === "unset") {
    return { ...parent, inherited: true };
  }
  if (local.value === "initial") {
    return { inherited: false, source: "default", value: initial };
  }
  return { inherited: false, source: local.source, value: local.value };
}

export function computeElementStyle(
  parent: PaintContext,
  attributes: SvgAttributes,
  ancestry: readonly SvgElementDescriptor[],
  rules: readonly CssRule[],
): ComputedElementStyle {
  const values = cascadedValues(attributes, ancestry, rules);
  const fill = inheritedValue(values.get("fill"), parent.fill, "#000000");
  const stroke = inheritedValue(values.get("stroke"), parent.stroke, "none");
  const color = inheritedValue(values.get("color"), parent.color, "#000000");
  const fillOpacity = opacity(
    values.get("fill-opacity")?.value,
    parent.fillOpacity,
  );
  const strokeOpacity = opacity(
    values.get("stroke-opacity")?.value,
    parent.strokeOpacity,
  );
  const localFillRule = values.get("fill-rule")?.value;
  const fillRule =
    localFillRule === "evenodd" || localFillRule === "nonzero"
      ? localFillRule
      : parent.fillRule;
  const display = values.get("display")?.value;
  const visibility = values.get("visibility")?.value;
  const computedVisibility =
    visibility === "visible"
      ? "visible"
      : visibility === "hidden" || visibility === "collapse"
        ? "hidden"
        : visibility === "initial"
          ? "visible"
          : parent.visibility;
  return {
    clipPath: values.get("clip-path")?.value ?? null,
    paint: {
      color,
      displayed: parent.displayed && display !== "none",
      fill,
      fillOpacity,
      fillRule,
      opacity: parent.opacity * opacity(values.get("opacity")?.value, 1),
      stroke,
      strokeOpacity,
      strokeWidth: finiteNumber(
        values.get("stroke-width")?.value,
        parent.strokeWidth,
      ),
      visibility: computedVisibility,
    },
    unsupportedProperties: [...UNSUPPORTED_PRESENTATION_PROPERTIES]
      .filter((property) => {
        const value = values.get(property)?.value.trim().toLowerCase();
        return (
          value !== undefined &&
          ((property !== "filter" && property !== "mask") || value !== "none")
        );
      })
      .sort(),
  };
}

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(normalized);
  return short
    ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    : null;
}

export function resolvePaint(
  paint: InheritedValue,
  opacityValue: number,
  color: InheritedValue,
  gradients: ReadonlyMap<string, string>,
): {
  readonly gradientId: string | null;
  readonly paint: CanonicalPaint | null;
} {
  const value = paint.value.trim();
  if (value.toLowerCase() === "none") {
    return { gradientId: null, paint: null };
  }
  const gradientId = /^url\(\s*#([^)\s]+)\s*\)$/.exec(value)?.[1] ?? null;
  if (gradientId) {
    return {
      gradientId,
      paint: {
        color: gradients.get(gradientId) ?? "#808080",
        inherited: paint.inherited,
        opacity: Math.max(0, Math.min(1, opacityValue)),
        source: "gradient",
      },
    };
  }
  const resolved = value.toLowerCase() === "currentcolor" ? color.value : value;
  return {
    gradientId: null,
    paint: {
      color: normalizeHexColor(resolved) ?? resolved.toLowerCase(),
      inherited: paint.inherited,
      opacity: Math.max(0, Math.min(1, opacityValue)),
      source: paint.source,
    },
  };
}

export function descriptor(
  name: string,
  attributes: SvgAttributes,
): SvgElementDescriptor {
  return {
    classes: (attributes.class ?? "").split(/\s+/).filter(Boolean),
    id: attributes.id ?? null,
    name,
  };
}
