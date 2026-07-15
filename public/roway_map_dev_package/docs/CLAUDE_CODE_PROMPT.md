# Claude Code prompt — Build ROWAY interactive map screen

You are working on the ROWAY game. Build a responsive interactive map screen using the assets in this package.

## Goal
Create a game overview map between USA, Island/Grønland and Norge in the same cinematic Viking/ice-metal style as the ROWAY key art.

## Asset rules
- Canvas coordinate system is `1448 x 1086`.
- Use `assets/background/map_background_clean_1448x1086.png` as the base layer.
- Use `manifest.json` for exact sprite placement.
- Do NOT bake interactive routes into the background. Use SVG for route/timeline animation.
- Keep all UI as separate layers so it can be animated and clicked.

## Layout implementation
Create a component called `RowayMapScreen`.

Layer order:
1. Background image, full container.
2. Top ocean route SVG (`top_route_layer_1448x1086.svg`).
3. Sprites from manifest: MetLife Stadium, USA badge, Island/Grønland badge, Norge badge, buoys, rowing boat.
4. Bottom progress SVG (`bottom_progress_layer_1448x1086.svg`).
5. Footer status text.
6. Optional smoke/embers overlay on top, pointer-events none.

Use a wrapper with this behavior:
- `position: relative`
- `width: 100%`
- `aspect-ratio: 1448 / 1086`
- all child layers use absolute positioning in percentages derived from manifest coordinates.

## Interactivity
Implement these states:
- `progressMeters`: number, range 0–3000.
- `activeSegment`: `usa-to-island` or `island-to-norway`.
- `selectedDestination`: `usa | island | norway | null`.

Animated behavior:
- Route stroke should glow and animate using `stroke-dashoffset`.
- Boat should move along the route based on progress.
- Badges should scale up slightly on hover/click.
- Current destination should have stronger gold glow.
- Completed route segment should be brighter gold.
- Locked/future route segment should be dimmer.

## Text
Use exact visible labels for now:
- USA
- Island / Grønland
- Norge
- Du har rodd 0 m – 3 000 m til Utaskjærs! 🌊

## Style
Use dark navy, ice-blue highlights, gold trims, metallic borders, subtle smoke and ember effects. Avoid flat web UI. It should feel like premium game UI/key art.

## Deliverables
- Implement the screen/component.
- Keep assets configurable from `manifest.json`.
- Add clean CSS variables for gold, ice-blue, dark navy, glow.
- Make it work responsively without breaking exact relative placement.
- Add comments explaining how to update positions from the manifest.
