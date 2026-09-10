"use strict";

const ALGORITHMS = {
  reinforce: {
    url: "reinforce-web-data.json.gz",
    color: "#6e4bd8",
    shortName: "REINFORCE + baseline",
  },
  actor_critic: {
    url: "actor_critic-web-data.json.gz",
    color: "#0d408f",
    shortName: "One-step actor–critic",
  },
};

const COLORS = {
  ink: "#121a27",
  muted: "#566274",
  border: "#c9d2df",
  grid: "#e3e8ef",
  blue: "#0d408f",
  orange: "#b84d00",
  green: "#167b4b",
  red: "#b52831",
  wall: "#aeb8c5",
  low: [217, 232, 252],
  high: [255, 196, 64],
};

const elements = {
  algorithmPicker: document.querySelector("#algorithm-picker"),
  speedSelect: document.querySelector("#speed-select"),
  restartButton: document.querySelector("#restart-button"),
  rewindButton: document.querySelector("#rewind-button"),
  playButton: document.querySelector("#play-button"),
  timelineRange: document.querySelector("#timeline-range"),
  timelineOutput: document.querySelector("#timeline-output"),
  loadStatus: document.querySelector("#load-status"),
  playbackStatus: document.querySelector("#playback-status"),
  episodesOutput: document.querySelector("#episodes-output"),
  seedOutput: document.querySelector("#seed-output"),
  gammaOutput: document.querySelector("#gamma-output"),
  episodeBadge: document.querySelector("#episode-badge"),
  teachingNote: document.querySelector("#teaching-note"),
  performanceCanvas: document.querySelector("#performance-canvas"),
  views: {
    reinforce: {
      root: document.querySelector("#reinforce-view"),
      stepBadge: document.querySelector("#reinforce-step-badge"),
      environmentCanvas: document.querySelector("#reinforce-environment-canvas"),
    },
    actor_critic: {
      root: document.querySelector("#actor-critic-view"),
      stepBadge: document.querySelector("#actor-critic-step-badge"),
      environmentCanvas: document.querySelector("#actor-critic-environment-canvas"),
    },
  },
};

const app = {
  datasets: {},
  selectedAlgorithms: new Set(["reinforce", "actor_critic"]),
  timeline: [],
  playhead: 0,
  timer: null,
  performanceCacheKey: "",
};

function selectedKeys() {
  return Object.keys(ALGORITHMS).filter((key) => app.selectedAlgorithms.has(key));
}

function dataFor(key) {
  return app.datasets[key];
}

function position() {
  return app.timeline[app.playhead];
}

function snapshotFor(key) {
  return dataFor(key).snapshots[position().episodeIndex];
}

function frameFor(key) {
  return Math.min(position().step, snapshotFor(key).path.length - 1);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function buildTimeline(preferredEpisode = 0, preferredStep = 0) {
  const keys = selectedKeys();
  const episodeCount = dataFor(keys[0]).snapshots.length;
  app.timeline = [];
  for (let episodeIndex = 0; episodeIndex < episodeCount; episodeIndex += 1) {
    const length = Math.max(...keys.map(
      (key) => dataFor(key).snapshots[episodeIndex].path.length
    ));
    for (let step = 0; step < length; step += 1) {
      app.timeline.push({ episodeIndex, step, length });
    }
  }
  const index = app.timeline.findIndex((item) =>
    item.episodeIndex === preferredEpisode &&
    item.step === Math.min(preferredStep, item.length - 1)
  );
  app.playhead = index >= 0 ? index : 0;
  elements.timelineRange.max = String(app.timeline.length - 1);
  app.performanceCacheKey = "";
}

function mixColor(low, high, amount) {
  const t = clamp(amount, 0, 1);
  const channels = low.map((channel, index) =>
    Math.round(channel * (1 - t) + high[index] * t)
  );
  return `rgb(${channels.join(",")})`;
}

function cellKey(cell) {
  return `${cell[0]},${cell[1]}`;
}

function sameCell(first, second) {
  return first[0] === second[0] && first[1] === second[1];
}

function prepareCanvas(canvas) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineJoin = "round";
  context.lineCap = "round";
  return context;
}

function drawLabel(context, text, x, y, options = {}) {
  context.save();
  context.fillStyle = options.color || COLORS.muted;
  context.font = `${options.bold ? 700 : 500} ${options.size || 18}px system-ui, sans-serif`;
  context.textAlign = options.align || "center";
  context.textBaseline = options.baseline || "middle";
  context.fillText(text, x, y);
  context.restore();
}

function gridGeometry(canvas, rows, cols) {
  const margin = 48;
  const cellSize = Math.floor(Math.min(
    (canvas.width - 2 * margin) / cols,
    (canvas.height - 2 * margin) / rows
  ));
  const width = cellSize * cols;
  const height = cellSize * rows;
  return {
    cellSize,
    left: (canvas.width - width) / 2,
    top: (canvas.height - height) / 2,
  };
}

function cellCenter(geometry, cell) {
  return {
    x: geometry.left + (cell[1] + 0.5) * geometry.cellSize,
    y: geometry.top + (cell[0] + 0.5) * geometry.cellSize,
  };
}

function drawEnvironment(key) {
  const data = dataFor(key);
  const snapshot = snapshotFor(key);
  const localFrame = frameFor(key);
  const canvas = elements.views[key].environmentCanvas;
  const context = prepareCanvas(canvas);
  const geometry = gridGeometry(canvas, data.rows, data.cols);
  const walls = new Set(data.walls.map(cellKey));
  const valueFrame = snapshot.value_frames[
    Math.min(localFrame, snapshot.value_frames.length - 1)
  ];

  for (let row = 0; row < data.rows; row += 1) {
    for (let col = 0; col < data.cols; col += 1) {
      const cell = [row, col];
      const x = geometry.left + col * geometry.cellSize;
      const y = geometry.top + row * geometry.cellSize;
      const value = valueFrame[row * data.cols + col];
      context.fillStyle = walls.has(cellKey(cell))
        ? COLORS.wall
        : sameCell(cell, data.goal)
          ? "#dcf3e5"
          : mixColor(COLORS.low, COLORS.high, (value + 0.3) / 1.2);
      context.fillRect(x, y, geometry.cellSize, geometry.cellSize);
      context.strokeStyle = COLORS.border;
      context.lineWidth = 2;
      context.strokeRect(x, y, geometry.cellSize, geometry.cellSize);

      if (walls.has(cellKey(cell))) {
        drawLabel(context, "wall", x + geometry.cellSize / 2,
          y + geometry.cellSize / 2, { color: "#465366", bold: true, size: 15 });
      } else if (sameCell(cell, data.goal)) {
        drawLabel(context, "GOAL +1", x + 7, y + 8,
          { color: COLORS.green, bold: true, align: "left", baseline: "top", size: 14 });
      } else if (sameCell(cell, data.start)) {
        drawLabel(context, "START", x + 7, y + 8,
          { color: COLORS.muted, bold: true, align: "left", baseline: "top", size: 13 });
      }

      if (!walls.has(cellKey(cell))) {
        const valueLabel = sameCell(cell, data.goal) ? "T" : value.toFixed(2);
        drawLabel(context, valueLabel,
          x + geometry.cellSize - 7, y + geometry.cellSize - 6, {
            color: sameCell(cell, data.goal) ? COLORS.green : COLORS.ink,
            bold: true,
            align: "right",
            baseline: "bottom",
            size: 14,
          });
      }
    }
  }

  const visiblePath = snapshot.path.slice(0, localFrame + 1);
  if (visiblePath.length > 1) {
    context.beginPath();
    visiblePath.forEach((cell, index) => {
      const point = cellCenter(geometry, cell);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.strokeStyle = COLORS.orange;
    context.globalAlpha = 0.78;
    context.lineWidth = 10;
    context.stroke();
    context.globalAlpha = 1;
  }

  const currentCell = visiblePath.at(-1);
  const agent = cellCenter(geometry, currentCell);
  context.beginPath();
  context.arc(agent.x, agent.y, 17, 0, Math.PI * 2);
  context.fillStyle = COLORS.blue;
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 4;
  context.stroke();

  canvas.setAttribute(
    "aria-label",
    `${data.display_name}, episode ${snapshot.episode}, step ${localFrame}. ` +
    `The agent is at row ${currentCell[0] + 1}, column ${currentCell[1] + 1}. ` +
    `Cell colors and lower-right numbers show the current estimated state values.`
  );
}

function movingAverage(values, windowSize = 20) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const window = values.slice(start, index + 1);
    return window.reduce((total, value) => total + value, 0) / window.length;
  });
}

function drawSeries(context, values, geometry, yMinimum, yMaximum, color, width, alpha) {
  if (values.length === 0) return;
  const toPoint = (value, index) => ({
    x: geometry.left + (index / Math.max(1, geometry.episodes - 1)) * geometry.width,
    y: geometry.top + (1 - (value - yMinimum) / (yMaximum - yMinimum)) * geometry.height,
  });
  context.beginPath();
  values.forEach((value, index) => {
    const point = toPoint(value, index);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.strokeStyle = color;
  context.globalAlpha = alpha;
  context.lineWidth = width;
  context.stroke();
  context.globalAlpha = 1;
}

function completedEpisodeCount() {
  const current = position();
  return current.episodeIndex + (current.step === current.length - 1 ? 1 : 0);
}

function drawPerformance() {
  const completed = completedEpisodeCount();
  const keys = selectedKeys();
  const cacheKey = `${keys.join(",")}:${completed}`;
  if (cacheKey === app.performanceCacheKey) return;
  app.performanceCacheKey = cacheKey;

  const reference = dataFor(keys[0]);
  const canvas = elements.performanceCanvas;
  const context = prepareCanvas(canvas);
  const geometry = {
    left: 50,
    top: 44,
    width: canvas.width - 68,
    height: canvas.height - 70,
    episodes: reference.episodes,
  };
  const yMinimum = -1.1;
  const yMaximum = 1.05;
  const yPosition = (value) =>
    geometry.top + (1 - (value - yMinimum) / (yMaximum - yMinimum)) * geometry.height;

  [-1, 0, 1].forEach((tick) => {
    const y = yPosition(tick);
    context.beginPath();
    context.moveTo(geometry.left, y);
    context.lineTo(geometry.left + geometry.width, y);
    context.strokeStyle = COLORS.grid;
    context.lineWidth = 2;
    context.stroke();
    drawLabel(context, `${tick}`, geometry.left - 10, y, { align: "right", size: 13 });
  });
  context.strokeStyle = COLORS.border;
  context.lineWidth = 2;
  context.strokeRect(geometry.left, geometry.top, geometry.width, geometry.height);

  keys.forEach((key) => {
    const values = dataFor(key).episode_returns.slice(0, completed);
    drawSeries(context, values, geometry, yMinimum, yMaximum,
      ALGORITHMS[key].color, 2, 0.24);
    drawSeries(context, movingAverage(values), geometry, yMinimum, yMaximum,
      ALGORITHMS[key].color, 5, 1);
  });

  drawLabel(context, "episode", geometry.left + geometry.width,
    geometry.top + geometry.height + 19, { align: "right", size: 13 });
  drawLabel(context, "return", 8, geometry.top - 19, { align: "left", size: 13 });

  keys.forEach((key, index) => {
    const x = geometry.left + 14;
    const y = 12 + index * 18;
    context.strokeStyle = ALGORITHMS[key].color;
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 42, y);
    context.stroke();
    drawLabel(context, ALGORITHMS[key].shortName, x + 52, y,
      { align: "left", size: 13, color: COLORS.ink });
  });

  const summaries = keys.map((key) => {
    const averages = movingAverage(dataFor(key).episode_returns.slice(0, completed));
    return `${ALGORITHMS[key].shortName}: ${averages.length ? averages.at(-1).toFixed(2) : "not yet available"}`;
  });
  canvas.setAttribute(
    "aria-label",
    `${completed} episodes have completed. Moving-average returns: ${summaries.join("; ")}.`
  );
}

function updateText() {
  const current = position();
  const keys = selectedKeys();
  const reference = dataFor(keys[0]);

  Object.keys(ALGORITHMS).forEach((key) => {
    const selected = app.selectedAlgorithms.has(key);
    elements.views[key].root.hidden = !selected;
    if (selected) {
      const snapshot = snapshotFor(key);
      const localFrame = frameFor(key);
      const finished = localFrame === snapshot.path.length - 1 && current.step > localFrame;
      elements.views[key].stepBadge.textContent =
        `Step ${localFrame} / ${snapshot.path.length - 1}${finished ? " · finished" : ""}`;
    }
  });

  const episodeNumber = current.episodeIndex + 1;
  const progress = Math.round(100 * app.playhead / Math.max(1, app.timeline.length - 1));
  elements.episodesOutput.value = reference.episodes;
  elements.seedOutput.value = reference.seed;
  elements.gammaOutput.value = reference.gamma;
  elements.episodeBadge.textContent = `${completedEpisodeCount()} / ${reference.episodes} complete`;
  elements.timelineRange.value = String(app.playhead);
  elements.timelineOutput.value =
    `Episode ${episodeNumber} · step ${current.step} / ${current.length - 1} · ${progress}%`;
  elements.playbackStatus.textContent =
    `${keys.length === 2 ? "Synchronized training" : ALGORITHMS[keys[0]].shortName}: ` +
    `episode ${episodeNumber} of ${reference.episodes}, step ${current.step}.`;
  elements.teachingNote.textContent = keys.length === 2
    ? "Both algorithms advance on one continuous training clock. REINFORCE changes its value map at an episode boundary; actor–critic can change it within an episode."
    : keys[0] === "reinforce"
      ? "The trajectory moves first, while the value map waits for the complete Monte Carlo return."
      : "The value map changes while the trajectory is still being generated.";
}

function render() {
  selectedKeys().forEach((key) => {
    drawEnvironment(key);
  });
  drawPerformance();
  updateText();
  elements.rewindButton.disabled = app.playhead === 0;
}

function setPlaying(isPlaying) {
  if (app.timer !== null) {
    window.clearTimeout(app.timer);
    app.timer = null;
  }
  elements.playButton.setAttribute("aria-pressed", String(isPlaying));
  elements.playButton.textContent = isPlaying ? "Pause" : "Play";
  if (isPlaying) scheduleNextFrame();
}

function scheduleNextFrame() {
  if (app.playhead >= app.timeline.length - 1) {
    setPlaying(false);
    return;
  }
  app.timer = window.setTimeout(() => {
    app.timer = null;
    app.playhead += 1;
    render();
    scheduleNextFrame();
  }, Number(elements.speedSelect.value));
}

function updateAlgorithmSelection(changedInput) {
  const oldPosition = position();
  const checked = [...elements.algorithmPicker.querySelectorAll(
    'input[name="algorithm"]:checked'
  )].map((input) => input.value);
  if (checked.length === 0) {
    changedInput.checked = true;
    elements.loadStatus.textContent = "Keep at least one algorithm selected.";
    return;
  }
  setPlaying(false);
  app.selectedAlgorithms = new Set(checked);
  buildTimeline(oldPosition.episodeIndex, oldPosition.step);
  render();
}

function enableControls() {
  elements.speedSelect.disabled = false;
  elements.restartButton.disabled = false;
  elements.playButton.disabled = false;
  elements.timelineRange.disabled = false;
}

function bindEvents() {
  elements.algorithmPicker.addEventListener("change", (event) => {
    if (event.target.matches('input[name="algorithm"]')) {
      updateAlgorithmSelection(event.target);
    }
  });
  elements.speedSelect.addEventListener("change", () => {
    if (elements.playButton.getAttribute("aria-pressed") === "true") setPlaying(true);
  });
  elements.restartButton.addEventListener("click", () => {
    setPlaying(false);
    app.playhead = 0;
    app.performanceCacheKey = "";
    render();
  });
  elements.rewindButton.addEventListener("click", () => {
    setPlaying(false);
    const frames = Math.max(1, Math.round(5000 / Number(elements.speedSelect.value)));
    app.playhead = Math.max(0, app.playhead - frames);
    app.performanceCacheKey = "";
    render();
  });
  elements.timelineRange.addEventListener("input", () => {
    setPlaying(false);
    app.playhead = Number(elements.timelineRange.value);
    app.performanceCacheKey = "";
    render();
  });
  elements.playButton.addEventListener("click", () => {
    const isPlaying = elements.playButton.getAttribute("aria-pressed") === "true";
    if (!isPlaying && app.playhead >= app.timeline.length - 1) {
      app.playhead = 0;
      app.performanceCacheKey = "";
      render();
    }
    setPlaying(!isPlaying);
  });
}

function validateDatasets() {
  const left = dataFor("reinforce");
  const right = dataFor("actor_critic");
  const sharedFields = ["rows", "cols", "start", "goal", "walls", "gamma", "episodes", "seed"];
  sharedFields.forEach((field) => {
    if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) {
      throw new Error(`Datasets disagree on shared field: ${field}`);
    }
  });
  if (left.snapshots.length !== left.episodes || right.snapshots.length !== right.episodes) {
    throw new Error("The web traces must contain every training episode.");
  }
}

async function loadDataset(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  if (!url.endsWith(".gz")) return response.json();
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser does not support gzip decompression.");
  }
  const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(decompressed).json();
}

async function initialize() {
  bindEvents();
  try {
    const entries = await Promise.all(
      Object.entries(ALGORITHMS).map(async ([key, algorithm]) => {
        return [key, await loadDataset(algorithm.url)];
      })
    );
    app.datasets = Object.fromEntries(entries);
    validateDatasets();
    buildTimeline();
    enableControls();
    render();
    elements.loadStatus.textContent = "Ready · full synchronized traces loaded";
  } catch (error) {
    elements.loadStatus.textContent = "Could not load the animation data.";
    elements.playbackStatus.classList.add("error-message");
    elements.playbackStatus.textContent =
      "Open this folder through a web server (not as a file URL). " +
      `Details: ${error.message}`;
  }
}

initialize();
