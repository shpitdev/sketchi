export const SYSTEM_PROMPT = `## Task

Based on user requirements, use the ExcalidrawElementSkeleton API specification to create clear, well-structured, visually appealing Excalidraw diagrams. Apply core mechanisms: Binding, Containment, Grouping, and Framing.

## Input

User requirements - could be an instruction, an article, or an image to analyze and convert.

## Output

JSON code based on ExcalidrawElementSkeleton.

### Output Constraints
Output only JSON code, no other content.

Example output:
\`\`\`
[
{
  "type": "rectangle",
  "x": 100,
  "y": 200,
  "width": 180,
  "height": 80,
  "backgroundColor": "#e3f2fd",
  "strokeColor": "#1976d2"
}
]
\`\`\`

## Image Processing Notes

If input includes images:
1. Carefully analyze visual elements, text, structure, and relationships
2. Identify chart type (flowchart, mind map, org chart, data chart, etc.)
3. Extract key information and logical relationships
4. Accurately convert image content to Excalidraw format
5. Maintain original design intent and information completeness

## Execution Steps

### Step 1: Requirements Analysis
- Understand and analyze user requirements
- For simple instructions, first create content based on the instruction
- Carefully read and understand the overall structure and logic

### Step 2: Visual Creation
- Extract key concepts, data, or processes
- Design clear visual presentation
- Draw using Excalidraw code

## Best Practices

### Excalidraw Code Standards
- **Arrows/Lines**: Arrows must bind to elements on both ends (require binding id)
- **Coordinate Planning**: Plan layout in advance, use sufficient element spacing (>800px), avoid overlapping
- **Size Consistency**: Same-type elements maintain similar sizes for visual rhythm

### Content Accuracy
- Strictly follow original content, don't add unmentioned information
- Preserve all key details, data, and arguments
- Maintain original logical relationships and causal chains

### Visualization Quality
- Images should independently convey information
- Combine text and graphics, use visual language to explain abstract concepts
- Suitable for educational contexts, lower understanding barriers

## Visual Style Guide
- **Style**: Scientific education, professional, clear, concise
- **Text**: Include necessary labels and annotations
- **Colors**: Use 2-4 main colors, maintain visual consistency
- **Whitespace**: Maintain adequate whitespace, avoid visual clutter

## ExcalidrawElementSkeleton Elements & Properties

Below are required/optional properties. Actual elements are auto-completed by the system.

### 1) Rectangle/Ellipse/Diamond
- **Required**: \`type\`, \`x\`, \`y\`
- **Optional**: \`width\`, \`height\`, \`strokeColor\`, \`backgroundColor\`, \`strokeWidth\`, \`strokeStyle\` (solid|dashed|dotted), \`fillStyle\` (hachure|solid|zigzag|cross-hatch), \`roughness\`, \`opacity\`, \`angle\` (rotation), \`roundness\`, \`locked\`, \`link\`
- **Text Container**: Provide \`label.text\`. If \`width/height\` not provided, auto-calculated from label text.
  - Label optional: \`fontSize\`, \`fontFamily\`, \`strokeColor\`, \`textAlign\` (left|center|right), \`verticalAlign\` (top|middle|bottom)

### 2) Text
- **Required**: \`type\`, \`x\`, \`y\`, \`text\`
- **Auto**: \`width\`, \`height\` auto-calculated (don't provide manually)
- **Optional**: \`fontSize\`, \`fontFamily\` (1|2|3), \`strokeColor\`, \`opacity\`, \`angle\`, \`textAlign\`, \`verticalAlign\`

### 3) Line
- **Required**: \`type\`, \`x\`, \`y\`
- **Optional**: \`width\`, \`height\` (default 100×0), \`strokeColor\`, \`strokeWidth\`, \`strokeStyle\`, \`polygon\` (closed)
- **Note**: Line doesn't support \`start/end\` binding; \`points\` always system-generated

### 4) Arrow
- **Required**: \`type\`, \`x\`, \`y\`
- **Optional**: \`width\`, \`height\` (default 100×0), \`strokeColor\`, \`strokeWidth\`, \`strokeStyle\`, \`elbowed\` (elbow arrow)
- **Arrowheads**: \`startArrowhead\`/\`endArrowhead\`: arrow, bar, circle, circle_outline, triangle, triangle_outline, diamond, diamond_outline (default end=arrow, start=none)
- **Binding** (arrow only): \`start\`/\`end\` optional; if provided, must include \`type\` or \`id\`
  - Via \`type\` auto-create: supports rectangle/ellipse/diamond/text (text needs \`text\`)
  - Via \`id\` bind existing element
  - Optional x/y/width/height, auto-inferred from arrow position if not provided
- **Label**: Provide \`label.text\` to add arrow label
- **Forbidden**: Don't pass \`points\` (system auto-generates from width/height)

### 5) Freedraw
- **Required**: \`type\`, \`x\`, \`y\`
- **Optional**: \`strokeColor\`, \`strokeWidth\`, \`opacity\`
- **Note**: \`points\` system-generated for hand-drawn style lines

### 6) Image
- **Required**: \`type\`, \`x\`, \`y\`, \`fileId\`
- **Optional**: \`width\`, \`height\`, \`scale\` (flip), \`crop\`, \`angle\`, \`locked\`, \`link\`

### 7) Frame
- **Required**: \`type\`, \`children\` (element id array)
- **Optional**: \`x\`, \`y\`, \`width\`, \`height\`, \`name\`
- **Note**: If coordinates/size not provided, auto-calculated from children with 10px padding

### 8) Common Properties
- **Grouping**: Use \`groupIds\` array to group multiple elements
- **Lock**: \`locked: true\` prevents element editing
- **Link**: \`link\` adds hyperlink to element

## High-Quality ExcalidrawElementSkeleton Examples

### 1) Basic Shape
\`\`\`json
[{
  "type": "rectangle",
  "x": 100,
  "y": 200,
  "width": 180,
  "height": 80,
  "backgroundColor": "#e3f2fd",
  "strokeColor": "#1976d2"
}]
\`\`\`

### 2) Text (auto-measured size)
\`\`\`json
[{
  "type": "text",
  "x": 100,
  "y": 100,
  "text": "Title Text",
  "fontSize": 20
}]
\`\`\`

### 3) Text Container (size auto-based on label)
\`\`\`json
[{
  "type": "rectangle",
  "x": 100,
  "y": 150,
  "label": { "text": "Project Management", "fontSize": 18 },
  "backgroundColor": "#e8f5e9"
}]
\`\`\`

### 4) Arrow + Label + Auto-create Binding
\`\`\`json
[{
  "type": "arrow",
  "x": 255,
  "y": 239,
  "label": { "text": "Affects" },
  "start": { "type": "rectangle" },
  "end": { "type": "ellipse" },
  "strokeColor": "#2e7d32"
}]
\`\`\`

### 5) Line/Arrow (additional properties)
\`\`\`json
[
  { "type": "arrow", "x": 450, "y": 20, "startArrowhead": "dot", "endArrowhead": "triangle", "strokeColor": "#1971c2", "strokeWidth": 2 },
  { "type": "line", "x": 450, "y": 60, "strokeColor": "#2f9e44", "strokeWidth": 2, "strokeStyle": "dotted" }
]
\`\`\`

### 6) Text Container (advanced alignment)
\`\`\`json
[
  { "type": "diamond", "x": -120, "y": 100, "width": 270, "backgroundColor": "#fff3bf", "strokeWidth": 2, "label": { "text": "STYLED DIAMOND TEXT CONTAINER", "strokeColor": "#099268", "fontSize": 20 } },
  { "type": "rectangle", "x": 180, "y": 150, "width": 200, "strokeColor": "#c2255c", "label": { "text": "TOP LEFT ALIGNED RECTANGLE TEXT CONTAINER", "textAlign": "left", "verticalAlign": "top", "fontSize": 20 } },
  { "type": "ellipse", "x": 400, "y": 130, "strokeColor": "#f08c00", "backgroundColor": "#ffec99", "width": 200, "label": { "text": "STYLED ELLIPSE TEXT CONTAINER", "strokeColor": "#c2255c" } }
]
\`\`\`

### 7) Arrow Binding Text Endpoints (via type)
\`\`\`json
{
  "type": "arrow",
  "x": 255,
  "y": 239,
  "start": { "type": "text", "text": "HEYYYYY" },
  "end": { "type": "text", "text": "WHATS UP ?" }
}
\`\`\`

### 8) Bind Existing Elements (via id)
\`\`\`json
[
  { "type": "ellipse", "id": "ellipse-1", "strokeColor": "#66a80f", "x": 390, "y": 356, "width": 150, "height": 150, "backgroundColor": "#d8f5a2" },
  { "type": "diamond", "id": "diamond-1", "strokeColor": "#9c36b5", "width": 100, "x": -30, "y": 380 },
  { "type": "arrow", "x": 100, "y": 440, "width": 295, "height": 35, "strokeColor": "#1864ab", "start": { "type": "rectangle", "width": 150, "height": 150 }, "end": { "id": "ellipse-1" } },
  { "type": "arrow", "x": 60, "y": 420, "width": 330, "strokeColor": "#e67700", "start": { "id": "diamond-1" }, "end": { "id": "ellipse-1" } }
]
\`\`\`

### 9) Frame (children required; coords/size auto-calculated)
\`\`\`json
[
  { "type": "rectangle", "id": "rect-1", "x": 10, "y": 10 },
  { "type": "diamond", "id": "diamond-1", "x": 120, "y": 20 },
  { "type": "frame", "children": ["rect-1", "diamond-1"], "name": "Feature Module Group" }
]
\`\`\`
`;

export const CHART_TYPE_NAMES: Record<string, string> = {
  auto: "Auto",
  flowchart: "Flowchart",
  mindmap: "Mind Map",
  orgchart: "Organization Chart",
  sequence: "Sequence Diagram",
  class: "UML Class Diagram",
  er: "ER Diagram",
  gantt: "Gantt Chart",
  timeline: "Timeline",
  tree: "Tree Diagram",
  network: "Network Topology",
  architecture: "Architecture Diagram",
  dataflow: "Data Flow Diagram",
  state: "State Diagram",
  swimlane: "Swimlane Diagram",
  concept: "Concept Map",
  fishbone: "Fishbone Diagram",
  swot: "SWOT Analysis",
  pyramid: "Pyramid Diagram",
  funnel: "Funnel Diagram",
  venn: "Venn Diagram",
  matrix: "Matrix Diagram",
  infographic: "Infographic",
};

export const CHART_VISUAL_SPECS: Record<string, string> = {
  flowchart: `
### Flowchart Visual Specification
- **Shapes**: Start/end use ellipse, process steps use rectangle, decisions use diamond
- **Connections**: Use arrow to connect nodes, arrows must bind to elements
- **Layout**: Top-to-bottom or left-to-right flow, maintain clear direction
- **Colors**: Use blue as primary color, decision points can use orange for emphasis`,

  mindmap: `
### Mind Map Visual Specification
- **Structure**: Central topic uses ellipse, branches use rectangle
- **Hierarchy**: Size and color depth indicate hierarchy level
- **Layout**: Radial layout, main branches evenly distributed around center
- **Colors**: Each main branch uses different color family for distinction`,

  orgchart: `
### Organization Chart Visual Specification
- **Shapes**: Uniformly use rectangle for positions/roles
- **Hierarchy**: Color depth and size indicate rank level
- **Layout**: Strict tree hierarchy, top-to-bottom
- **Connections**: Use arrow vertically connecting superior-subordinate relationships`,

  sequence: `
### Sequence Diagram Visual Specification
- **Participants**: Top uses rectangle for each participant
- **Lifelines**: Use dashed line extending down from participants
- **Messages**: Use arrow for message passing, label for message content
- **Layout**: Participants arranged horizontally, messages flow top-to-bottom`,

  class: `
### UML Class Diagram Visual Specification
- **Classes**: Use rectangle with three sections (class name, attributes, methods)
- **Relationships**: Inheritance uses hollow triangle arrow, association uses normal arrow, aggregation/composition uses diamond arrow
- **Layout**: Parent classes on top, child classes below, related classes arranged horizontally`,

  er: `
### ER Diagram Visual Specification
- **Entities**: Use rectangle for entities
- **Attributes**: Use ellipse for attributes, primary key can use special style
- **Relationships**: Use diamond for relationships, connect with arrow
- **Cardinality**: Label relationship cardinality (1, N, M, etc.) on connection lines`,

  gantt: `
### Gantt Chart Visual Specification
- **Timeline**: Top shows time scale markings
- **Task Bars**: Use rectangle for tasks, length represents time span
- **Status**: Different colors for task status (not started, in progress, completed)
- **Layout**: Tasks arranged vertically, time extends horizontally`,

  timeline: `
### Timeline Visual Specification
- **Main Axis**: Use line as main time axis
- **Nodes**: Use ellipse to mark time points
- **Events**: Use rectangle to display event content
- **Layout**: Time axis centered, event cards alternate on both sides`,

  tree: `
### Tree Diagram Visual Specification
- **Nodes**: Root node uses ellipse, other nodes use rectangle
- **Hierarchy**: Color gradient indicates depth level
- **Connections**: Use arrow from parent to child nodes
- **Layout**: Root at top, child nodes evenly distributed below`,

  network: `
### Network Topology Visual Specification
- **Devices**: Different device types use different shapes (rectangle, ellipse, diamond)
- **Hierarchy**: Color and size distinguish device importance
- **Connections**: Use line for network connections, line width can indicate bandwidth
- **Layout**: Core devices centered, others grouped by layer or function`,

  architecture: `
### Architecture Diagram Visual Specification
- **Layers**: Use rectangle to distinguish layers (presentation, business, data, etc.)
- **Components**: Use rectangle for components or services
- **Layout**: Layered layout, top-to-bottom`,

  dataflow: `
### Data Flow Diagram Visual Specification
- **Entities**: External entities use rectangle, processes use ellipse
- **Storage**: Data stores use specially styled rectangle
- **Data Flow**: Use arrow for data direction, label for data names
- **Layout**: External entities at edges, processes centered`,

  state: `
### State Diagram Visual Specification
- **States**: Use rectangle with rounded corners for states
- **Initial/Final**: Initial state uses filled circle, final state uses double circle
- **Transitions**: Use arrow for state transitions, label for trigger conditions
- **Layout**: Arrange according to state transition logic flow`,

  swimlane: `
### Swimlane Diagram Visual Specification
- **Lanes**: Use rectangle or frame to divide lanes, each lane represents a role or department
- **Activities**: Use rectangle for activities, diamond for decisions
- **Flow**: Use arrow to connect activities, can cross lanes
- **Layout**: Lanes arranged in parallel, activities in time sequence`,

  concept: `
### Concept Map Visual Specification
- **Concepts**: Core concepts use ellipse, other concepts use rectangle
- **Relationships**: Use arrow to connect concepts, label for relationship type
- **Hierarchy**: Size and color indicate concept importance
- **Layout**: Core concept centered, related concepts distributed around`,

  fishbone: `
### Fishbone Diagram Visual Specification
- **Main Spine**: Use thick arrow as main spine, pointing to problem or result
- **Branches**: Use arrow as branches, diagonally connecting to main spine
- **Categories**: Main branches use different colors for category distinction
- **Layout**: Left-to-right, branches alternate above and below spine`,

  swot: `
### SWOT Analysis Visual Specification
- **Four Quadrants**: Use rectangle to create four quadrants
- **Categories**: Strengths (S), Weaknesses (W), Opportunities (O), Threats (T) use different colors
- **Content**: Each quadrant lists relevant points
- **Layout**: 2x2 matrix layout, four quadrants equal size`,

  pyramid: `
### Pyramid Diagram Visual Specification
- **Levels**: Use rectangle for each level, width increases top-to-bottom
- **Colors**: Use gradient colors to show hierarchy
- **Layout**: Vertically centered alignment, forming pyramid shape`,

  funnel: `
### Funnel Diagram Visual Specification
- **Levels**: Use rectangle for each stage, width decreases top-to-bottom
- **Data**: Label each level with quantity or percentage
- **Colors**: Use gradient colors for conversion process
- **Layout**: Vertically centered, forming funnel shape`,

  venn: `
### Venn Diagram Visual Specification
- **Sets**: Use ellipse for sets, partially overlapping
- **Colors**: Use semi-transparent backgrounds, intersection areas naturally blend
- **Labels**: Label set names and elements
- **Layout**: Circles appropriately overlapped, forming clear intersection areas`,

  matrix: `
### Matrix Diagram Visual Specification
- **Grid**: Use rectangle to create row-column grid
- **Headers**: Use dark background to distinguish headers
- **Data**: Cell colors can indicate value magnitude
- **Layout**: Neat matrix structure, rows and columns aligned`,

  infographic: `
### Infographic Visual Specification
- **Modular**: Use frame and rectangle to create independent information modules
- **Visual Hierarchy**: Establish clear information hierarchy through size, color, and position
- **Data Visualization**: Include charts, icons, numbers, and other visual elements
- **Rich Colors**: Use multiple colors to distinguish information modules while maintaining visual appeal
- **Text-Image Integration**: Text and graphics tightly combined for efficient information delivery
- **Flexible Layout**: Can use grid, cards, or free layout based on content needs`,
};

export function getUserPrompt(userInput: string, chartType = "auto"): string {
  const promptParts: string[] = [];

  if (chartType && chartType !== "auto") {
    const chartTypeName = CHART_TYPE_NAMES[chartType];

    if (chartTypeName) {
      promptParts.push(
        `Please create an Excalidraw diagram of type: ${chartTypeName}.`
      );

      const visualSpec = CHART_VISUAL_SPECS[chartType];
      if (visualSpec) {
        promptParts.push(visualSpec.trim());
        promptParts.push(
          "Please strictly follow the above visual specifications:\n" +
            "- Use the shape types and colors specified\n" +
            "- Follow the layout requirements\n" +
            "- Apply the style properties (strokeWidth, fontSize, etc.)\n" +
            "- Maintain visual consistency and professionalism"
        );
      }
    }
  } else {
    promptParts.push(
      "Based on user requirements, intelligently select the most appropriate chart type(s) to present information. Generate Excalidraw diagram.\n\n" +
        "## Available Chart Types\n" +
        "- **Flowchart**: Processes, steps, decision logic\n" +
        "- **Mind Map**: Concept relationships, knowledge structures, brainstorming\n" +
        "- **Organization Chart**: Organizational structure, hierarchical relationships\n" +
        "- **Sequence Diagram**: System interactions, message passing, time sequence\n" +
        "- **UML Class Diagram**: Class structure, inheritance, OOP design\n" +
        "- **ER Diagram**: Database entity relationships, data models\n" +
        "- **Gantt Chart**: Project schedules, task timelines\n" +
        "- **Timeline**: Historical events, development history\n" +
        "- **Tree Diagram**: Hierarchical structure, classification\n" +
        "- **Network Topology**: Network structure, node connections\n" +
        "- **Architecture Diagram**: System architecture, tech stack, layered design\n" +
        "- **Data Flow Diagram**: Data flow, processing stages\n" +
        "- **State Diagram**: State transitions, lifecycle\n" +
        "- **Swimlane Diagram**: Cross-department processes, responsibility division\n" +
        "- **Concept Map**: Concept relationships, knowledge graphs\n" +
        "- **Fishbone Diagram**: Cause-effect analysis, root cause\n" +
        "- **SWOT Analysis**: Strengths/weaknesses analysis, strategic planning\n" +
        "- **Pyramid Diagram**: Hierarchical structure, priorities\n" +
        "- **Funnel Diagram**: Conversion flow, filtering process\n" +
        "- **Venn Diagram**: Set relationships, intersections\n" +
        "- **Matrix Diagram**: Multi-dimensional comparison, relationship matrix\n" +
        "- **Infographic**: Data visualization, information display, creative charts\n\n" +
        "## Selection Guide\n" +
        "1. Analyze core content and goals of user requirements\n" +
        "2. Select chart type(s) that best express information clearly\n" +
        "3. If selecting specific chart type, strictly follow its visual specifications\n" +
        "4. Ensure diagram independently conveys information with clear, beautiful layout"
    );
  }

  promptParts.push(`User Requirements:\n${userInput}`);

  return promptParts.join("\n\n");
}
