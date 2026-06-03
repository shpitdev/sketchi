#!/usr/bin/env node
import { connectSketchiMcpStdio } from "./lib/mcp-server.js";
import { createSketchiHttpToolExecutor } from "./lib/sketchi-http-executor.js";

await connectSketchiMcpStdio({
  executor: createSketchiHttpToolExecutor(),
});
