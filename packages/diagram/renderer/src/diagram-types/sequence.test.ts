import { describe, expect, it } from "vitest";

import { renderSequenceDiagram } from "../sequence";

const sequence = {
  id: "checkout-sequence",
  title: "Checkout sequence",
  participants: [
    { id: "customer", label: "Customer" },
    { id: "store", label: "Store" },
    { id: "payments", label: "Payments" },
  ],
  messages: [
    { id: "start", source: "customer", target: "store", label: "Checkout" },
    { id: "charge", source: "store", target: "payments", label: "Charge" },
    { id: "receipt", source: "payments", target: "customer", label: "Receipt" },
  ],
  style: { accentColor: "#000000", backgroundColor: "#ffffff" },
} as const;

describe("sequence diagram renderer", () => {
  it("preserves participant and chronological message order", () => {
    const scene = renderSequenceDiagram(sequence);
    const headers = scene.elements.filter(
      (element): element is Extract<typeof element, { type: "node" }> =>
        element.type === "node" &&
        element.rendererRole !== "sequence-lifeline",
    );
    const messages = scene.elements.filter(
      (element) => element.type === "arrow",
    );

    expect(headers.map((header) => header.nodeId)).toEqual([
      "customer",
      "store",
      "payments",
    ]);
    expect(headers.map((header) => header.x)).toEqual(
      [...headers.map((header) => header.x)].sort((a, b) => a - b),
    );
    expect(messages.map((message) => message.edgeId)).toEqual([
      "start",
      "charge",
      "receipt",
    ]);
    expect(messages.map((message) => message.points[0].y)).toEqual(
      [...messages.map((message) => message.points[0].y)].sort((a, b) => a - b),
    );
    expect(
      scene.elements.filter(
        (element) =>
          element.type === "node" &&
          element.rendererRole === "sequence-lifeline",
      ),
    ).toHaveLength(3);
  });

  it("rejects self messages cleanly", () => {
    expect(() =>
      renderSequenceDiagram({
        ...sequence,
        messages: [
          { id: "self", source: "store", target: "store", label: "Retry" },
        ],
      }),
    ).toThrow(/cannot target its source/);
  });

  it("rejects participant ids that collide with generated lifelines", () => {
    expect(() =>
      renderSequenceDiagram({
        ...sequence,
        participants: [
          { id: "api", label: "API" },
          { id: "api:lifeline", label: "Worker" },
        ],
        messages: [],
      }),
    ).toThrow(/collides with the generated lifeline/);
  });
});
