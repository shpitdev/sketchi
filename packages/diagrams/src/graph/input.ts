/** Trusted geometry supplied by a validated family, with drawing traits already resolved. */
import type { CanvasShapeElement, CanvasShapeKind, DiagramIconRef } from "@sketchi/drawing";

export interface GraphNode {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly group?: string;
	readonly lane?: string;
	/** Drawn role: also selects marker sizing and branch-port placement. */
	readonly kind?: string | undefined;
	readonly shape: CanvasShapeKind;
	readonly icon?: DiagramIconRef | undefined;
	readonly paint?: Pick<CanvasShapeElement, "fillColor" | "fillStyle" | "strokeColor">;
}

export interface GraphEdge {
	readonly id: string;
	readonly source: string;
	readonly target: string;
	readonly label?: string;
}

export interface GraphGroup {
	readonly id: string;
	readonly label: string;
	readonly parent?: string | undefined;
	/** Drawn zone treatment; authored vocabulary belongs to the family. */
	readonly kind?: string | undefined;
	readonly icon?: DiagramIconRef | undefined;
}

export interface GraphLane {
	readonly id: string;
	readonly label: string;
}

export interface GraphInput {
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly groups?: readonly GraphGroup[];
	readonly lanes?: readonly GraphLane[];
	readonly layout: {
		readonly direction: "TB" | "BT" | "LR" | "RL";
		readonly edgeRouting: "straight" | "orthogonal" | "curved";
	};
}
