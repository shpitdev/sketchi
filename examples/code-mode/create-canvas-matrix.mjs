const options = {
  artifactFormats: ["scene", "excalidraw", "png"],
  inlineArtifacts: ["excalidraw"],
};

const canvas = (diagramId, title, elements, layouts = [], layers = []) => ({
  kind: "canvas",
  version: 1,
  diagramId,
  title,
  width: 1200,
  height: 720,
  accentColor: "#1f2937",
  backgroundColor: "#ffffff",
  elements,
  layers,
  layouts,
  zOrder: elements.map((element) => element.id),
});

const box = (id, label, x, y, fillColor = "#dbeafe") => ({
  type: "node",
  id,
  nodeId: id,
  shape: "rectangle",
  x,
  y,
  width: 220,
  height: 120,
  label,
  fillColor,
});

const arrow = (id, source, target, points, label) => ({
  type: "arrow",
  id,
  edgeId: id,
  sourceNodeId: source,
  targetNodeId: target,
  points,
  label,
  endArrowhead: "arrow",
});

export const createErd = (sketchi) => {
  const elements = [
    box("users", "users\nid PK\nemail UNIQUE", 80, 100),
    box("orders", "orders\nid PK\nuser_id FK", 420, 100, "#dcfce7"),
    box("items", "order_items\norder_id FK\nsku", 760, 100, "#fef3c7"),
    arrow(
      "users-orders",
      "users",
      "orders",
      [
        { x: 300, y: 160 },
        { x: 420, y: 160 },
      ],
      "1:N",
    ),
    arrow(
      "orders-items",
      "orders",
      "items",
      [
        { x: 640, y: 160 },
        { x: 760, y: 160 },
      ],
      "1:N",
    ),
  ];
  return sketchi.createCanvas({
    spec: canvas("erd", "Commerce ERD", elements, [
      {
        type: "row",
        ids: ["users", "orders", "items"],
        x: 80,
        y: 100,
        gap: 120,
      },
    ]),
    options,
  });
};

export const createArchitectureMap = (sketchi) => {
  const elements = [
    {
      type: "frame",
      id: "edge-frame",
      name: "Edge",
      x: 40,
      y: 60,
      width: 300,
      height: 560,
      strokeStyle: "dashed",
    },
    {
      type: "frame",
      id: "data-frame",
      name: "Data",
      x: 820,
      y: 60,
      width: 320,
      height: 560,
      strokeStyle: "dashed",
    },
    {
      ...box("worker", "Cloudflare Worker", 80, 150),
      frameId: "edge-frame",
      groupIds: ["request-path"],
    },
    {
      ...box("service", "Effect services", 450, 150, "#ede9fe"),
      groupIds: ["request-path"],
    },
    {
      ...box("storage", "R2 artifacts", 870, 150, "#dcfce7"),
      frameId: "data-frame",
      groupIds: ["request-path"],
    },
    arrow(
      "worker-service",
      "worker",
      "service",
      [
        { x: 300, y: 210 },
        { x: 450, y: 210 },
      ],
      "typed request",
    ),
    arrow(
      "service-storage",
      "service",
      "storage",
      [
        { x: 670, y: 210 },
        { x: 870, y: 210 },
      ],
      "persist",
    ),
  ];
  return sketchi.createCanvas({
    spec: canvas("architecture", "Canvas request architecture", elements),
    options,
  });
};

export const createTimeline = (sketchi) => {
  const milestones = ["Discover", "Design", "Build", "Launch"].map(
    (label, index) => ({
      type: "node",
      id: `milestone-${index}`,
      nodeId: `milestone-${index}`,
      shape: "circle",
      x: 120 + index * 260,
      y: 260,
      width: 90,
      height: 90,
      label,
      fillColor: index === 3 ? "#dcfce7" : "#dbeafe",
    }),
  );
  const segments = milestones.slice(0, -1).map((item, index) =>
    arrow(
      `phase-${index}`,
      item.nodeId,
      milestones[index + 1].nodeId,
      [
        { x: item.x + 90, y: 305 },
        { x: milestones[index + 1].x, y: 305 },
      ],
      `Q${index + 1}`,
    ),
  );
  return sketchi.createCanvas({
    spec: canvas("timeline", "Product timeline", [...milestones, ...segments]),
    options,
  });
};

export const createDashboard = (sketchi) => {
  const cards = [
    box("revenue", "Revenue\n$248k", 80, 80, "#dcfce7"),
    box("users", "Active users\n18.4k", 340, 80, "#dbeafe"),
    box("conversion", "Conversion\n7.2%", 600, 80, "#fef3c7"),
  ];
  const bars = [120, 220, 160, 290, 250].map((height, index) => ({
    type: "node",
    id: `bar-${index}`,
    nodeId: `bar-${index}`,
    shape: "rectangle",
    x: 100 + index * 110,
    y: 600 - height,
    width: 70,
    height,
    label: `${height}`,
    fillColor: "#bfdbfe",
  }));
  return sketchi.createCanvas({
    spec: canvas(
      "dashboard",
      "Growth dashboard",
      [...cards, ...bars],
      [
        {
          type: "row",
          ids: cards.map((card) => card.id),
          x: 80,
          y: 80,
          gap: 40,
        },
        {
          type: "align",
          ids: bars.map((bar) => bar.id),
          axis: "y",
          alignment: "end",
        },
      ],
    ),
    options,
  });
};

export const createWireframe = (sketchi) => {
  const elements = [
    {
      type: "frame",
      id: "browser",
      name: "Account settings",
      x: 80,
      y: 60,
      width: 1000,
      height: 600,
    },
    {
      ...box("nav", "Logo     Projects     Settings", 120, 100, "#f3f4f6"),
      width: 920,
      height: 72,
      frameId: "browser",
    },
    {
      ...box("sidebar", "Profile\nSecurity\nBilling", 120, 210, "#f9fafb"),
      width: 220,
      height: 360,
      frameId: "browser",
    },
    {
      ...box(
        "form",
        "Display name\n[ Ada Lovelace ]\n\nEmail\n[ ada@example.com ]",
        390,
        210,
        "#ffffff",
      ),
      width: 650,
      height: 280,
      frameId: "browser",
    },
    {
      ...box("save", "Save changes", 820, 520, "#dbeafe"),
      width: 220,
      height: 64,
      frameId: "browser",
    },
  ];
  return sketchi.createCanvas({
    spec: canvas("wireframe", "Settings wireframe", elements),
    options,
  });
};

export const createDenseCanvas = (sketchi) => {
  const elements = Array.from({ length: 120 }, (_, index) => ({
    type: "node",
    id: `cell-${index}`,
    nodeId: `cell-${index}`,
    shape: index % 7 === 0 ? "diamond" : "rectangle",
    x: 0,
    y: 0,
    width: 82,
    height: 48,
    label: `Cell ${index + 1}`,
    fillColor: index % 2 === 0 ? "#dbeafe" : "#f3f4f6",
  }));
  return sketchi.createCanvas({
    spec: canvas("dense-120", "Dense 120 element matrix", elements, [
      {
        type: "grid",
        ids: elements.map((element) => element.id),
        columns: 12,
        x: 40,
        y: 40,
        columnGap: 12,
        rowGap: 12,
      },
    ]),
    options,
  });
};
