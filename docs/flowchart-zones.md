# Architecture zones and infrastructure shapes

Zones are flowchart groups that nest and say what they stand for: a cloud or an on-prem data center, a region, an availability or network zone, a VPC and its subnets, a cluster and its namespaces. Infrastructure shapes draw a node as a database cylinder, a queue, a document or a storage bucket. Together they draw the architecture diagrams developers ask for most, such as an AWS three-tier app, inside the flowchart family.

```json
{"type":"flowchart","spec":{"title":"AWS three-tier app","layout":{"direction":"LR"},"groups":[{"id":"region","label":"us-east-1","kind":"region"},{"id":"vpc","label":"VPC 10.0.0.0/16","kind":"vpc","parent":"region"},{"id":"public","label":"Public subnet","kind":"subnet","parent":"vpc"},{"id":"private","label":"Private subnet","kind":"subnet","parent":"vpc"},{"id":"data","label":"Database subnet","kind":"subnet","parent":"vpc"}],"nodes":[{"id":"users","label":"Users","kind":"start"},{"id":"alb","label":"Application Load Balancer","kind":"process","group":"public"},{"id":"api","label":"ECS API service","kind":"process","group":"private"},{"id":"rds","label":"RDS PostgreSQL","kind":"end","shape":"database","group":"data"},{"id":"s3","label":"S3 assets bucket","kind":"end","shape":"storage","group":"region"}],"edges":[{"source":"users","target":"alb"},{"source":"alb","target":"api"},{"source":"api","target":"rds"},{"source":"api","target":"s3"}]}}
```

## Contract

Additive to [flowchart groups](./flowchart-groups.md):

- `groups[].parent` names the declared group a group sits inside. It mirrors `parent` on `buildStateMachine` states, and an explicit field is the contract the groups plan asked for: nesting is never read out of ids or labels.
- `groups[].kind` is one of `cloud`, `datacenter`, `region`, `zone`, `vpc`, `subnet`, `cluster` or `namespace`. It says what a zone stands for and sets how it draws. It is a closed set so a model picks a drawn treatment, not free text.
- `nodes[].shape` is one of `database`, `queue`, `document` or `storage`. It is separate from `kind`, which keeps meaning start, process, decision or end, so a flowchart's start, end and reachability rules hold unchanged: a database a request ends at is `kind: "end", shape: "database"`.
- A node sets `group` to its innermost zone. A zone holds nodes directly or through the zones nested in it.
- Zones nest at most 4 deep (a cloud, a region, a VPC and a subnet), and a flowchart keeps at most 8 groups.

Builds reject a `parent` that names no declared group (`unknown_group_parent`, with the declared ids in its hint), a group nested inside itself (`group_cycle`), zones nested deeper than 4 (`flowchart_too_large`), and a decision with a `shape` (`shaped_decision`; a decision always draws as a diamond). A group that holds nodes only through nested zones is not empty.

## Drawing

A diagram whose groups declare a `parent` or a `kind` draws them as zones. A flowchart whose groups declare neither draws frames exactly as before.

| kind | outline | fill |
| --- | --- | --- |
| `cloud` | dark, dashed, heavy | none |
| `datacenter` | dark, solid, heavy | none |
| `region` | accent, dashed | none |
| `zone` | accent, dotted | none |
| `vpc`, `cluster` | accent, solid, heavy | none |
| `subnet` | accent, solid | paper |
| `namespace` | accent, dashed | mauve tint |

Each zone's label sits at the left of a header strip across its top; nothing the zone holds enters the strip. Zones draw outermost first, under everything they hold.

## Layout

- Each zone's members and nested zones are laid out as a flow of their own, innermost first; a nested zone is one block in its parent's flow, the way an outermost zone is one block among the ungrouped nodes. Children stay inside their parents and zones that do not nest never overlap.
- Edges route around every zone neither end sits in and never cross a zone's label or run along its outline. An edge whose ends share a zone stays inside the innermost zone holding both.
- Zones keep the diagram's direction at every level: zones a flow passes through one after another follow it, and zones it does not join stand side by side across it.
- A zoned flow too long for its breadth (2.45:1 for a row at least 1,200 px long or for any column, 4:1 always) wraps as a plain flowchart wraps into rows or columns, never by turning a zone across the flow. Level by level, the top level or one zone's members cut between whole ranks into bands, each read in the stated direction, columns keeping the plain rule's even-split guard. A band hangs under the step that leads into it, as far as the longest band allows, and lines into it turn in from that side. Of the plans that route with no more crossings, export defects or reader findings other than port jogs, the first adding nothing is kept, else the one with the fewest crossings, then findings, then the squarest. The hybrid fixture goes from 4.8:1 to 1.7:1, the AWS one from 2.8:1 to 1.7:1.
- A zone sits in its rank by its members rather than its outline, so a flow through nested zones runs straight past their header strips.
- A step reached back through steps outside its zone, as workers fed by a queue the zone's API publishes to, sits beside the step that leaves; outside units in one rank sit under the members they join, a loop back pulling hardest, so the queue sits under its workers.
- Among zones, no route runs along a node's border.

## Excalidraw

Excalidraw cannot nest frames (it never adds a frame to another frame), so zones are rectangles: square-cornered, styled by kind, locked with their labels, like swimlanes, so nodes move freely across them in the editor. The validator lets lines cross a zone's rectangle, and the zone checks (`zoneRegionIssues`) hold routes to the zones their ends sit in.

Excalidraw has no cylinder, pipe, document or bucket either. Each draws as a transparent rectangle that binds its label and lines, under crisp strokes of its outline (each arc and each straight side a stroke of its own), all in one Excalidraw group, so the shape moves as one. A fill draws as one closed outline under the strokes. Lines end on the drawn outline, in from the box where a curve or a taper is (a bucket's side, a cylinder's lid, a pipe's end, a document's wave), and the validator checks them there. The label's text box stays clear of a cylinder's lid and foot, a pipe's ends, a document's wave and a bucket's tapered sides, so a logo sits below a database's lid.
