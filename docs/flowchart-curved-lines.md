# Curved flowchart lines

A flowchart document with `curved: true` (IR `layout.edgeRouting: "curved"`)
draws its lines as curves. They follow the routes square lines take, so they
keep the same guarantees: no line through a node or along another, labels
clear, and ports where the router puts them.

Each finished orthogonal route has its corners turned through quarter curves
as wide as room allows, up to 56 px. A departure keeps a straight run from its
port, and an arrival keeps one into its arrowhead. A corner curves less, and
at worst stays square, wherever its curve would come nearer a node it passes
than its route did (or nearer than 12 px), cross or touch another line more
than its route did, or enter a label its route kept clear of. Excalidraw draws
each line as a smooth curved arrow through the sampled points.

`curved` is opt-in. The CLI, the generate API and the MCP's `buildFlowchart`
read it from the document, `editFlowchart` sets it with
`{ op: "set", curved }`, and a request that asks for curved lines gets
`curved: true`. Scenarios whose prompt asks for curved lines check that every
line is drawn curved (`curved-lines`): `feedback-triage-curved`,
`ingest-pipeline-curved-lr` and `checkout-services-curved-zones`.
