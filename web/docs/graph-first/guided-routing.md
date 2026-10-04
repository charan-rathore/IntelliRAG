# Guided (A*) point-to-point routing

Adds `graphify/astar.ts`: a goal-directed best-first search between two learned chunk nodes, next to the existing multi-source Dijkstra. Not wired into query retrieval.

## Where it fits, and where it does not

Retrieval today starts from query roots and spreads outward under a cost budget. There is no single target node, so a goal-directed search has nothing to aim at there; plain Dijkstra is the right tool and stays. A* fits when both ends are known: tracing how two chunks connect (for example the best match for each side of a comparison or multi-hop question). That is a future use; this change only provides and measures the search.

## Heuristic

Edge cost is 1 - cos, which is not a metric, so 1 - cos(node, goal) can overestimate and give a worse route. The heuristic here is a provable lower bound: the angle to the goal shrinks by at most one edge angle per hop, cost is convex in hop angle, and each hop costs at least the cheapest edge. Falls back to zero (plain Dijkstra) if edges include non-positive similarity. Nodes can reopen, so routes stay optimal.

## Results (synthetic graphs, same edge rule as learnVectors, `npx tsx scripts/benchmark-guided-routing.ts`)

A* returned the same cost as Dijkstra on every route (0 mismatches). It expanded 10-22% fewer nodes. It was not faster in wall-clock: the heuristic costs a cosine per node, which outweighs the saving on graphs this small (max 256 resident nodes in production). The large speedups seen in map demos come from strong coordinate heuristics; semantic graphs give a weak one. Synthetic data only, no real-provider run.
