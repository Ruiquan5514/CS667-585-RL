# Policy-learning animation

Live site after GitHub Pages is enabled:
<https://ruiquan5514.github.io/CS667-585-RL/>

This asset compares REINFORCE with a learned baseline and one-step
actor--critic in the same small tabular Gridworld. The interactive page lets a
student select either algorithm or both and continuously play the entire
220-episode training run. There is no episode-by-episode selector. When both
are selected, a shared clock advances both agents simultaneously; a shorter
trajectory remains on its final frame until the other finishes that episode.
The next episode then begins automatically. In each replay:

- the first dashboard row begins with episodic returns and their 20-episode
  moving averages;
- the second row places up to four algorithm simulations from left to right;
- each simulation overlays the trajectory and agent on the current value
  heatmap, with the numerical value at the lower-right of every state.

On a wide screen, both dashboard rows reserve four horizontal slots. The
current return chart spans the first two metric slots; future plots such as KL
divergence or policy entropy can use the remaining slots. The two current
algorithm simulations occupy the first two simulation slots. At narrower
widths, the dashboard changes to two columns and then one column.

The important timing difference is intentional. REINFORCE holds its value map
fixed during an episode and updates after the Monte Carlo returns are known.
Actor--critic updates its value map online after each one-step TD error.

The web data store every transition from every episode, together with the
corresponding value-map frames. Playback can be paused, scrubbed on the
timeline, restarted, or moved backward by five seconds at the selected speed.
Failed episodes are retained because stochastic learning need not improve
monotonically.

## Preview the GitHub Pages version locally

The page loads JSON with `fetch`, so it must be opened through HTTP rather
than by double-clicking `index.html`. From this directory, run:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. The page has no external dependencies and
is ready for a static host such as GitHub Pages.

## Publish with GitHub Pages

Copy the contents of this directory into the Pages publishing directory of a
GitHub repository (the repository root or `docs/` both work). In the GitHub
repository, open **Settings → Pages**, choose **Deploy from a branch**, then
select the branch and folder containing `index.html`. The included `.nojekyll`
file makes GitHub serve the files without a Jekyll build.

The current course-slides directory is not itself a Git repository, so the
final public URL cannot be created until a destination repository is chosen.

## Regenerate

No third-party Python package is required. From this directory, run:

```bash
python3 generate_learning_data.py

python3 generate_learning_data.py \
  --checkpoints "" --render-every 1 --output-label web-data

SWIFT_MODULECACHE_PATH=/private/tmp/rl-animation-swift-cache \
CLANG_MODULE_CACHE_PATH=/private/tmp/rl-animation-swift-cache \
swift render_learning_animation.swift reinforce-animation-data.json

SWIFT_MODULECACHE_PATH=/private/tmp/rl-animation-swift-cache \
CLANG_MODULE_CACHE_PATH=/private/tmp/rl-animation-swift-cache \
swift render_learning_animation.swift actor_critic-animation-data.json
```

The first command regenerates the compact checkpoint data used by the GIF
renderer. The second regenerates the complete browser timeline. Do not feed
the much larger `*-web-data.json` files to the GIF renderer.

## Files used by the web page

- `index.html`: semantic page structure and accessible controls;
- `dashboard.css`: compact two-row responsive dashboard layout;
- `app.js`: single or synchronized multi-algorithm playback and canvas rendering;
- `*-web-data.json.gz`: compressed deterministic, full-training traces loaded
  and decompressed by the page.

## Other formats

- The regeneration commands can create `reinforce-learning.gif` and
  `actor_critic-learning.gif` for Canvas, HTML, or PowerPoint.
- They also create matching `*-poster.png` static fallbacks for PDF.
- The web page provides keyboard-accessible Play/Pause, rewind, and timeline controls,
  dynamic canvas descriptions, visible explanations, and no autoplay.
