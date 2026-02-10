/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as diagramGenerateFromIntermediate from "../diagramGenerateFromIntermediate.js";
import type * as diagramGenerateIntermediateFromPrompt from "../diagramGenerateIntermediateFromPrompt.js";
import type * as diagramModifyElements from "../diagramModifyElements.js";
import type * as diagramModifyFromShareLink from "../diagramModifyFromShareLink.js";
import type * as diagramSessions from "../diagramSessions.js";
import type * as diagrams from "../diagrams.js";
import type * as excalidrawShareLinks from "../excalidrawShareLinks.js";
import type * as export_ from "../export.js";
import type * as healthCheck from "../healthCheck.js";
import type * as iconLibraries from "../iconLibraries.js";
import type * as iconLibrariesActions from "../iconLibrariesActions.js";
import type * as lib_excalidrawShareLinkV2Encoding from "../lib/excalidrawShareLinkV2Encoding.js";
import type * as lib_excalidrawShareLinks from "../lib/excalidrawShareLinks.js";
import type * as lib_logging from "../lib/logging.js";
import type * as lib_observability from "../lib/observability.js";
import type * as lib_trace from "../lib/trace.js";
import type * as observability from "../observability.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  diagramGenerateFromIntermediate: typeof diagramGenerateFromIntermediate;
  diagramGenerateIntermediateFromPrompt: typeof diagramGenerateIntermediateFromPrompt;
  diagramModifyElements: typeof diagramModifyElements;
  diagramModifyFromShareLink: typeof diagramModifyFromShareLink;
  diagramSessions: typeof diagramSessions;
  diagrams: typeof diagrams;
  excalidrawShareLinks: typeof excalidrawShareLinks;
  export: typeof export_;
  healthCheck: typeof healthCheck;
  iconLibraries: typeof iconLibraries;
  iconLibrariesActions: typeof iconLibrariesActions;
  "lib/excalidrawShareLinkV2Encoding": typeof lib_excalidrawShareLinkV2Encoding;
  "lib/excalidrawShareLinks": typeof lib_excalidrawShareLinks;
  "lib/logging": typeof lib_logging;
  "lib/observability": typeof lib_observability;
  "lib/trace": typeof lib_trace;
  observability: typeof observability;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
