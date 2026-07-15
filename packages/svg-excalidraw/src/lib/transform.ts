import type { Matrix, Point, SvgDiagnostic } from "./types";

export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

export function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

export function transformPoint(point: Point, matrix: Matrix): Point {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

export function transformedStrokeScale(matrix: Matrix): number {
  // A scalar native stroke cannot encode anisotropic SVG strokes. Area scale
  // is exact for uniform scale and rotation, and stable for other matrices.
  return Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
}

export function numericTokens(value: string): readonly number[] {
  return (
    value.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? []
  );
}

function transformDiagnostic(
  message: string,
  sourcePath: string,
): SvgDiagnostic {
  return {
    code: "invalid-transform",
    elementId: null,
    feature: null,
    message,
    severity: "warning",
    sourcePath,
  };
}

function transformArguments(value: string): readonly number[] | null {
  const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y;
  const values: number[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    let separatedByWhitespace = false;
    while (/\s/.test(value[cursor] ?? "")) {
      separatedByWhitespace = true;
      cursor += 1;
    }
    if (cursor >= value.length) {
      break;
    }
    if (values.length > 0) {
      if (value[cursor] === ",") {
        cursor += 1;
        while (/\s/.test(value[cursor] ?? "")) {
          cursor += 1;
        }
      } else if (
        !separatedByWhitespace &&
        value[cursor] !== "+" &&
        value[cursor] !== "-"
      ) {
        return null;
      }
    }
    numberPattern.lastIndex = cursor;
    const match = numberPattern.exec(value);
    if (!match || match.index !== cursor) {
      return null;
    }
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    values.push(parsed);
    cursor = numberPattern.lastIndex;
  }
  return values.length > 0 ? values : null;
}

export function parseTransform(
  value: string | undefined,
  sourcePath: string,
): {
  readonly diagnostics: readonly SvgDiagnostic[];
  readonly matrix: Matrix;
} {
  if (!value?.trim()) {
    return { diagnostics: [], matrix: IDENTITY_MATRIX };
  }

  const diagnostics: SvgDiagnostic[] = [];
  let matrix = IDENTITY_MATRIX;
  let consumed = "";
  for (const match of value.matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)) {
    consumed += match[0];
    const operation = match[1]?.toLowerCase() ?? "";
    const values = transformArguments(match[2] ?? "");
    let next: Matrix | null = null;

    if (operation === "matrix" && values?.length === 6) {
      const [a, b, c, d, e, f] = values;
      if (
        a !== undefined &&
        b !== undefined &&
        c !== undefined &&
        d !== undefined &&
        e !== undefined &&
        f !== undefined
      ) {
        next = [a, b, c, d, e, f];
      }
    } else if (
      operation === "translate" &&
      (values?.length === 1 || values?.length === 2)
    ) {
      next = [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0];
    } else if (
      operation === "scale" &&
      (values?.length === 1 || values?.length === 2)
    ) {
      const scaleX = values[0] ?? 1;
      next = [scaleX, 0, 0, values[1] ?? scaleX, 0, 0];
    } else if (
      operation === "rotate" &&
      (values?.length === 1 || values?.length === 3)
    ) {
      const radians = ((values[0] ?? 0) * Math.PI) / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const rotation: Matrix = [cosine, sine, -sine, cosine, 0, 0];
      if (values.length === 3) {
        const centerX = values[1] ?? 0;
        const centerY = values[2] ?? 0;
        next = multiplyMatrices(
          multiplyMatrices([1, 0, 0, 1, centerX, centerY], rotation),
          [1, 0, 0, 1, -centerX, -centerY],
        );
      } else {
        next = rotation;
      }
    } else if (operation === "skewx" && values?.length === 1) {
      next = [1, 0, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    } else if (operation === "skewy" && values?.length === 1) {
      next = [1, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }

    if (next === null || next.some((entry) => !Number.isFinite(entry))) {
      diagnostics.push(
        transformDiagnostic(
          `Invalid SVG transform operation: ${match[0]}`,
          sourcePath,
        ),
      );
      continue;
    }
    matrix = multiplyMatrices(matrix, next);
  }

  const unparsed = value
    .replaceAll(/([A-Za-z]+)\s*\(([^)]*)\)/g, "")
    .replaceAll(/[\s,]/g, "");
  if (consumed.length === 0 || unparsed.length > 0) {
    diagnostics.push(
      transformDiagnostic(
        `Unable to parse complete SVG transform: ${value}`,
        sourcePath,
      ),
    );
  }
  return { diagnostics, matrix };
}
