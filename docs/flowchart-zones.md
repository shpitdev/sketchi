# Architecture zones and infrastructure shapes

Zones are flowchart groups that nest and say what they stand for: a cloud or an on-prem data center, a region, an availability or network zone, a VPC and its subnets, a cluster and its namespaces. Infrastructure shapes draw a node as a database cylinder, a queue, a document or a storage bucket. Together they draw the architecture diagrams developers ask for most, such as an AWS three-tier app, inside the flowchart family.

```json
{"type":"flowchart","spec":{"title":"AWS three-tier app","direction":"LR","logos":true,"nodes":{"users":"Users","alb":"Application Load Balancer","api":"ECS API service","rds":{"label":"RDS PostgreSQL","shape":"database"},"s3":{"label":"S3 assets bucket","shape":"storage"}},"edges":[["users","alb"],["alb","api"],["api","rds"],["api","s3"]],"groups":{"region":{"label":"us-east-1","kind":"region","contains":["vpc","s3"]},"vpc":{"label":"VPC 10.0.0.0/16","kind":"vpc","contains":["public","private","data"]},"public":{"label":"Public subnet","kind":"subnet","contains":["alb"]},"private":{"label":"Private subnet","kind":"subnet","contains":["api"]},"data":{"label":"Database subnet","kind":"subnet","contains":["rds"]}}}}
```

Pass this to `sketchi create --json`, or its `spec` to `sketchi.buildFlowchart`. Studio's `build_flowchart` and `POST /api/v1/flowcharts/build` take the same spec, and generation nests zones and sets shapes when a prompt describes an architecture. The docs tell models to give infrastructure nodes their shape, entries and ends included: `database` for databases, `document` for files, archives and reports, `queue` for queues, streams and topics, `storage` for buckets and object stores.

With `logos`, each node whose label names a product draws its logo: `exact` when the label names that product ("PostgreSQL"), and a vendor's logo only on a label that names the vendor ("Cloudflare Workers" takes `cloudflare`, "Ingress controller" no `kubernetes`). A node's `icon` names a logo its label does not, and builds drop a vendor's or platform's logo on a node whose label does not name it with an `icon_dropped` warning. A product's own logo is never questioned.

## Contract

Additive to [flowchart groups](./flowchart-groups.md):

- A group's `contains` may list other groups. Nesting is read from those lists, never out of ids or labels; a group may list members at any depth, so a region can list the bucket beside its VPC and the VPC its subnets, and Sketchi derives the tree. A group no other group lists sits inside the smallest group holding all its nodes.
- `groups[].kind` is one of `cloud`, `datacenter`, `region`, `zone`, `vpc`, `subnet`, `cluster` or `namespace`. It says what a zone stands for and sets how it draws. It is a closed set so a model picks a drawn treatment, not free text.
- `nodes[id].shape` is one of `database`, `queue`, `document` or `storage`. A node's role (entry, step, decision, end) comes from its edges whatever its shape, so a database a request ends at needs no more than its shape.
- A node sits in the innermost group that lists it, directly or through the groups nested in it.
- Zones nest at most 4 deep (a cloud, a region, a VPC and a subnet), and a flowchart keeps at most 8 groups.

Builds reject a group that lists an id that is no node or group (`unknown_member`, with the nearest declared ids in its hint), groups that list each other in a cycle (`group_cycle`), two groups that share a member without one holding the other (`overlapping_containers`), and zones nested deeper than 4 (`flowchart_too_large`).

## Drawing

A diagram whose groups nest or declare a `kind` draws them as zones. A flowchart whose groups do neither draws frames exactly as before.

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
- A zoned flow too long for its breadth (2.45:1 for a row at least 1,200 px long or for any column, 4:1 always) wraps as a plain flowchart wraps into rows or columns, never by turning a zone across the flow. Level by level, the top level or one zone's members cut between whole ranks into bands, each read in the stated direction, columns keeping the plain rule's even-split guard. A band hangs under the step that leads into it, as far as the longest band allows, and lines into it turn in from that side. Of the plans that route with no more crossings, export defects or reader findings other than port jogs, the first adding nothing is kept, else the one with the fewest crossings, then findings, then the squarest. The hybrid fixture goes from 4.8:1 to 1.5:1, the AWS one from 2.8:1 to 1.7:1.
- In a row, of the plans no longer too long (under 2.45:1), the one that hangs the fewest top-level zones under another goes first, before a plan that reaches the 2:1 target by hanging more. A top-level cut hangs the later zone under the earlier, though the flow passes from one to the next along the row, and the line between them runs down and back against it. The plan it passes stays the first alternative, so a plan that routes worse still gives way to it. A column's cut stands the later zone beside the earlier, across a wide export, and columns plan as before. Two of three Sol samples of `hybrid-cloud-zones-v2`, asked for left to right, hung the AWS cloud under the data center (the top level reached the target in two bands, the region in three); the cloud now stands beside it. A Sol sample of `three-zone-request-path-v2` stacked all three zones, since two bands missed the target (2.3:1) and three reached it; the DMZ now stands beside the public internet, the private subnet under it.
- A zoned cut may carry a forward line that skips ranks, as a cached page's line straight to a response past the private subnet, so long as that line crosses no other cut. The skipping line may cross another, so the cuts that carry none are planned too, where they differ, and a plan whose cut carries one gives way to a later plan, adding nothing to the layout it replaces, that crosses fewer lines or draws fewer reader findings. Eight of ten Sonnet samples of `three-zone-request-path-v2` hung the DMZ under the public internet, the only cut that carried no skipping line; seven now keep it beside the public internet, and the eighth, whose skipping line would cross the WAF's, keeps its plan. The four-deep stress fixture's second availability zone now hangs under the first: 1.9:1 instead of a 4.1:1 row.
- A plan whose plain routes cross more than the layout it replaces is routed again, each line across as few others as it can, before it is judged, so a crossing the plain router happens to draw does not alone stack sibling zones that read side by side along the flow.
- A plan that keeps the top level in one band and still crosses one line pair more is judged as the crossing repairs leave it, as the kept plan is drawn, where those leave it crossing, detouring, hooking, running through arrowheads and passing near nodes no more than the layout it replaces, each cleared of the nodes it passes, and no line in it runs more than twice its direct connection past its stubs. Such a plan only keeps sibling zones side by side: it replaces the chosen plan only where that one stacks them and it crosses and finds no more, and it never stacks zones itself. A Sol hybrid sample whose region, wrapped beside the data center, crossed the sync function's lines to the orders table and the invoice PDF once now draws beside it, the table's line entering the table from the side that faces the sync function.
- A line into a hanging band whose target stands behind another step of its rank, straight across the flow from the source, leaves forward and turns back into the target's forward side, around that step, instead of hooking around the band's margin to reach its near side. This is kept when it routes no worse, hooks or detours no line more, and draws the lines shorter in total. In a round 19 hybrid sample, the line to the orders table drops straight down and the line to the invoice archive brackets around it: four turns fewer and a tenth less line.
- A zone sits in its rank by its members rather than its outline, so a flow through nested zones runs straight past their header strips.
- A step reached back through steps outside its zone, as workers fed by a queue the zone's API publishes to, sits beside the step that leaves; outside units in one rank sit under the members they join, a loop back pulling hardest, so the queue sits under its workers.
- Among zones, no route runs along a node's border.
- Among zones, a line also keeps the reader's corridor gap (24 px at a 2,000 px fit) from a node it runs alongside but neither leaves nor enters, past a corner's length: the last clearing pass, after every other choice, moves such a run out to the gap where the move brings the line within that clearance of no node and draws nothing worse. A zone whose outline leaves no lane there grows, once every other choice is made, where that routes no worse. Sol and Sonnet hybrid samples ran the ERP's line to the VPN gateway 13 units under the Oracle database's foot, between it and the data center's outline; the data center now grows and the line runs 27 units clear.

## Excalidraw

Excalidraw cannot nest frames (it never adds a frame to another frame), so zones are rectangles: square-cornered, styled by kind, locked with their labels, like swimlanes, so nodes move freely across them in the editor. The validator lets lines cross a zone's rectangle, and the zone checks (`zoneRegionIssues`) hold routes to the zones their ends sit in.

Excalidraw has no cylinder, pipe, document or bucket either. Each draws as a transparent rectangle that binds its label and lines, under crisp strokes of its outline (each arc and each straight side a stroke of its own), all in one Excalidraw group, so the shape moves as one. A fill draws as one closed outline under the strokes. Lines end on the drawn outline, in from the box where a curve or a taper is (a bucket's side, a cylinder's lid, a pipe's end, a document's wave), and the validator checks them there. The label's text box stays clear of a cylinder's lid and foot, a pipe's ends, a document's wave and a bucket's tapered sides, so a logo sits below a database's lid.

## Scenarios

Maintained scenarios: `aws-three-tier-zones-v2` (a region > VPC > public, private and database subnets, with a bucket in the region), `kubernetes-cluster-zones-v2` (a cluster > three namespaces, with a database and a queue outside the cluster) and `hybrid-cloud-zones-v2` (an on-prem data center joined by a VPN to a cloud > region > VPC > subnet). Their `--input` checks require each stated zone under a prompt-grounded label holding every step the prompt puts in it, directly or in a zone nested in it (`group-members:*`); inside the zone the prompt puts it in, at any depth, so an extra zone between them is fine (`zone-parent:*`); of a kind that reads as what the prompt calls it (`zone-kind:*`); and each stated database, queue, document or bucket drawn as one (`shape:*`); the hybrid invoice archive, PDF documents kept in a cloud region, may draw as a document or a bucket. Steps the prompt keeps outside every zone must be ungrouped. A logo for a product the prompt names by an abbreviation the catalog does not list (GKE, EKS, AKS, RDS, GCS) counts as grounded.
