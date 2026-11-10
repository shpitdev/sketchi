# Flowchart crossings

A crossing is avoidable when the flowchart's graph could be drawn without it.
`unavoidableCrossings` (diagram-core) reads that bound from planarity: a planar
graph forces none, and each block that is not planar forces at least one, and
at least as many as its edges beyond what a plane graph of its nodes holds. Scenarios
that set `crossingFree` fail a drawing of a planar graph whose lines cross,
counted at any angle (`lineCrossings`); for a graph that is not planar the
bound is only a lower one, so its drawing is not failed (`avoidable-crossings`).

## Layout

The layered layout orders each rank by barycenters and adjacent swaps, then
repairs remaining crossings by moving ends to other sides. Where the drawing,
polished to the end, still crosses more lines than its graph forces, it is
laid out again in up to three ways, each repaired and drawn to the end the
same way (not in swimlanes, which place each step by its lane):

- **Nested ports** (`nestAround`): lines that leave a side and run around into
  the same side of a node beyond it take ports in order of how far they reach,
  so the farthest runs outermost and turns past no other line.
- **Skip lanes** (`skipLanes`, flows without groups or lanes): every line that
  skips ranks, returns included, keeps a lane in each rank it passes. The
  layered order is sifted (each node and lane moved to the place in its rank
  that crosses fewest lines, each skipping line moved whole to either end of
  its ranks), nodes sit toward the nodes they link to, and a forward line's
  lane stays in line with the node it leaves. The line runs in its lane
  wherever that draws as cleanly as any other route. Tried only where the
  sifted order crosses fewer lines than the drawing.
- **Through blocks** (`throughBlocks`, zoned flows): a node outside the zones
  that a zone's members reach from another outside node ranks after it, as a
  database the workers write to after the queue that feeds them, and the line
  from that node back into the zone runs straight back between the sides that
  face each other.

A rival is kept where it crosses fewer lines, a crossing removed outweighing
one reader finding added, and draws no worse otherwise: no more export
defects, lines through a head, hooks, detours, dips, touching or shared lines,
labels touching anything, and no extreme aspect. It may run longer only up to
15%, or within a 2,000 px screen, where its text shrinks no more, and a label
may lose up to 8 px of room for each crossing removed.

The crossing repair also lets a decision's loop trade vertices with the
decision's other branches, and a loop run straight back between the sides its
ends face, after every other move.

## Measured

Over 5,449 distinct flowcharts generated in graded tuning runs, laid out by
main and by this layout:

| | main | now |
| --- | ---: | ---: |
| crossings | 595 | 347 |
| flowcharts that cross | 418 | 179 |
| crossings beyond the graph's bound | 512 | 264 |
| reader findings | 244 | 239 |

Eleven flowcharts trade a crossing for a reader finding; none draws worse
otherwise. Layout time is unchanged for flowcharts that draw no crossing; one
that still crosses after the repairs takes about 30 ms more at the median.
