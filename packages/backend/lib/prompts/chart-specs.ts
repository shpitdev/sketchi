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
