import { CreateStudioProjectFromArtifactRequestSchema } from "../contracts.js";
import {
  resolveStudioSession,
  type StudioSessionResolution,
} from "./session.js";
import type { StudioProjectsService } from "./service.js";

export interface StudioProjectsHttpHandlers {
  handleCreateFromArtifactRequest(request: Request): Promise<Response>;
  handleGetDiagramRequest(
    request: Request,
    diagramId: string,
  ): Promise<Response>;
  handleGetProjectRequest(
    request: Request,
    projectId: string,
  ): Promise<Response>;
  handleListProjectsRequest(request: Request): Promise<Response>;
}

async function readRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function responseHeaders(resolution: StudioSessionResolution): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
  });

  if (resolution.setCookie) {
    headers.append("Set-Cookie", resolution.setCookie);
  }

  return headers;
}

function jsonWithSession(
  resolution: StudioSessionResolution,
  body: unknown,
  status = 200,
): Response {
  return Response.json(body, {
    headers: responseHeaders(resolution),
    status,
  });
}

function storageFailureResponse(
  resolution: StudioSessionResolution,
  error: unknown,
): Response {
  return jsonWithSession(
    resolution,
    {
      code: "storage_failed",
      message:
        error instanceof Error ? error.message : "Studio persistence failed.",
      ok: false,
    },
    500,
  );
}

export function createStudioProjectsHttpHandlers(
  projects: StudioProjectsService,
): StudioProjectsHttpHandlers {
  const handleListProjectsRequest = async (
    request: Request,
  ): Promise<Response> => {
    const resolution = resolveStudioSession(request);
    try {
      const projectSummaries = await projects.listProjects(resolution.session);
      return jsonWithSession(resolution, {
        auth: resolution.auth,
        ok: true,
        projects: projectSummaries,
        session: resolution.publicSession,
      });
    } catch (error) {
      return storageFailureResponse(resolution, error);
    }
  };

  const handleCreateFromArtifactRequest = async (
    request: Request,
  ): Promise<Response> => {
    const resolution = resolveStudioSession(request);
    const body = await readRequestJson(request);
    const parsed = CreateStudioProjectFromArtifactRequestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonWithSession(
        resolution,
        {
          code: "invalid_input",
          message: "A playground artifactId is required.",
          ok: false,
        },
        400,
      );
    }

    try {
      const result = await projects.createFromArtifact({
        artifactId: parsed.data.artifactId,
        session: resolution.session,
      });

      if (!result.ok) {
        return jsonWithSession(
          resolution,
          {
            code: result.code,
            message: result.message,
            ok: false,
          },
          result.status,
        );
      }

      return jsonWithSession(resolution, {
        auth: resolution.auth,
        diagram: result.diagram,
        ok: true,
        project: result.project,
        session: resolution.publicSession,
        urls: result.urls,
      });
    } catch (error) {
      return storageFailureResponse(resolution, error);
    }
  };

  const handleGetProjectRequest = async (
    request: Request,
    projectId: string,
  ): Promise<Response> => {
    const resolution = resolveStudioSession(request);
    try {
      const details = await projects.getProject(resolution.session, projectId);
      if (!details) {
        return jsonWithSession(
          resolution,
          {
            code: "not_found",
            message: "Studio project was not found for this session.",
            ok: false,
          },
          404,
        );
      }

      return jsonWithSession(resolution, {
        auth: resolution.auth,
        details,
        ok: true,
        session: resolution.publicSession,
      });
    } catch (error) {
      return storageFailureResponse(resolution, error);
    }
  };

  const handleGetDiagramRequest = async (
    request: Request,
    diagramId: string,
  ): Promise<Response> => {
    const resolution = resolveStudioSession(request);
    try {
      const details = await projects.getDiagram(resolution.session, diagramId);
      if (!details) {
        return jsonWithSession(
          resolution,
          {
            code: "not_found",
            message: "Studio diagram was not found for this session.",
            ok: false,
          },
          404,
        );
      }

      return jsonWithSession(resolution, {
        auth: resolution.auth,
        diagram: details.diagram,
        ok: true,
        project: details.project,
        session: resolution.publicSession,
      });
    } catch (error) {
      return storageFailureResponse(resolution, error);
    }
  };

  return {
    handleCreateFromArtifactRequest,
    handleGetDiagramRequest,
    handleGetProjectRequest,
    handleListProjectsRequest,
  };
}
