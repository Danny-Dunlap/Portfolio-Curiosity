# Musical Marble Drop (Matter.js)

A web-based musical marble drop toy using Matter.js physics and pixel-accurate image collision bodies.

## Run
Serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8000
```
Then open http://localhost:8000

## Controls
- Click canvas to enable audio (Tone.js).
- Drag object: click near center and move.
- Rotate object: click outside center and move in a circle.
- V: toggle collision overlay (debug)
- M: toggle alpha-mask preview (debug)
- A/B/O: force collision mode to alpha / rgb / auto
- R: rebuild image collision bodies

## Code
- Main game logic: `game.js`
- Entry HTML: `index.html`
- Images: `images/`

Core functions:
- `createAccurateImageBody(img, width, height)` — builds a compound body from pixels, centers parts, normalizes COM.
- `createAndPositionImageBody(img, x, y, width, height, rotation)` — creates, positions, and rotates the body.
- `render()` — draws images with `body.renderOffset` so sprites align to physics shapes.

## Notes
- Overlays are off by default. Use V/M to debug alignment.
- Alpha-based collision preferred; falls back to RGB non-white when needed.
