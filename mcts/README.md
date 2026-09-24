# Interactive MCTS illustration

This browser-only demo shows UCT planning against a fixed tic-tac-toe opponent.

- Edit the real position on the left.
- Use **Run one simulation** to complete one full selection-expansion-evaluation-backup cycle immediately.
- Use **Complete 512 simulations** to compute and display the final tree in one shot.
- Use **Undo simulation** to reverse the latest simulation, including its statistics,
  expansion, and random-number state.
- Pan and zoom the SVG tree; no nodes are folded away.
- Choose either a deterministic row-major opponent or a stronger tactical opponent.

The MCTS agent is X. A searchable position must therefore be a legal, nonterminal
position with X to move. Each stored tree edge combines an X move with the fixed O
response. A random X rollout policy evaluates newly expanded nodes.

## Run locally

From the parent GitHub Pages repository directory:

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765/mcts/>. Serving the parent directory also loads
the shared site navigation correctly.

No packages or build step are required.
