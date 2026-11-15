/** A point on a node's side a line's end is pinned to: its offset from the middle of that side. */
export interface GraphAnchor {
	readonly side: "top" | "right" | "bottom" | "left";
	readonly offset: number;
	/**
	 * This end's straight run, in place of `endRun`. Lines that share a port take
	 * different runs, so each leaves the shared stem at a point of its own.
	 */
	readonly run?: number;
}

/** Choices a family's renderer makes for its graph; flowcharts and mindmaps make none. */
export interface GraphRenderOptions {
	/**
	 * Draw an edge and its return between the same two nodes as a parallel pair
	 * (orthogonal routing), as state machines draw a transition and its return.
	 */
	readonly pairedReturns?: boolean;
	/**
	 * The family's own placement, each node's box by node id, drawn as given: the
	 * router only routes. The family leaves room between nodes for the lines.
	 */
	readonly placement?: ReadonlyMap<
		string,
		{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }
	>;
	/**
	 * Line ends pinned to a point, by `<edgeId>:source` or `<edgeId>:target`
	 * (orthogonal routing). Ends pinned to the same point share their stub.
	 */
	readonly anchors?: ReadonlyMap<string, GraphAnchor>;
	/**
	 * Straight run every line keeps at each end before it turns or carries its
	 * label, so markers drawn at its ends (crow's feet) sit on a straight line.
	 */
	readonly endRun?: number;
	/**
	 * How near a line may run beside another that shares one of its nodes,
	 * where that is nearer than a reader's corridor gap at the export's size: as
	 * near as the family spaces their ports, rather than detour to keep the
	 * reader's gap. Each end's own mark tells the two apart where they leave or
	 * reach that node.
	 */
	readonly besideShared?: number;
}
