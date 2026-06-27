import { describe, expect, it } from "vitest";

import { outputContractErrors, summarizeHarnessStdout } from "./harness-eval";

describe("harness-eval", () => {
  const acceptedMcpOutput = {
    ok: true,
    result: {
      ok: true,
      status: "accepted",
      buildId: "build_demo",
      normalizedSpec: {
        id: "demo",
        title: "Demo",
        nodes: [],
        edges: [],
        layout: { direction: "TB" },
      },
      quality: {
        accepted: true,
        score: 10,
      },
      artifact: {
        artifactId: "artifact_demo",
        diagramId: "demo",
        formats: [
          {
            format: "scene",
            url: "https://studio.test/api/v1/artifacts/artifact_demo?format=scene&raw=true",
          },
          {
            format: "excalidraw",
            url: "https://studio.test/api/v1/artifacts/artifact_demo?format=excalidraw&raw=true",
          },
          {
            format: "png",
            url: "https://studio.test/api/v1/artifacts/artifact_demo?format=png&raw=true",
          },
        ],
      },
    },
  };

  it("summarizes OpenCode JSONL text, tool calls, cost, and tokens", () => {
    const stdout = [
      JSON.stringify({
        type: "tool_use",
        part: {
          callID: "call_demo",
          type: "tool",
          tool: "sketchi-code-mode_execute",
          state: {
            output: JSON.stringify(acceptedMcpOutput),
            status: "completed",
          },
        },
      }),
      JSON.stringify({
        type: "text",
        part: {
          type: "text",
          text: JSON.stringify({
            artifactFormats: ["scene", "excalidraw", "png"],
            artifactId: "artifact_demo",
            buildOk: true,
            excalidrawUrl:
              "https://studio.test/api/v1/artifacts/artifact_demo?format=excalidraw&raw=true",
            normalizedSpec: {
              id: "demo",
              title: "Demo",
              nodes: [],
              edges: [],
              layout: { direction: "TB" },
              style: {
                accentColor: "#000000",
                backgroundColor: "#ffffff",
              },
            },
            pngUrl:
              "https://studio.test/api/v1/artifacts/artifact_demo?format=png&raw=true",
            status: "accepted",
          }),
        },
      }),
      JSON.stringify({
        type: "step_finish",
        part: {
          type: "step-finish",
          reason: "stop",
          cost: 0.012,
          tokens: {
            input: 100,
            output: 20,
            reasoning: 5,
            total: 125,
            cache: {
              read: 10,
              write: 1,
            },
          },
        },
      }),
    ].join("\n");

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.eventCount).toBe(3);
    expect(summary.toolCalls).toEqual([
      {
        callId: "call_demo",
        name: "sketchi-code-mode_execute",
        status: "completed",
      },
    ]);
    expect(summary.mcpArtifacts).toEqual([
      {
        artifactId: "artifact_demo",
        artifactFormats: ["scene", "excalidraw", "png"],
        artifactUrls: {
          excalidraw:
            "https://studio.test/api/v1/artifacts/artifact_demo?format=excalidraw&raw=true",
          png: "https://studio.test/api/v1/artifacts/artifact_demo?format=png&raw=true",
          scene:
            "https://studio.test/api/v1/artifacts/artifact_demo?format=scene&raw=true",
        },
        buildId: "build_demo",
        buildOk: true,
        normalizedSpec: acceptedMcpOutput.result.normalizedSpec,
        qualityAccepted: true,
        qualityScore: 10,
        status: "accepted",
        toolCallId: "call_demo",
        toolName: "sketchi-code-mode_execute",
      },
    ]);
    expect(summary.finalJson).toMatchObject({
      artifactId: "artifact_demo",
      buildOk: true,
      excalidrawUrl:
        "https://studio.test/api/v1/artifacts/artifact_demo?format=excalidraw&raw=true",
      normalizedSpec: { id: "demo" },
      pngUrl:
        "https://studio.test/api/v1/artifacts/artifact_demo?format=png&raw=true",
      status: "accepted",
    });
    expect(summary.stepCosts).toEqual([0.012]);
    expect(summary.steps[0]?.tokens).toEqual({
      cacheRead: 10,
      cacheWrite: 1,
      input: 100,
      output: 20,
      reasoning: 5,
      total: 125,
    });
  });

  it("ignores non-json wrapper lines but preserves the final parseable text", () => {
    const stdout = [
      "/home/user/.local/bin/opencode: line 10: warning",
      JSON.stringify({
        type: "text",
        part: {
          text: 'result: {"ok":true}',
          type: "text",
        },
      }),
    ].join("\n");

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.eventCount).toBe(1);
    expect(summary.finalJson).toEqual({ ok: true });
  });

  it("can parse final JSON split across multiple text events", () => {
    const stdout = [
      JSON.stringify({
        type: "text",
        part: {
          text: '{"buildOk":true,',
          type: "text",
        },
      }),
      JSON.stringify({
        type: "text",
        part: {
          text: '"artifactId":"artifact_chunked"}',
          type: "text",
        },
      }),
    ].join("\n");

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.finalJson).toEqual({
      artifactId: "artifact_chunked",
      buildOk: true,
    });
  });

  it("does not treat failed MCP output as accepted artifact proof", () => {
    const stdout = [
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "sketchi-code-mode_execute",
          state: {
            output: JSON.stringify({
              ok: true,
              result: {
                ok: false,
                status: "rejected",
              },
            }),
            status: "completed",
          },
        },
      }),
      JSON.stringify({
        type: "text",
        part: {
          text: JSON.stringify({
            artifactId: "artifact_fake",
            buildOk: true,
            normalizedSpec: { id: "fake" },
            status: "accepted",
          }),
          type: "text",
        },
      }),
    ].join("\n");

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.finalJson).toMatchObject({ artifactId: "artifact_fake" });
    expect(summary.mcpArtifacts).toEqual([]);
  });

  it("extracts accepted MCP proof from a wrapped execute result", () => {
    const stdout = [
      JSON.stringify({
        type: "tool_use",
        part: {
          callID: "call_wrapped",
          type: "tool",
          tool: "sketchi-code-mode_execute",
          state: {
            output: JSON.stringify({
              ok: true,
              result: {
                attempts: 1,
                result: acceptedMcpOutput.result,
              },
            }),
            status: "completed",
          },
        },
      }),
    ].join("\n");

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.mcpArtifacts[0]).toMatchObject({
      artifactId: "artifact_demo",
      buildOk: true,
      toolCallId: "call_wrapped",
    });
  });

  it("summarizes Claude stream JSON nested tool calls, final result, cost, and tokens", () => {
    const stdout = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              id: "toolu_demo",
              type: "tool_use",
              name: "mcp__sketchi-code-mode__execute",
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_demo",
              content: JSON.stringify(acceptedMcpOutput),
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                buildOk: true,
                normalizedSpec: { id: "claude-demo" },
              }),
            },
          ],
        },
      }),
      JSON.stringify({
        type: "result",
        terminal_reason: "completed",
        total_cost_usd: 0.14,
        result: JSON.stringify({
          buildOk: true,
          normalizedSpec: { id: "claude-demo-final" },
        }),
        usage: {
          input_tokens: 7,
          output_tokens: 1464,
          cache_read_input_tokens: 70295,
          cache_creation_input_tokens: 16414,
        },
      }),
    ].join("\n");

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.toolCalls).toEqual([
      { callId: "toolu_demo", name: "mcp__sketchi-code-mode__execute" },
    ]);
    expect(summary.mcpArtifacts).toHaveLength(1);
    expect(summary.mcpArtifacts[0]).toMatchObject({
      artifactId: "artifact_demo",
      toolCallId: "toolu_demo",
      toolName: "mcp__sketchi-code-mode__execute",
    });
    expect(summary.finalJson).toMatchObject({
      buildOk: true,
      normalizedSpec: { id: "claude-demo-final" },
    });
    expect(summary.stepCosts).toEqual([0.14]);
    expect(summary.steps[0]).toEqual({
      cost: 0.14,
      reason: "completed",
      tokens: {
        cacheRead: 70295,
        cacheWrite: 16414,
        input: 7,
        output: 1464,
      },
    });
  });

  it("summarizes Antigravity transcript MCP calls and flattened execute output", () => {
    const stdout = [
      JSON.stringify({
        source: "MODEL",
        status: "DONE",
        tool_calls: [
          {
            name: "call_mcp_tool",
            args: {
              ServerName: '"sketchi-code-mode"',
              ToolName: '"execute"',
            },
          },
        ],
        type: "PLANNER_RESPONSE",
      }),
      JSON.stringify({
        source: "MODEL",
        status: "DONE",
        type: "MCP_TOOL",
        content: JSON.stringify({
          ok: true,
          result: {
            ok: true,
            artifactId: "artifact_agy",
            diagramId: "agy-demo",
            formats: [
              {
                format: "excalidraw",
                url: "https://studio.test/api/v1/artifacts/artifact_agy?format=excalidraw&raw=true",
              },
              {
                format: "png",
                url: "https://studio.test/api/v1/artifacts/artifact_agy?format=png&raw=true",
              },
            ],
          },
        }),
      }),
      JSON.stringify({
        content: JSON.stringify({
          artifactFormats: ["excalidraw", "png"],
          artifactId: "artifact_agy",
          buildOk: true,
          excalidrawUrl:
            "https://studio.test/api/v1/artifacts/artifact_agy?format=excalidraw&raw=true",
          normalizedSpec: {
            edges: [],
            id: "agy-demo",
            nodes: [],
            title: "Agy demo",
          },
          pngUrl:
            "https://studio.test/api/v1/artifacts/artifact_agy?format=png&raw=true",
          status: "accepted",
        }),
        source: "MODEL",
        status: "DONE",
        type: "PLANNER_RESPONSE",
      }),
    ].join("\n");

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.toolCalls).toEqual([
      {
        name: "mcp(sketchi-code-mode/execute)",
        status: "DONE",
      },
    ]);
    expect(summary.mcpArtifacts).toEqual([
      expect.objectContaining({
        artifactFormats: ["excalidraw", "png"],
        artifactId: "artifact_agy",
        artifactUrls: {
          excalidraw:
            "https://studio.test/api/v1/artifacts/artifact_agy?format=excalidraw&raw=true",
          png: "https://studio.test/api/v1/artifacts/artifact_agy?format=png&raw=true",
        },
        buildOk: true,
        status: "accepted",
        toolName: "mcp(sketchi-code-mode/execute)",
      }),
    ]);
    expect(summary.finalJson).toMatchObject({
      artifactId: "artifact_agy",
      normalizedSpec: { id: "agy-demo" },
      status: "accepted",
    });
  });

  it("uses Antigravity planner prose instead of tool output as final text", () => {
    const stdout = [
      JSON.stringify({
        content: 'File Path: file:///tmp/docs.json\n{"topic":"overview"}',
        source: "MODEL",
        status: "DONE",
        type: "VIEW_FILE",
      }),
      JSON.stringify({
        content:
          "Sketchi artifact ready.\nArtifact ID: artifact_agy\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_agy?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_agy?format=png&raw=true",
        source: "MODEL",
        status: "DONE",
        type: "PLANNER_RESPONSE",
      }),
    ].join("\n");

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.finalJson).toBeUndefined();
    expect(summary.finalText).toContain("Sketchi artifact ready.");
    expect(summary.finalText).not.toContain("topic");
  });

  it("excludes Antigravity tool output result fields from final text", () => {
    const stdout = JSON.stringify({
      result: '{"name":"workflows","isDir":true}',
      source: "MODEL",
      status: "DONE",
      type: "LIST_DIR",
    });

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.finalJson).toBeUndefined();
    expect(summary.finalText).toBe("");
  });

  it("does not scan past newer Antigravity delivery text to older tool JSON", () => {
    const stdout = [
      JSON.stringify({
        result: '{"name":"workflows","isDir":true}',
        source: "MODEL",
        status: "DONE",
        type: "LIST_DIR",
      }),
      JSON.stringify({
        content:
          "Sketchi artifact ready.\nArtifact ID: artifact_agy\nExcalidraw URL: https://studio.test/api/v1/artifacts/artifact_agy?format=excalidraw&raw=true\nPNG URL: https://studio.test/api/v1/artifacts/artifact_agy?format=png&raw=true",
        source: "MODEL",
        status: "DONE",
        type: "PLANNER_RESPONSE",
      }),
    ].join("\n");

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.finalJson).toBeUndefined();
    expect(summary.finalText).toContain("Artifact ID: artifact_agy");
    expect(summary.finalText).not.toContain("workflows");
  });

  it("uses extra MCP payloads as proof without replacing final response JSON", () => {
    const stdout = JSON.stringify({
      type: "text",
      part: {
        type: "text",
        text: JSON.stringify({
          artifactId: "artifact_final",
          buildOk: true,
          status: "accepted",
        }),
      },
    });

    const summary = summarizeHarnessStdout(stdout, [
      JSON.stringify(acceptedMcpOutput),
    ]);

    expect(summary.finalJson).toEqual({
      artifactId: "artifact_final",
      buildOk: true,
      status: "accepted",
    });
    expect(summary.mcpArtifacts[0]).toMatchObject({
      artifactId: "artifact_demo",
    });
  });

  it("extracts MCP proof from artifactDelivery when nested result proof is absent", () => {
    const stdout = [
      JSON.stringify({
        source: "MODEL",
        status: "DONE",
        type: "MCP_TOOL",
        content: JSON.stringify({
          ok: true,
          artifactDelivery: {
            artifactId: "artifact_delivery_only",
            diagramId: "delivery-only",
            formats: [
              {
                format: "excalidraw",
                url: "https://studio.test/api/v1/artifacts/artifact_delivery_only?format=excalidraw&raw=true",
              },
              {
                format: "png",
                url: "https://studio.test/api/v1/artifacts/artifact_delivery_only?format=png&raw=true",
              },
            ],
            finalResponseText:
              "Sketchi artifact ready.\nArtifact ID: artifact_delivery_only",
          },
        }),
      }),
    ].join("\n");

    const summary = summarizeHarnessStdout(stdout);

    expect(summary.mcpArtifacts).toEqual([
      expect.objectContaining({
        artifactFormats: ["excalidraw", "png"],
        artifactId: "artifact_delivery_only",
        artifactUrls: {
          excalidraw:
            "https://studio.test/api/v1/artifacts/artifact_delivery_only?format=excalidraw&raw=true",
          png: "https://studio.test/api/v1/artifacts/artifact_delivery_only?format=png&raw=true",
        },
        buildOk: true,
        status: "accepted",
      }),
    ]);
    expect(summary.finalJson).toBeUndefined();
    expect(summary.finalText).toBe("");
  });

  it("accepts final chat text when it delivers the MCP artifact URLs", () => {
    const proof = summarizeHarnessStdout(
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "sketchi-code-mode_execute",
          state: {
            output: JSON.stringify(acceptedMcpOutput),
            status: "completed",
          },
        },
      }),
    ).mcpArtifacts[0];

    expect(
      outputContractErrors({
        finalJson: undefined,
        finalText: [
          "Sketchi artifact ready.",
          "Artifact ID: artifact_demo",
          "Excalidraw URL: https://studio.test/api/v1/artifacts/artifact_demo?format=excalidraw&raw=true",
          "PNG URL: https://studio.test/api/v1/artifacts/artifact_demo?format=png&raw=true",
        ].join("\n"),
        proof,
      }),
    ).toEqual([]);
  });

  it("accepts final chat text for Excalidraw-only MCP artifacts", () => {
    const excalidrawOnlyMcpOutput = {
      ok: true,
      result: {
        ...acceptedMcpOutput.result,
        artifact: {
          ...acceptedMcpOutput.result.artifact,
          formats: acceptedMcpOutput.result.artifact.formats.filter(
            (formatRef) => formatRef.format !== "png",
          ),
        },
      },
    };
    const proof = summarizeHarnessStdout(
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "sketchi-code-mode_execute",
          state: {
            output: JSON.stringify(excalidrawOnlyMcpOutput),
            status: "completed",
          },
        },
      }),
    ).mcpArtifacts[0];

    expect(
      outputContractErrors({
        finalJson: undefined,
        finalText: [
          "Sketchi artifact ready.",
          "Artifact ID: artifact_demo",
          "Excalidraw URL: https://studio.test/api/v1/artifacts/artifact_demo?format=excalidraw&raw=true",
        ].join("\n"),
        proof,
      }),
    ).toEqual([]);
  });

  it("rejects final chat text that does not deliver the accepted MCP artifact", () => {
    const proof = summarizeHarnessStdout(
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "sketchi-code-mode_execute",
          state: {
            output: JSON.stringify(acceptedMcpOutput),
            status: "completed",
          },
        },
      }),
    ).mcpArtifacts[0];

    expect(
      outputContractErrors({
        finalJson: undefined,
        finalText:
          "Created a Markdown report in diagram_info.md. Please open that instead.",
        proof,
      }),
    ).toContain("Harness final response did not contain parseable JSON.");
  });
});
