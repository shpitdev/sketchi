export class DurableObject {
  ctx: unknown;
  env: unknown;

  constructor(ctx?: unknown, env?: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class RpcTarget {}
export class WorkflowEntrypoint {}

export const env = {};
export const exports: Record<string, unknown> = {};
