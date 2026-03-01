/**
 * TEST SCENARIO: thread-backed prompt lifecycle durability + idempotency
 * - enqueuePrompt writes durable user + assistant messages and run metadata
 * - duplicate promptMessageId is idempotent
 * - stopPrompt marks run as stopped without deleting history
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const t = convexTest(schema, modules);
const authed = t.withIdentity({
  subject: "test-user-diagram-threads",
  email: "diagram-threads@example.com",
});

beforeAll(() => {
  process.env.SKETCHI_DISABLE_THREAD_AUTORUN = "1";
});

describe("diagramThreads", () => {
  test("enqueuePrompt persists thread-backed messages and run status", async () => {
    const { sessionId } = await authed.mutation(api.diagramSessions.create, {});

    const enqueue = await authed.mutation(api.diagramThreads.enqueuePrompt, {
      sessionId,
      prompt: "Create a basic login flow diagram",
      promptMessageId: "prompt-msg-1",
      traceId: "trace-thread-1",
    });

    expect(enqueue.status).toBe("enqueued");
    expect(enqueue.promptMessageId).toBe("prompt-msg-1");
    expect(enqueue.traceId).toBe("trace-thread-1");

    const run = await authed.query(api.diagramThreads.getRun, {
      sessionId,
      promptMessageId: "prompt-msg-1",
    });

    expect(run).not.toBeNull();
    expect(run?.status).toBe("sending");
    expect(run?.assistantMessageId).toBe(enqueue.assistantMessageId);
    expect(run?.userMessageId).toBe(enqueue.userMessageId);

    const thread = await authed.query(api.diagramThreads.listBySession, {
      sessionId,
    });

    expect(thread).not.toBeNull();
    expect(thread?.threadId).toBeTruthy();
    const userMessage = thread?.messages.find(
      (message: { messageId: string }) =>
        message.messageId === enqueue.userMessageId
    );
    const assistantMessage = thread?.messages.find(
      (message: { messageId: string }) =>
        message.messageId === enqueue.assistantMessageId
    );

    expect(userMessage).toBeDefined();
    expect(userMessage?.role).toBe("user");
    expect(userMessage?.messageType).toBe("chat");
    expect(userMessage?.content).toContain("login flow");
    expect(userMessage?.status).toBe("persisted");

    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.role).toBe("assistant");
    expect(assistantMessage?.messageType).toBe("chat");
    expect(assistantMessage?.status).toBe("sending");
  });

  test("enqueuePrompt is idempotent by promptMessageId", async () => {
    const { sessionId } = await authed.mutation(api.diagramSessions.create, {});

    const first = await authed.mutation(api.diagramThreads.enqueuePrompt, {
      sessionId,
      prompt: "Create an API architecture diagram",
      promptMessageId: "prompt-msg-idempotent",
      traceId: "trace-thread-idempotent",
    });

    const second = await authed.mutation(api.diagramThreads.enqueuePrompt, {
      sessionId,
      prompt: "Create an API architecture diagram",
      promptMessageId: "prompt-msg-idempotent",
      traceId: "trace-thread-idempotent-retry",
    });

    expect(first.status).toBe("enqueued");
    expect(second.status).toBe("duplicate");
    expect(second.runId).toBe(first.runId);
    expect(second.assistantMessageId).toBe(first.assistantMessageId);
    expect(second.userMessageId).toBe(first.userMessageId);

    const thread = await authed.query(api.diagramThreads.listBySession, {
      sessionId,
    });

    const promptMessages =
      thread?.messages.filter(
        (message: { promptMessageId: string | null }) =>
          message.promptMessageId === "prompt-msg-idempotent"
      ) ?? [];

    // Exactly one user + one assistant message for the idempotent prompt.
    expect(promptMessages).toHaveLength(2);
  });

  test("stopPrompt marks active run as stopped", async () => {
    const { sessionId } = await authed.mutation(api.diagramSessions.create, {});

    await authed.mutation(api.diagramThreads.enqueuePrompt, {
      sessionId,
      prompt: "Generate a data pipeline diagram",
      promptMessageId: "prompt-msg-stop",
      traceId: "trace-thread-stop",
    });

    const stop = await authed.mutation(api.diagramThreads.stopPrompt, {
      sessionId,
      promptMessageId: "prompt-msg-stop",
    });

    expect(stop.status).toBe("requested");
    expect(stop.runStatus).toBe("stopped");
    if (stop.status !== "requested") {
      throw new Error("unexpected stop status");
    }
    expect(stop.promptMessageId).toBe("prompt-msg-stop");

    const run = await authed.query(api.diagramThreads.getRun, {
      sessionId,
      promptMessageId: "prompt-msg-stop",
    });

    expect(run).not.toBeNull();
    expect(run?.status).toBe("stopped");
    expect(run?.stopRequested).toBe(true);
  });

  test("stopPrompt falls back to the latest active run when ids race", async () => {
    const { sessionId } = await authed.mutation(api.diagramSessions.create, {});

    await authed.mutation(api.diagramThreads.enqueuePrompt, {
      sessionId,
      prompt: "Generate onboarding sequence",
      promptMessageId: "prompt-msg-stop-fallback",
      traceId: "trace-thread-stop-fallback",
    });

    const stop = await authed.mutation(api.diagramThreads.stopPrompt, {
      sessionId,
      promptMessageId: "prompt-id-not-persisted-yet",
    });

    expect(stop.status).toBe("requested");
    if (stop.status !== "requested") {
      throw new Error("unexpected stop status");
    }
    expect(stop.runStatus).toBe("stopped");
    expect(stop.promptMessageId).toBe("prompt-msg-stop-fallback");

    const run = await authed.query(api.diagramThreads.getRun, {
      sessionId,
      promptMessageId: "prompt-msg-stop-fallback",
    });
    expect(run?.status).toBe("stopped");
    expect(run?.stopRequested).toBe(true);
  });
});
