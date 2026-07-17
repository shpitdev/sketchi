import { z } from "zod";

const StudioRecordIdSchema = z.string().regex(/^[a-z0-9_-]{6,80}$/i);
const IsoDateStringSchema = z.string().min(1);

export const StudioOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("anonymous"),
    sessionId: StudioRecordIdSchema,
  }),
  z.object({
    displayName: z.string().min(1).optional(),
    kind: z.literal("authenticated"),
    subjectId: z.string().min(1),
  }),
]);

export const StudioProjectSourceSchema = z.object({
  artifactId: z.string().min(1),
  kind: z.literal("playground-artifact"),
});

export const StudioProjectRecordSchema = z.object({
  createdAt: IsoDateStringSchema,
  diagramIds: z.array(StudioRecordIdSchema),
  id: StudioRecordIdSchema,
  owner: StudioOwnerSchema,
  source: StudioProjectSourceSchema,
  title: z.string().min(1),
  updatedAt: IsoDateStringSchema,
});

export const StudioDiagramRecordSchema = z.object({
  artifactDiagramId: z.string().min(1).optional(),
  artifactId: z.string().min(1),
  createdAt: IsoDateStringSchema,
  id: StudioRecordIdSchema,
  owner: StudioOwnerSchema,
  projectId: StudioRecordIdSchema,
  source: StudioProjectSourceSchema,
  title: z.string().min(1),
  updatedAt: IsoDateStringSchema,
});

export const StudioAuthStatusSchema = z.discriminatedUnion("status", [
  z.object({
    message: z.string().min(1),
    status: z.literal("anonymous"),
  }),
  z.object({
    displayName: z.string().min(1).optional(),
    status: z.literal("authenticated"),
  }),
]);

export const StudioPublicSessionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("anonymous"),
  }),
  z.object({
    displayName: z.string().min(1).optional(),
    kind: z.literal("authenticated"),
  }),
]);

export const StudioProjectSummarySchema = z.object({
  createdAt: IsoDateStringSchema,
  diagramCount: z.number().int().nonnegative(),
  id: StudioRecordIdSchema,
  primaryDiagramId: StudioRecordIdSchema.optional(),
  source: StudioProjectSourceSchema,
  title: z.string().min(1),
  updatedAt: IsoDateStringSchema,
});

export const StudioDiagramSummarySchema = z.object({
  artifactDiagramId: z.string().min(1).optional(),
  artifactId: z.string().min(1),
  createdAt: IsoDateStringSchema,
  editUrl: z.string().min(1),
  id: StudioRecordIdSchema,
  projectId: StudioRecordIdSchema,
  reviewUrl: z.string().min(1),
  source: StudioProjectSourceSchema,
  title: z.string().min(1),
  updatedAt: IsoDateStringSchema,
});

export const StudioProjectDetailsSchema = z.object({
  diagrams: z.array(StudioDiagramSummarySchema),
  project: StudioProjectSummarySchema,
});

export const CreateStudioProjectFromArtifactRequestSchema = z.object({
  artifactId: z.string().min(1),
});

export const StudioProjectsListResponseSchema = z.object({
  auth: StudioAuthStatusSchema,
  ok: z.literal(true),
  projects: z.array(StudioProjectSummarySchema),
  session: StudioPublicSessionSchema,
});

export const StudioProjectDetailsResponseSchema = z.object({
  auth: StudioAuthStatusSchema,
  details: StudioProjectDetailsSchema,
  ok: z.literal(true),
  session: StudioPublicSessionSchema,
});

export const StudioDiagramDetailsResponseSchema = z.object({
  auth: StudioAuthStatusSchema,
  diagram: StudioDiagramSummarySchema,
  ok: z.literal(true),
  project: StudioProjectSummarySchema,
  session: StudioPublicSessionSchema,
});

export const CreateStudioProjectFromArtifactResponseSchema = z.object({
  auth: StudioAuthStatusSchema,
  diagram: StudioDiagramSummarySchema,
  ok: z.literal(true),
  project: StudioProjectSummarySchema,
  session: StudioPublicSessionSchema,
  urls: z.object({
    diagram: z.string().min(1),
    edit: z.string().min(1),
    project: z.string().min(1),
  }),
});

export type StudioOwner = z.infer<typeof StudioOwnerSchema>;
export type StudioProjectRecord = z.infer<typeof StudioProjectRecordSchema>;
export type StudioDiagramRecord = z.infer<typeof StudioDiagramRecordSchema>;
export type StudioAuthStatus = z.infer<typeof StudioAuthStatusSchema>;
export type StudioPublicSession = z.infer<typeof StudioPublicSessionSchema>;
export type StudioProjectSummary = z.infer<typeof StudioProjectSummarySchema>;
export type StudioDiagramSummary = z.infer<typeof StudioDiagramSummarySchema>;
export type StudioProjectDetails = z.infer<typeof StudioProjectDetailsSchema>;
export type CreateStudioProjectFromArtifactResponse = z.infer<
  typeof CreateStudioProjectFromArtifactResponseSchema
>;

export function studioProjectUrl(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function studioDiagramUrl(diagramId: string): string {
  return `/diagrams/${encodeURIComponent(diagramId)}`;
}

export function studioDiagramEditUrl(diagramId: string): string {
  return `${studioDiagramUrl(diagramId)}/edit`;
}
