import {
  createStudioProjectsHttpHandlers,
  type StudioProjectsHttpHandlers,
} from "./server/http.js";
import {
  createStudioProjectsService,
  type StudioProjectsService,
  type StudioProjectsServiceOptions,
} from "./server/service.js";

export * from "./contracts.js";
export * from "./server/bucket.js";
export * from "./server/http.js";
export * from "./server/service.js";
export * from "./server/session.js";
export * from "./server/source-artifacts.js";

export type StudioProjectsServer = StudioProjectsService &
  StudioProjectsHttpHandlers;

export function createStudioProjectsServer(
  options: StudioProjectsServiceOptions,
): StudioProjectsServer {
  const service = createStudioProjectsService(options);
  return {
    ...service,
    ...createStudioProjectsHttpHandlers(service),
  };
}
