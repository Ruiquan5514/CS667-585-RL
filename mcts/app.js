"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const TARGET_SIMULATIONS = 512;
const UCT_C = Math.SQRT2;
const NODE_WIDTH = 70;
const NODE_HEIGHT = 83;
const X_GAP = 22;
const Y_GAP = 42;

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const POSITION_NAMES = [
  "top-left",
  "top-middle",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-middle",
  "bottom-right",
];

const state = {
  board: Array(9).fill(""),
  history: [],
  editTool: "X",
  root: null,
  nodeCounter: 0,
  running: false,
  cancelRun: false,
  simulationHistory: [],
  recommendedAction: null,
  highlight: { path: new Set(), expanded: null },
  transform: { x: 0, y: 0, scale: 1 },
  dragging: null,
  rngState: 20260924,
};

const elements = {
  mainBoard: document.querySelector("#mainBoard"),
  turnBadge: document.querySelector("#turnBadge"),
  statusBox: document.querySelector("#statusBox"),
  opponentSelect: document.querySelector("#opponentSelect"),
  stepButton: document.querySelector("#stepButton"),
  runButton: document.querySelector("#runButton"),
  undoSimulationButton: document.querySelector("#undoSimulationButton"),
  resetSearchButton: document.querySelector("#resetSearchButton"),
  makeMoveButton: document.querySelector("#makeMoveButton"),
  undoButton: document.querySelector("#undoButton"),
  clearButton: document.querySelector("#clearButton"),
  exampleButton: document.querySelector("#exampleButton"),
  simulationCount: document.querySelector("#simulationCount"),
  phaseReadout: document.querySelector("#phaseReadout"),
  rootBars: document.querySelector("#rootBars"),
  treeViewport: document.querySelector("#treeViewport"),
  treeSvg: document.querySelector("#treeSvg"),
  treeTransform: document.querySelector("#treeTransform"),
  edgeLayer: document.querySelector("#edgeLayer"),
  nodeLayer: document.querySelector("#nodeLayer"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  fitButton: document.querySelector("#fitButton"),
  rootButton: document.querySelector("#rootButton"),
};

function random() {
  state.rngState |= 0;
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let value = state.rngState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function legalActions(board) {
  const actions = [];
  for (let index = 0; index < board.length; index += 1) {
    if (!board[index]) actions.push(index);
  }
  return actions;
}

function winner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return null;
}

function terminalResult(board) {
  const victor = winner(board);
  if (victor === "X") return 1;
  if (victor === "O") return -1;
  if (legalActions(board).length === 0) return 0;
  return null;
}

function validateBoard(board) {
  const xCount = board.filter((cell) => cell === "X").length;
  const oCount = board.filter((cell) => cell === "O").length;
  const xWins = WIN_LINES.some(([a, b, c]) => board[a] === "X" && board[b] === "X" && board[c] === "X");
  const oWins = WIN_LINES.some(([a, b, c]) => board[a] === "O" && board[b] === "O" && board[c] === "O");

  if (oCount > xCount || xCount > oCount + 1) {
    return { valid: false, message: "Invalid position: X must have either the same number of marks as O or one more." };
  }
  if (xWins && oWins) return { valid: false, message: "Invalid position: X and O cannot both have winning lines." };
  if (xWins && xCount !== oCount + 1) return { valid: false, message: "Invalid position: an X win must occur immediately after an X move." };
  if (oWins && xCount !== oCount) return { valid: false, message: "Invalid position: an O win must occur immediately after an O move." };
  if (xWins) return { valid: true, terminal: true, turn: null, message: "Game over: X has won." };
  if (oWins) return { valid: true, terminal: true, turn: null, message: "Game over: O has won." };
  if (xCount + oCount === 9) return { valid: true, terminal: true, turn: null, message: "Game over: draw." };

  const turn = xCount === oCount ? "X" : "O";
  if (turn === "O") {
    return {
      valid: true,
      terminal: false,
      turn,
      message: "O is next. Edit the board to an X-turn position before starting MCTS.",
    };
  }
  return { valid: true, terminal: false, turn, message: "Valid position. X can start searching." };
}

function findWinningAction(board, symbol) {
  for (const action of legalActions(board)) {
    const next = board.slice();
    next[action] = symbol;
    if (winner(next) === symbol) return action;
  }
  return null;
}

function opponentAction(board) {
  const legal = legalActions(board);
  if (!legal.length) return null;
  if (elements.opponentSelect.value === "row-major") return legal[0];

  const winning = findWinningAction(board, "O");
  if (winning !== null) return winning;
  const blocking = findWinningAction(board, "X");
  if (blocking !== null) return blocking;
  if (legal.includes(4)) return 4;
  for (const corner of [0, 2, 6, 8]) {
    if (legal.includes(corner)) return corner;
  }
  return legal[0];
}

function transition(board, action) {
  const next = board.slice();
  next[action] = "X";
  if (terminalResult(next) !== null) return { board: next, opponentMove: null };
  const reply = opponentAction(next);
  if (reply !== null) next[reply] = "O";
  return { board: next, opponentMove: reply };
}

function makeNode(board, parent = null, action = null, opponentMove = null) {
  return {
    id: state.nodeCounter++,
    board: board.slice(),
    parent,
    action,
    opponentMove,
    children: [],
    untriedActions: legalActions(board),
    visits: 0,
    valueSum: 0,
    depth: parent ? parent.depth + 1 : 0,
    x: 0,
    y: 0,
  };
}

function meanValue(node) {
  return node.visits ? node.valueSum / node.visits : 0;
}

function uctScore(parent, child) {
  const exploration = UCT_C * Math.sqrt(Math.log(Math.max(1, parent.visits)) / Math.max(1, child.visits));
  return meanValue(child) + exploration;
}

function resetHighlights() {
  state.highlight = { path: new Set(), expanded: null };
}

function resetSearch({ fit = true } = {}) {
  state.cancelRun = true;
  state.running = false;
  state.nodeCounter = 0;
  state.rngState = 20260924;
  state.simulationHistory = [];
  state.recommendedAction = null;
  resetHighlights();
  const validation = validateBoard(state.board);
  state.root = validation.valid && !validation.terminal && validation.turn === "X" ? makeNode(state.board) : null;
  elements.phaseReadout.textContent = "Ready";
  renderAll();
  if (fit) requestAnimationFrame(fitTree);
}

function selectChildByUct(node) {
  let bestScore = -Infinity;
  let candidates = [];

  for (const child of node.children) {
    const score = uctScore(node, child);
    if (score > bestScore + 1e-12) {
      bestScore = score;
      candidates = [child];
    } else if (Math.abs(score - bestScore) <= 1e-12) {
      candidates.push(child);
    }
  }
  return candidates[Math.floor(random() * candidates.length)];
}

function rollout(startBoard) {
  let board = startBoard.slice();
  const trace = [];
  let result = terminalResult(board);

  while (result === null) {
    const actions = legalActions(board);
    const action = actions[Math.floor(random() * actions.length)];
    const step = transition(board, action);
    board = step.board;
    trace.push({ action, opponentMove: step.opponentMove, board: board.slice() });
    result = terminalResult(board);
  }
  return { result, trace };
}

function prepareSimulation() {
  if (!state.root) return null;
  let node = state.root;
  const path = [node];
  const selections = [];
  let expanded = null;
  let expansionUndo = null;

  while (terminalResult(node.board) === null) {
    if (node.untriedActions.length) {
      const choiceIndex = Math.floor(random() * node.untriedActions.length);
      const action = node.untriedActions.splice(choiceIndex, 1)[0];
      const next = transition(node.board, action);
      expanded = makeNode(next.board, node, action, next.opponentMove);
      node.children.push(expanded);
      expansionUndo = { parent: node, node: expanded, action, choiceIndex };
      node = expanded;
      path.push(node);
      break;
    }
    if (!node.children.length) break;
    const selected = selectChildByUct(node);
    selections.push({
      parentId: node.id,
      childId: selected.id,
      action: selected.action,
      visitsBefore: selected.visits,
      qBefore: meanValue(selected),
      ucbBefore: uctScore(node, selected),
    });
    node = selected;
    path.push(node);
  }

  const immediateResult = terminalResult(node.board);
  const evaluation = immediateResult === null ? rollout(node.board) : { result: immediateResult, trace: [] };
  return { path, selections, expanded, expansionUndo, evaluation, leaf: node };
}

function backupSimulation(simulation) {
  for (const node of simulation.path) {
    node.visits += 1;
    node.valueSum += simulation.evaluation.result;
  }
  updateRecommendedAction();
}

function recordAndRunSimulation() {
  const record = {
    rngBefore: state.rngState,
    nodeCounterBefore: state.nodeCounter,
    simulation: null,
  };
  const simulation = prepareSimulation();
  if (!simulation) return null;
  record.simulation = simulation;
  backupSimulation(simulation);
  state.simulationHistory.push(record);
  return simulation;
}

function simulationReadout(simulation) {
  const rootSelection = simulation.selections[0];
  if (rootSelection) {
    const selectedNode = simulation.path.find((node) => node.id === rootSelection.childId);
    return (
      `Selected at N=${rootSelection.visitsBefore}, Q=${rootSelection.qBefore.toFixed(2)}, ` +
      `UCB=${rootSelection.ucbBefore.toFixed(2)} → return ${formatReturn(simulation.evaluation.result)} ` +
      `→ now N=${selectedNode.visits}, Q=${meanValue(selectedNode).toFixed(2)}`
    );
  }
  if (simulation.expanded) {
    return `Expanded unvisited ${POSITION_NAMES[simulation.expanded.action]} → return ${formatReturn(simulation.evaluation.result)}`;
  }
  return `Last return: ${formatReturn(simulation.evaluation.result)}`;
}

function stepSimulation() {
  if (state.running || !state.root || state.root.visits >= TARGET_SIMULATIONS) return;
  state.running = true;
  const simulation = recordAndRunSimulation();
  if (!simulation) {
    state.running = false;
    updateControls();
    return;
  }

  resetHighlights();
  state.highlight.path = new Set(simulation.path.map((node) => node.id));
  state.highlight.expanded = simulation.expanded?.id ?? null;
  elements.phaseReadout.textContent = simulationReadout(simulation);
  state.running = false;
  renderAll();
}

function undoSimulation() {
  if (state.running || !state.root || !state.simulationHistory.length) return;
  const record = state.simulationHistory.pop();
  const { simulation } = record;

  for (const node of simulation.path) {
    node.visits -= 1;
    node.valueSum -= simulation.evaluation.result;
  }

  if (simulation.expansionUndo) {
    const { parent, node, action, choiceIndex } = simulation.expansionUndo;
    const childIndex = parent.children.indexOf(node);
    if (childIndex >= 0) parent.children.splice(childIndex, 1);
    parent.untriedActions.splice(choiceIndex, 0, action);
  }

  state.rngState = record.rngBefore;
  state.nodeCounter = record.nodeCounterBefore;
  updateRecommendedAction();
  resetHighlights();

  const previous = state.simulationHistory.at(-1)?.simulation;
  if (previous) {
    state.highlight.path = new Set(previous.path.map((node) => node.id));
    state.highlight.expanded = previous.expanded?.id ?? null;
  }
  elements.phaseReadout.textContent = `Reverted to ${state.root.visits} simulations`;
  renderAll();
  requestAnimationFrame(fitTree);
}

async function runToTarget() {
  if (state.running || !state.root || state.root.visits >= TARGET_SIMULATIONS) return;
  state.running = true;
  state.cancelRun = false;
  elements.phaseReadout.textContent = "Computing 512 simulations";
  updateControls();

  // Yield once so the pressed-button state and readout are painted, then run
  // the remaining simulations without animating intermediate trees.
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  while (state.root && state.root.visits < TARGET_SIMULATIONS && !state.cancelRun) {
    const simulation = recordAndRunSimulation();
    if (!simulation) break;
  }

  state.running = false;
  resetHighlights();
  elements.phaseReadout.textContent = state.root?.visits >= TARGET_SIMULATIONS ? "Search complete" : "Ready";
  renderAll();
  requestAnimationFrame(fitTree);
}

function updateRecommendedAction() {
  if (!state.root || !state.root.children.length) {
    state.recommendedAction = null;
    return;
  }
  const sorted = state.root.children.slice().sort((a, b) => {
    if (b.visits !== a.visits) return b.visits - a.visits;
    if (meanValue(b) !== meanValue(a)) return meanValue(b) - meanValue(a);
    return a.action - b.action;
  });
  state.recommendedAction = sorted[0].action;
}

function formatReturn(value) {
  if (value > 0) return "+1 (X wins)";
  if (value < 0) return "−1 (O wins)";
  return "0 (draw)";
}

function applyRecommendedMove() {
  if (state.recommendedAction === null || !state.root) return;
  const next = transition(state.board, state.recommendedAction);
  state.history.push(state.board.slice());
  state.board = next.board;
  resetSearch();
}

function renderBoard() {
  elements.mainBoard.replaceChildren();
  state.board.forEach((mark, index) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `board-cell ${mark ? mark.toLowerCase() : ""}`;
    if (!mark && index === state.recommendedAction) cell.classList.add("recommended");
    cell.textContent = mark;
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", `${POSITION_NAMES[index]}: ${mark || "empty"}`);
    cell.addEventListener("click", () => editCell(index));
    elements.mainBoard.append(cell);
  });
}

function editCell(index) {
  if (state.running) return;
  const next = state.board.slice();
  next[index] = state.editTool;
  state.history.push(state.board.slice());
  state.board = next;
  resetSearch();
}

function updateStatus() {
  const validation = validateBoard(state.board);
  elements.statusBox.className = "status-box";
  elements.statusBox.textContent = validation.message;
  if (!validation.valid) elements.statusBox.classList.add("error");
  else if (validation.terminal) elements.statusBox.classList.add("success");

  elements.turnBadge.textContent = validation.turn ? `${validation.turn} to move` : "Game over";
  if (state.root?.visits) {
    const best = state.root.children.find((child) => child.action === state.recommendedAction);
    if (best) {
      elements.statusBox.className = "status-box success";
      elements.statusBox.textContent = `Current recommendation: ${POSITION_NAMES[best.action]}, N=${best.visits}, Q=${meanValue(best).toFixed(2)}.`;
    }
  }
}

function updateControls() {
  const validation = validateBoard(state.board);
  const searchable = validation.valid && !validation.terminal && validation.turn === "X" && Boolean(state.root);
  const complete = state.root?.visits >= TARGET_SIMULATIONS;
  elements.stepButton.disabled = state.running || !searchable || complete;
  elements.runButton.disabled = state.running || !searchable || complete;
  elements.undoSimulationButton.disabled = state.running || state.simulationHistory.length === 0;
  elements.makeMoveButton.disabled = state.running || state.recommendedAction === null;
  elements.undoButton.disabled = state.running || state.history.length === 0;
  elements.clearButton.disabled = state.running;
  elements.exampleButton.disabled = state.running;
  elements.opponentSelect.disabled = state.running;
  elements.simulationCount.textContent = `${state.root?.visits ?? 0} / ${TARGET_SIMULATIONS} simulations`;
}

function layoutTree() {
  if (!state.root) return [];
  let nextLeaf = 0;
  const nodes = [];

  function visit(node) {
    nodes.push(node);
    node.y = node.depth * (NODE_HEIGHT + Y_GAP);
    if (!node.children.length) {
      node.x = nextLeaf * (NODE_WIDTH + X_GAP);
      nextLeaf += 1;
      return node.x;
    }
    const childXs = node.children.map(visit);
    node.x = childXs.reduce((sum, x) => sum + x, 0) / childXs.length;
    return node.x;
  }

  visit(state.root);
  const rootOffset = state.root.x;
  for (const node of nodes) node.x -= rootOffset;
  return nodes;
}

function renderTree() {
  elements.edgeLayer.replaceChildren();
  elements.nodeLayer.replaceChildren();
  if (!state.root) return;
  const nodes = layoutTree();

  for (const node of nodes) {
    if (!node.parent) continue;
    const x1 = node.parent.x;
    const y1 = node.parent.y + NODE_HEIGHT / 2;
    const x2 = node.x;
    const y2 = node.y - NODE_HEIGHT / 2;
    const middleY = (y1 + y2) / 2;
    const path = createSvgElement("path", {
      d: `M ${x1} ${y1} C ${x1} ${middleY}, ${x2} ${middleY}, ${x2} ${y2}`,
      class: `tree-edge ${state.highlight.path.has(node.id) ? "selected" : ""}`,
    });
    elements.edgeLayer.append(path);
  }

  for (const node of nodes) {
    const classes = ["tree-node"];
    if (node === state.root) classes.push("root");
    if (state.highlight.path.has(node.id)) classes.push("path");
    if (state.highlight.expanded === node.id) classes.push("expanded");

    const group = createSvgElement("g", {
      class: classes.join(" "),
      transform: `translate(${node.x - NODE_WIDTH / 2}, ${node.y - NODE_HEIGHT / 2})`,
      "data-board": node.board.map((cell) => cell || "-").join(""),
      "data-terminal-result": terminalResult(node.board) ?? "nonterminal",
      "data-mean-return": meanValue(node).toFixed(6),
      tabindex: "0",
      role: "button",
      "aria-label": `Tree node. Visits ${node.visits}. Mean return ${meanValue(node).toFixed(2)}.`,
    });
    group.append(createSvgElement("rect", { class: "node-card", width: NODE_WIDTH, height: NODE_HEIGHT }));

    const boardLeft = 13;
    const boardTop = 7;
    const cellSize = 14.5;
    node.board.forEach((mark, index) => {
      const row = Math.floor(index / 3);
      const column = index % 3;
      const cellClass = ["mini-cell", "mini-detail"];
      if (node.action === index) cellClass.push("agent-move");
      if (node.opponentMove === index) cellClass.push("opponent-move");
      group.append(
        createSvgElement("rect", {
          class: cellClass.join(" "),
          x: boardLeft + column * cellSize,
          y: boardTop + row * cellSize,
          width: cellSize,
          height: cellSize,
          fill: "#ffffff",
        }),
      );
      if (mark) {
        const text = createSvgElement("text", {
          class: `mini-mark mini-detail ${mark.toLowerCase()}`,
          x: boardLeft + column * cellSize + cellSize / 2,
          y: boardTop + row * cellSize + cellSize / 2 + 0.5,
        });
        text.textContent = mark;
        group.append(text);
      }
    });

    for (let line = 1; line <= 2; line += 1) {
      group.append(
        createSvgElement("line", {
          class: "mini-grid mini-detail",
          x1: boardLeft + line * cellSize,
          y1: boardTop,
          x2: boardLeft + line * cellSize,
          y2: boardTop + 3 * cellSize,
        }),
      );
      group.append(
        createSvgElement("line", {
          class: "mini-grid mini-detail",
          x1: boardLeft,
          y1: boardTop + line * cellSize,
          x2: boardLeft + 3 * cellSize,
          y2: boardTop + line * cellSize,
        }),
      );
    }

    const result = terminalResult(node.board);
    const stats = createSvgElement("text", {
      class: "node-stat",
      x: NODE_WIDTH / 2,
      y: result === null ? 69 : 63,
    });
    stats.textContent = `N=${node.visits}  Q=${meanValue(node).toFixed(2)}`;
    group.append(stats);
    if (result !== null) {
      const resultClass = result > 0 ? "win" : result < 0 ? "loss" : "draw";
      group.append(
        createSvgElement("rect", {
          class: `terminal-badge ${resultClass}`,
          x: 8,
          y: 68,
          width: NODE_WIDTH - 16,
          height: 10,
          rx: 5,
        }),
      );
      const terminalLabel = createSvgElement("text", {
        class: "terminal-label mini-detail",
        x: NODE_WIDTH / 2,
        y: 75.5,
      });
      terminalLabel.textContent = `TERMINAL ${result > 0 ? "+1" : result < 0 ? "−1" : "0"}`;
      group.append(terminalLabel);
    }
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      focusNode(node);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") focusNode(node);
    });
    elements.nodeLayer.append(group);
  }

  applyTransform();
}

function renderRootBars() {
  elements.rootBars.replaceChildren();
  if (!state.root?.children.length) {
    const empty = document.createElement("p");
    empty.className = "small-note";
    empty.textContent = "Run simulations to compare the legal actions at the root.";
    elements.rootBars.append(empty);
    return;
  }

  const children = state.root.children.slice().sort((a, b) => a.action - b.action);
  const maxVisits = Math.max(...children.map((child) => child.visits), 1);
  for (const child of children) {
    const item = document.createElement("div");
    item.className = `action-bar ${child.action === state.recommendedAction ? "best" : ""}`;
    const label = document.createElement("div");
    label.className = "bar-label";
    label.innerHTML = `<span>${POSITION_NAMES[child.action]}</span><span>N=${child.visits} · Q=${meanValue(child).toFixed(2)}</span>`;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${(child.visits / maxVisits) * 100}%`;
    track.append(fill);
    item.append(label, track);
    elements.rootBars.append(item);
  }
}

function renderAll() {
  renderBoard();
  updateStatus();
  updateControls();
  renderTree();
  renderRootBars();
}

function applyTransform() {
  const { x, y, scale } = state.transform;
  elements.treeTransform.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
  elements.treeSvg.classList.toggle("far-zoom", scale < 0.28);
}

function setScale(nextScale, centerX, centerY) {
  const previous = state.transform.scale;
  const scale = Math.min(2.6, Math.max(0.04, nextScale));
  const worldX = (centerX - state.transform.x) / previous;
  const worldY = (centerY - state.transform.y) / previous;
  state.transform.scale = scale;
  state.transform.x = centerX - worldX * scale;
  state.transform.y = centerY - worldY * scale;
  applyTransform();
}

function zoomBy(factor) {
  const rect = elements.treeViewport.getBoundingClientRect();
  setScale(state.transform.scale * factor, rect.width / 2, rect.height / 2);
}

function fitTree() {
  if (!state.root || !elements.nodeLayer.childNodes.length) return;
  const viewportRect = elements.treeViewport.getBoundingClientRect();
  const content = elements.treeTransform.getBBox();
  if (!content.width || !content.height || !viewportRect.width || !viewportRect.height) return;
  const padding = 42;
  const scale = Math.min(
    1.25,
    (viewportRect.width - padding * 2) / content.width,
    (viewportRect.height - padding * 2) / content.height,
  );
  state.transform.scale = Math.max(0.04, scale);
  state.transform.x = viewportRect.width / 2 - (content.x + content.width / 2) * state.transform.scale;
  state.transform.y = padding - content.y * state.transform.scale;
  applyTransform();
}

function focusNode(node) {
  const rect = elements.treeViewport.getBoundingClientRect();
  const scale = Math.max(0.7, Math.min(1.5, state.transform.scale));
  state.transform.scale = scale;
  state.transform.x = rect.width / 2 - node.x * scale;
  state.transform.y = rect.height / 2 - node.y * scale;
  applyTransform();
}

function setEditTool(tool) {
  state.editTool = tool;
  document.querySelectorAll(".tool-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
}

document.querySelectorAll(".tool-button").forEach((button) => {
  button.addEventListener("click", () => setEditTool(button.dataset.tool));
});

elements.stepButton.addEventListener("click", stepSimulation);
elements.runButton.addEventListener("click", runToTarget);
elements.undoSimulationButton.addEventListener("click", undoSimulation);
elements.resetSearchButton.addEventListener("click", () => resetSearch());
elements.makeMoveButton.addEventListener("click", applyRecommendedMove);
elements.opponentSelect.addEventListener("change", () => resetSearch());
elements.clearButton.addEventListener("click", () => {
  state.history.push(state.board.slice());
  state.board = Array(9).fill("");
  resetSearch();
});
elements.exampleButton.addEventListener("click", () => {
  state.history.push(state.board.slice());
  state.board = ["X", "O", "X", "", "O", "", "", "", ""];
  resetSearch();
});
elements.undoButton.addEventListener("click", () => {
  if (!state.history.length) return;
  state.board = state.history.pop();
  resetSearch();
});
elements.zoomInButton.addEventListener("click", () => zoomBy(1.25));
elements.zoomOutButton.addEventListener("click", () => zoomBy(0.8));
elements.fitButton.addEventListener("click", fitTree);
elements.rootButton.addEventListener("click", () => state.root && focusNode(state.root));

elements.treeViewport.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const rect = elements.treeViewport.getBoundingClientRect();
    setScale(
      state.transform.scale * Math.exp(-event.deltaY * 0.0015),
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  },
  { passive: false },
);

elements.treeViewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  elements.treeViewport.setPointerCapture(event.pointerId);
  state.dragging = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    transformX: state.transform.x,
    transformY: state.transform.y,
  };
});

elements.treeViewport.addEventListener("pointermove", (event) => {
  if (!state.dragging || state.dragging.pointerId !== event.pointerId) return;
  state.transform.x = state.dragging.transformX + event.clientX - state.dragging.startX;
  state.transform.y = state.dragging.transformY + event.clientY - state.dragging.startY;
  applyTransform();
});

function finishDrag(event) {
  if (state.dragging?.pointerId === event.pointerId) state.dragging = null;
}

elements.treeViewport.addEventListener("pointerup", finishDrag);
elements.treeViewport.addEventListener("pointercancel", finishDrag);
window.addEventListener("resize", () => requestAnimationFrame(fitTree));

resetSearch();

// Small, hidden test/demo hooks for deterministic browser checks.
const query = new URLSearchParams(window.location.search);
const encodedBoard = query.get("board");
if (encodedBoard && /^[XO-]{9}$/.test(encodedBoard)) {
  state.board = [...encodedBoard].map((cell) => (cell === "-" ? "" : cell));
  resetSearch();
}
if (query.get("autorun") === "1") {
  window.setTimeout(() => elements.runButton.click(), 80);
} else if (query.get("autostep") === "1") {
  window.setTimeout(() => elements.stepButton.click(), 80);
} else if (Number(query.get("autosteps")) > 0) {
  const count = Math.min(TARGET_SIMULATIONS, Number(query.get("autosteps")));
  window.setTimeout(() => {
    for (let index = 0; index < count; index += 1) elements.stepButton.click();
    if (query.get("autoundo") === "1") elements.undoSimulationButton.click();
    requestAnimationFrame(fitTree);
  }, 80);
}
