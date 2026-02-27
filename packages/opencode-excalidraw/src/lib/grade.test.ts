import { describe, expect, test } from "bun:test";

import { gradeDiagram } from "./grade";

const VALID_GRADE_JSON = JSON.stringify({
  diagramType: {
    expected: "architecture",
    actual: "architecture",
    matches: true,
    notes: [],
  },
  arrowDirectionality: { score: 4, issues: [] },
  layout: { score: 4, issues: [] },
  visualQuality: { score: 4, issues: [] },
  accuracy: { score: 4, issues: [] },
  completeness: { score: 4, issues: [] },
  overallScore: 4,
  notes: [],
});

describe("gradeDiagram", () => {
  test("times out when grading prompt never returns", async () => {
    const client = {
      session: {
        prompt: async () => await new Promise<never>(() => undefined),
      },
    } as never;

    await expect(
      gradeDiagram(
        client,
        {
          sessionID: "session-timeout",
          messageID: "message-timeout",
          agent: "build",
        },
        {
          prompt: "grade this",
          apiBase: "https://sketchi.app",
          baseDir: process.cwd(),
          pngPath: "/tmp/diagram-timeout.png",
          promptTimeoutMs: 1000,
          renderOptions: {},
        }
      )
    ).rejects.toThrow("timed out after 1000ms");
  });

  test("parses JSON grade response when prompt succeeds", async () => {
    const client = {
      session: {
        prompt: async () => ({
          parts: [{ type: "text", text: VALID_GRADE_JSON }],
        }),
      },
    } as never;

    const result = await gradeDiagram(
      client,
      {
        sessionID: "session-success",
        messageID: "message-success",
        agent: "build",
      },
      {
        prompt: "grade this",
        apiBase: "https://sketchi.app",
        baseDir: process.cwd(),
        pngPath: "/tmp/diagram-success.png",
        promptTimeoutMs: 1000,
        renderOptions: {},
      }
    );

    expect(result.pngPath).toBe("/tmp/diagram-success.png");
    expect(result.grade.overallScore).toBe(4);
  });

  test("uses dedicated grader session when session.create is available", async () => {
    let createCallCount = 0;
    const promptCalls: Array<{
      path: { id: string };
      body: { messageID?: string };
    }> = [];

    const client = {
      session: {
        create: () => {
          createCallCount += 1;
          return Promise.resolve({ data: { id: "grader-session-1" } });
        },
        prompt: (input: {
          path: { id: string };
          body: { messageID?: string };
        }) => {
          promptCalls.push(input);
          return Promise.resolve({
            parts: [{ type: "text", text: VALID_GRADE_JSON }],
          });
        },
      },
    } as never;

    const firstResult = await gradeDiagram(
      client,
      {
        sessionID: "parent-session-1",
        messageID: "message-a",
        agent: "build",
      },
      {
        prompt: "grade this",
        apiBase: "https://sketchi.app",
        baseDir: process.cwd(),
        pngPath: "/tmp/diagram-a.png",
        promptTimeoutMs: 1000,
        renderOptions: {},
      }
    );

    const secondResult = await gradeDiagram(
      client,
      {
        sessionID: "parent-session-1",
        messageID: "message-b",
        agent: "build",
      },
      {
        prompt: "grade this again",
        apiBase: "https://sketchi.app",
        baseDir: process.cwd(),
        pngPath: "/tmp/diagram-b.png",
        promptTimeoutMs: 1000,
        renderOptions: {},
      }
    );

    expect(firstResult.grade.overallScore).toBe(4);
    expect(secondResult.grade.overallScore).toBe(4);
    expect(createCallCount).toBe(1);
    expect(promptCalls.length).toBe(2);
    expect(promptCalls[0]?.path.id).toBe("grader-session-1");
    expect(promptCalls[1]?.path.id).toBe("grader-session-1");
    expect(promptCalls[0]?.body.messageID).toBeUndefined();
    expect(promptCalls[1]?.body.messageID).toBeUndefined();
  });
});
