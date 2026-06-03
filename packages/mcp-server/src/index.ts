import type {
  SketchiMcpServerOptions as InternalSketchiMcpServerOptions,
  SketchiMcpToolCall as InternalSketchiMcpToolCall,
  SketchiMcpToolExecutor as InternalSketchiMcpToolExecutor,
} from "./lib/mcp-server.js";
import {
  connectSketchiMcpStdio as connectSketchiMcpStdioImplementation,
  createSketchiMcpServer as createSketchiMcpServerImplementation,
  getSketchiMcpTools as getSketchiMcpToolsImplementation,
} from "./lib/mcp-server.js";
import type { SketchiHttpExecutorOptions as InternalSketchiHttpExecutorOptions } from "./lib/sketchi-http-executor.js";
import { createSketchiHttpToolExecutor as createSketchiHttpToolExecutorImplementation } from "./lib/sketchi-http-executor.js";

export const connectSketchiMcpStdio = connectSketchiMcpStdioImplementation;
export const createSketchiHttpToolExecutor =
  createSketchiHttpToolExecutorImplementation;
export const createSketchiMcpServer = createSketchiMcpServerImplementation;
export const getSketchiMcpTools = getSketchiMcpToolsImplementation;

export type SketchiHttpExecutorOptions = InternalSketchiHttpExecutorOptions;
export type SketchiMcpServerOptions = InternalSketchiMcpServerOptions;
export type SketchiMcpToolCall = InternalSketchiMcpToolCall;
export type SketchiMcpToolExecutor = InternalSketchiMcpToolExecutor;
