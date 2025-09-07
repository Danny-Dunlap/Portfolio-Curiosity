# Musical Marble Drop (Matter.js)

A web-based musical marble drop toy using Matter.js physics and pixel-accurate image collision bodies.

## Run (with AI image generation)
We now include a small Node server that proxies image generation to OpenAI and also serves the static files.

1) Install dependencies
```bash
npm install
```

2) Configure environment
Create a `.env` file in the project root:
```
OPENAI_API_KEY=your_key_here
PORT=3000
```
You can use `ENV_EXAMPLE.txt` as a reference.

3) Start the server
```bash
npm run start
```
Then open http://localhost:3000

If no API key is set or the request fails, the app gracefully falls back to generating a text object.

## Run (static only, without AI)
You can still serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8000
```
Then open http://localhost:8000. Note: the AI endpoint `/api/generate-image` will not be available in this mode.

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
