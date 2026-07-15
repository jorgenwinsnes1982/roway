# ROWAY Map UI development package

Canvas: 1448 × 1086 px, 4:3.

## Files
- `assets/background/map_background_clean_1448x1086.png` — clean map background layer.
- `assets/overlays/all_ui_elements_exact_1448x1086.png` — transparent overlay with all UI elements in the same coordinate space.
- `assets/sprites/*.png` — cropped sprites with `x/y/width/height` in `manifest.json`.
- `assets/svg/top_route_layer_1448x1086.svg` — interactive route layer for the dotted ocean path.
- `assets/svg/bottom_progress_layer_1448x1086.svg` — code-friendly bottom progress/timeline layer.
- `manifest.json` — exact placement data.

## Recommended implementation
Use the background as a static image. Place sprites absolutely in a responsive container with `aspect-ratio: 1448 / 1086`. For routes and progress, use SVG paths/lines, because they need to animate and respond to game state.
