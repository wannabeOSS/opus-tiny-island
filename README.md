# Tiny Island

A small, hand-made 3D island to poke at. Shake the trees, skim pebbles, blow bubbles for the fish, rain on the flowers, and slowly uncover its sixteen secrets. Days pass, weather rolls in, and the island remembers what you've found.

Made by **[Proxyy](https://github.com/wannabeOSS/opus-tiny-island)**.

## Playing

| Input | Desktop | Touch |
| --- | --- | --- |
| Look around | drag | two-finger drag |
| Zoom | scroll | pinch |
| Fly to a spot | double-click (sky returns home) | double-tap |
| Pick up and throw | drag a pebble, shell, coconut... | same |

**Tools** sit in the basket at the bottom: hand `1`, pinwheel `2`, pocket cloud `3`, sun mirror `4`, bubble wand `5`, seed bomb `6`, conch `7`.

**Keys:** `W` cycles the weather, `J` opens the field notes, `M` mutes, `Esc` puts the tool down or closes the notes. The day dial in the notes scrubs time (arrow keys work too).

Progress is saved in the browser (`localStorage`), so secrets survive a reload.

## Running it

Requires [Bun](https://bun.sh) (or Node 20+ with npm).

```bash
bun install
bun dev          # http://localhost:3000
bun run build    # production build
bun start        # serve the production build
```

## How it's built

- **Next.js 16** (App Router, Turbopack) hosting a single client-side scene.
- **three.js** with **@react-three/fiber** and **drei** for rendering; nearly every mesh is generated in code, with no model files.
- **@react-three/rapier** for props: thrown things bounce off convex-hull colliders that follow the visible shapes of the cabin, lighthouse, palms and rocks, and float when they land in water.
- Custom shaders for the sea (swell, ripples, foam, caustics), sky, grass and weather.
- Procedural Web Audio for every sound, positioned around the camera.

```
components/island/
  Experience.tsx   canvas, adaptive resolution, scene graph
  systems/         camera, input tools, sound, director (time + weather)
  world/           terrain, water, flora, buildings, props, creatures, sky toys
  lib/             shared world state, terrain maths, audio, colliders, secrets
  ui/              HUD, field notes, cursor, error fallback
```

### Performance

- The canvas resolution adapts to the frame rate (`PerformanceMonitor`), from 1x up to 1.75x on desktop and 0.8x to 1.5x on phones.
- The water skips its ripple loop on calm seas and computes ripple slopes analytically in a single pass.
- Particles and instanced flowers only upload the data that changed.
- Light counts never change at runtime, so revealing a new light doesn't recompile every shader mid-play.
- Static rocks are merged into a single draw call.

### Resilience

- If WebGL is unavailable or the scene throws, a friendly card replaces the canvas. If the GPU drops the context, the island offers to wake back up.
- Audio unlocks on the first touch, pauses when the tab is hidden, and recovers from iOS interruptions.
- Respects `prefers-reduced-motion` (no intro fly-in or auto-rotate) and safe-area insets on notched phones.

## Credits

Design, code and sound by **Proxyy**. Built with three.js, React Three Fiber, drei, Rapier and Next.js.
