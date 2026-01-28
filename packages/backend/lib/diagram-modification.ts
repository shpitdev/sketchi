import { z } from "zod";

export const ExcalidrawElementReferenceSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
  })
  .passthrough();

export const ExcalidrawBindingSchema = z
  .object({
    elementId: z.string(),
  })
  .passthrough();

export const ExcalidrawLegacyBindingSchema = z
  .object({
    id: z.string(),
  })
  .passthrough();

export const ExcalidrawElementSkeletonSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number().optional(),
    height: z.number().optional(),
    angle: z.number().optional(),
    label: z
      .object({
        text: z.string(),
      })
      .optional(),
    text: z.string().optional(),
    startBinding: ExcalidrawBindingSchema.optional(),
    endBinding: ExcalidrawBindingSchema.optional(),
    start: ExcalidrawLegacyBindingSchema.optional(),
    end: ExcalidrawLegacyBindingSchema.optional(),
    boundElements: z
      .array(ExcalidrawElementReferenceSchema)
      .nullable()
      .optional(),
    containerId: z.string().nullable().optional(),
    points: z.array(z.array(z.number())).optional(),
  })
  .passthrough();

export const ExcalidrawElementPatchSchema =
  ExcalidrawElementSkeletonSchema.partial()
    .extend({
      id: z.string().optional(),
      type: z.string().optional(),
    })
    .passthrough();

export const DiagramElementDiffSchema = z
  .object({
    add: z.array(ExcalidrawElementSkeletonSchema).optional(),
    remove: z.array(z.string()).optional(),
    modify: z
      .array(
        z.object({
          id: z.string(),
          changes: ExcalidrawElementPatchSchema,
        })
      )
      .optional(),
  })
  .passthrough();

export type DiagramElementDiff = z.infer<typeof DiagramElementDiffSchema>;
export type ExcalidrawElementPatch = z.infer<
  typeof ExcalidrawElementPatchSchema
>;

export interface DiagramModificationIssue {
  code: string;
  message: string;
  elementId?: string;
  path?: string;
}

export interface DiagramModificationChanges {
  addedIds: string[];
  removedIds: string[];
  modifiedIds: string[];
}

export interface DiagramModificationApplySuccess {
  ok: true;
  elements: ExcalidrawElementLike[];
  changes: DiagramModificationChanges;
}

export interface DiagramModificationApplyFailure {
  ok: false;
  issues: DiagramModificationIssue[];
}

export type DiagramModificationApplyResult =
  | DiagramModificationApplySuccess
  | DiagramModificationApplyFailure;

export type ExcalidrawElementLike = {
  id: string;
  type: string;
  [key: string]: unknown;
};

export function validateElements(
  elements: ExcalidrawElementLike[]
): DiagramModificationIssue[] {
  const issues: DiagramModificationIssue[] = [];
  const ids = new Set<string>();

  for (const element of elements) {
    if (!element?.id || typeof element.id !== "string") {
      issues.push({
        code: "invalid-element",
        message: "Element missing id",
      });
      continue;
    }

    if (ids.has(element.id)) {
      issues.push({
        code: "duplicate-id",
        message: `Duplicate element id '${element.id}'`,
        elementId: element.id,
      });
    }

    ids.add(element.id);
  }

  for (const element of elements) {
    if (!element || typeof element !== "object") {
      continue;
    }

    const elementId = element.id;

    const refs = extractReferences(element);
    for (const ref of refs) {
      if (!ids.has(ref.targetId)) {
        issues.push({
          code: "dangling-reference",
          message: `Element '${elementId}' references missing id '${ref.targetId}' via ${ref.kind}`,
          elementId,
          path: ref.path,
        });
      }
    }
  }

  return issues;
}

export function applyDiagramDiff(
  elements: ExcalidrawElementLike[],
  diff: DiagramElementDiff
): DiagramModificationApplyResult {
  const issues: DiagramModificationIssue[] = [];
  const validated = DiagramElementDiffSchema.safeParse(diff);
  if (!validated.success) {
    for (const error of validated.error.issues) {
      issues.push({
        code: "invalid-diff",
        message: error.message,
        path: error.path.join("."),
      });
    }
    return { ok: false, issues };
  }

  const working = elements.map((element) => cloneElement(element));
  const elementMap = new Map<string, ExcalidrawElementLike>(
    working.map((element) => [element.id, element])
  );

  const addList = validated.data.add ?? [];
  const removeList = validated.data.remove ?? [];
  const modifyList = validated.data.modify ?? [];

  const existingIds = new Set(elementMap.keys());
  const addedIds = new Set<string>();

  for (const removeId of removeList) {
    if (!existingIds.has(removeId)) {
      issues.push({
        code: "missing-element",
        message: `Cannot remove missing element '${removeId}'`,
        elementId: removeId,
      });
    }
  }

  for (const modification of modifyList) {
    if (!existingIds.has(modification.id)) {
      issues.push({
        code: "missing-element",
        message: `Cannot modify missing element '${modification.id}'`,
        elementId: modification.id,
      });
    }

    if (
      modification.changes.id &&
      modification.changes.id !== modification.id
    ) {
      issues.push({
        code: "immutable-id",
        message: `Cannot change id '${modification.id}' to '${modification.changes.id}'`,
        elementId: modification.id,
      });
    }
  }

  for (const element of addList) {
    if (existingIds.has(element.id)) {
      issues.push({
        code: "duplicate-id",
        message: `Cannot add element '${element.id}' because it already exists`,
        elementId: element.id,
      });
    }
    if (addedIds.has(element.id)) {
      issues.push({
        code: "duplicate-id",
        message: `Duplicate add element id '${element.id}'`,
        elementId: element.id,
      });
    }
    addedIds.add(element.id);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  for (const removeId of removeList) {
    elementMap.delete(removeId);
  }

  for (const modification of modifyList) {
    const current = elementMap.get(modification.id);
    if (!current) {
      continue;
    }
    const merged = {
      ...current,
      ...modification.changes,
      id: current.id,
      type: current.type,
    } as ExcalidrawElementLike;

    const maybeFlipped = autoFlipArrowPoints(current, merged, modification);

    elementMap.set(modification.id, maybeFlipped);
  }

  const nextIndex = createIndexGenerator(Array.from(elementMap.values()));
  for (const element of addList) {
    elementMap.set(element.id, buildDefaultElement(element, nextIndex.next()));
  }

  const merged = Array.from(elementMap.values());
  const postIssues = validateElements(merged);
  if (postIssues.length > 0) {
    return { ok: false, issues: postIssues };
  }

  return {
    ok: true,
    elements: merged,
    changes: {
      addedIds: addList.map((element) => element.id),
      removedIds: [...removeList],
      modifiedIds: modifyList.map((entry) => entry.id),
    },
  };
}

function autoFlipArrowPoints(
  before: ExcalidrawElementLike,
  after: ExcalidrawElementLike,
  modification: { changes: ExcalidrawElementPatch }
): ExcalidrawElementLike {
  if (before.type !== "arrow" || after.type !== "arrow") {
    return after;
  }

  if ("points" in modification.changes) {
    return after;
  }

  const beforeStart =
    (before.startBinding as { elementId?: string } | undefined)?.elementId ??
    (before.start as { id?: string } | undefined)?.id ??
    null;
  const beforeEnd =
    (before.endBinding as { elementId?: string } | undefined)?.elementId ??
    (before.end as { id?: string } | undefined)?.id ??
    null;
  const afterStart =
    (after.startBinding as { elementId?: string } | undefined)?.elementId ??
    (after.start as { id?: string } | undefined)?.id ??
    null;
  const afterEnd =
    (after.endBinding as { elementId?: string } | undefined)?.elementId ??
    (after.end as { id?: string } | undefined)?.id ??
    null;

  if (
    !beforeStart ||
    !beforeEnd ||
    !afterStart ||
    !afterEnd ||
    beforeStart !== afterEnd ||
    beforeEnd !== afterStart
  ) {
    return after;
  }

  const points = Array.isArray(after.points) ? after.points : null;
  if (!points || points.length < 2) {
    return after;
  }

  return {
    ...after,
    points: [...points].reverse(),
  };
}

function cloneElement<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function extractReferences(element: ExcalidrawElementLike): Array<{
  kind: string;
  targetId: string;
  path?: string;
}> {
  const refs: Array<{ kind: string; targetId: string; path?: string }> = [];

  const startBinding = element.startBinding as
    | { elementId?: unknown }
    | undefined;
  if (startBinding?.elementId && typeof startBinding.elementId === "string") {
    refs.push({
      kind: "startBinding",
      targetId: startBinding.elementId,
      path: "startBinding.elementId",
    });
  }

  const endBinding = element.endBinding as { elementId?: unknown } | undefined;
  if (endBinding?.elementId && typeof endBinding.elementId === "string") {
    refs.push({
      kind: "endBinding",
      targetId: endBinding.elementId,
      path: "endBinding.elementId",
    });
  }

  const startLegacy = element.start as { id?: unknown } | undefined;
  if (startLegacy?.id && typeof startLegacy.id === "string") {
    refs.push({
      kind: "start",
      targetId: startLegacy.id,
      path: "start.id",
    });
  }

  const endLegacy = element.end as { id?: unknown } | undefined;
  if (endLegacy?.id && typeof endLegacy.id === "string") {
    refs.push({
      kind: "end",
      targetId: endLegacy.id,
      path: "end.id",
    });
  }

  if (typeof element.containerId === "string") {
    refs.push({
      kind: "containerId",
      targetId: element.containerId,
      path: "containerId",
    });
  }

  if (Array.isArray(element.boundElements)) {
    for (const bound of element.boundElements) {
      const boundId =
        typeof bound === "object" && bound && "id" in bound
          ? (bound as { id?: unknown }).id
          : null;
      if (typeof boundId === "string") {
        refs.push({
          kind: "boundElements",
          targetId: boundId,
          path: "boundElements",
        });
      }
    }
  }

  return refs;
}

function generateSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function createIndexGenerator(elements: ExcalidrawElementLike[]) {
  let max = 0;
  for (const element of elements) {
    if (typeof element.index === "string") {
      const match = element.index.match(/(\d+)/);
      if (match) {
        const value = Number.parseInt(match[1] ?? "0", 10);
        if (value > max) {
          max = value;
        }
      }
    }
  }

  return {
    next: () => {
      max += 1;
      return `a${max}`;
    },
  };
}

function buildDefaultElement(
  element: ExcalidrawElementLike,
  index: string
): ExcalidrawElementLike {
  const now = Date.now();
  const width =
    typeof element.width === "number"
      ? element.width
      : element.type === "text"
        ? 100
        : 160;
  const height =
    typeof element.height === "number"
      ? element.height
      : element.type === "text"
        ? 24
        : 100;
  const backgroundColor =
    typeof element.backgroundColor === "string"
      ? element.backgroundColor
      : element.type === "text"
        ? "transparent"
        : "#a5d8ff";
  const strokeColor =
    typeof element.strokeColor === "string" ? element.strokeColor : "#1971c2";

  const base: ExcalidrawElementLike = {
    id: element.id,
    type: element.type,
    x: typeof element.x === "number" ? element.x : 0,
    y: typeof element.y === "number" ? element.y : 0,
    width,
    height,
    angle: typeof element.angle === "number" ? element.angle : 0,
    strokeColor,
    backgroundColor,
    fillStyle: element.fillStyle ?? "solid",
    strokeWidth: element.strokeWidth ?? 2,
    strokeStyle: element.strokeStyle ?? "solid",
    roughness: element.roughness ?? 1,
    opacity: element.opacity ?? 100,
    groupIds: element.groupIds ?? [],
    frameId: element.frameId ?? null,
    index: element.index ?? index,
    roundness:
      element.roundness ?? (element.type === "text" ? null : { type: 3 }),
    seed: element.seed ?? generateSeed(),
    version: element.version ?? 1,
    versionNonce: element.versionNonce ?? generateSeed(),
    isDeleted: element.isDeleted ?? false,
    boundElements: element.boundElements ?? null,
    updated: element.updated ?? now,
    link: element.link ?? null,
    locked: element.locked ?? false,
  };

  if (element.type === "arrow") {
    const points =
      Array.isArray(element.points) && element.points.length >= 2
        ? element.points
        : [
            [0, 0],
            [width, height],
          ];
    return {
      ...base,
      ...element,
      points,
      backgroundColor: element.backgroundColor ?? "transparent",
      startArrowhead: element.startArrowhead ?? null,
      endArrowhead: element.endArrowhead ?? "arrow",
      elbowed: element.elbowed ?? false,
    };
  }

  if (element.type === "text") {
    const text =
      typeof element.text === "string"
        ? element.text
        : typeof element.label === "object" &&
            element.label &&
            "text" in element.label
          ? String((element.label as { text?: unknown }).text ?? "")
          : "";
    return {
      ...base,
      ...element,
      text,
      fontSize: element.fontSize ?? 16,
      fontFamily: element.fontFamily ?? 5,
      textAlign: element.textAlign ?? "center",
      verticalAlign: element.verticalAlign ?? "middle",
      containerId: element.containerId ?? null,
      originalText: element.originalText ?? text,
      autoResize: element.autoResize ?? true,
      lineHeight: element.lineHeight ?? 1.25,
      backgroundColor: element.backgroundColor ?? "transparent",
    };
  }

  return { ...base, ...element };
}
