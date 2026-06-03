import {
  DEFAULT_DIAGRAM_TYPE as CORE_DEFAULT_DIAGRAM_TYPE,
  type DiagramType as CoreDiagramType,
  DiagramTypeSchema as CoreDiagramTypeSchema,
  type EdgeRouting as CoreEdgeRouting,
  EdgeRoutingSchema as CoreEdgeRoutingSchema,
  EdgeSchema as CoreEdgeSchema,
  type GraphLayout as CoreGraphLayout,
  GraphLayoutSchema as CoreGraphLayoutSchema,
  type GraphOptions as CoreGraphOptions,
  GraphOptionsSchema as CoreGraphOptionsSchema,
  type GraphStyle as CoreGraphStyle,
  GraphStyleSchema as CoreGraphStyleSchema,
  type IntermediateDiagram as CoreIntermediateDiagram,
  IntermediateDiagramSchema as CoreIntermediateDiagramSchema,
  type IntermediateEdge as CoreIntermediateEdge,
  IntermediateEdgeSchema as CoreIntermediateEdgeSchema,
  type IntermediateFormat as CoreIntermediateFormat,
  IntermediateFormatSchema as CoreIntermediateFormatSchema,
  type IntermediateNode as CoreIntermediateNode,
  IntermediateNodeSchema as CoreIntermediateNodeSchema,
  type LayoutDirection as CoreLayoutDirection,
  LayoutDirectionSchema as CoreLayoutDirectionSchema,
  NodeSchema as CoreNodeSchema,
  parseIntermediateDiagram as coreParseIntermediateDiagram,
  validateIntermediateDiagram as coreValidateIntermediateDiagram,
} from "@sketchi/diagram-core";

export const DEFAULT_DIAGRAM_TYPE = CORE_DEFAULT_DIAGRAM_TYPE;
export const DiagramTypeSchema = CoreDiagramTypeSchema;
export const EdgeRoutingSchema = CoreEdgeRoutingSchema;
export const EdgeSchema = CoreEdgeSchema;
export const GraphLayoutSchema = CoreGraphLayoutSchema;
export const GraphOptionsSchema = CoreGraphOptionsSchema;
export const GraphStyleSchema = CoreGraphStyleSchema;
export const IntermediateDiagramSchema = CoreIntermediateDiagramSchema;
export const IntermediateEdgeSchema = CoreIntermediateEdgeSchema;
export const IntermediateFormatSchema = CoreIntermediateFormatSchema;
export const IntermediateNodeSchema = CoreIntermediateNodeSchema;
export const LayoutDirectionSchema = CoreLayoutDirectionSchema;
export const NodeSchema = CoreNodeSchema;
export const parseIntermediateDiagram = coreParseIntermediateDiagram;
export const validateIntermediateDiagram = coreValidateIntermediateDiagram;

export type DiagramType = CoreDiagramType;
export type EdgeRouting = CoreEdgeRouting;
export type GraphLayout = CoreGraphLayout;
export type GraphOptions = CoreGraphOptions;
export type GraphStyle = CoreGraphStyle;
export type IntermediateDiagram = CoreIntermediateDiagram;
export type IntermediateEdge = CoreIntermediateEdge;
export type IntermediateFormat = CoreIntermediateFormat;
export type IntermediateNode = CoreIntermediateNode;
export type LayoutDirection = CoreLayoutDirection;
