---
title: Animated shader backgrounds
date: 2026-10-23T20:00:00Z
summary: Fill any frame or shape with a living shader, such as aurora, flowing gradients, waves, film grain, shimmer or pulsing dots, or write your own.
tags: [new]
---

Frames and shapes have a new fill type: **Shader (animated)**. Pick it under Fill in the properties panel and choose a look:

- **Aurora**: soft bands of three colors drifting like northern lights.
- **Gradient flow**: two blurred color blobs wandering over a background.
- **Waves**: thin wavy lines that ripple sideways.
- **Film grain**: a flat color with living noise.
- **Shimmer**: a light sweep, like a loading skeleton.
- **Pulsing dots**: a dot grid that breathes in a wave.

Every look has its own colors and speed, and colors can come from your variables. The shader moves while its layer is selected and while you press **Play**; the rest of the time it rests, so the canvas stays fast.

## Your own shader

Choose **Custom code** to write a fragment shader yourself: `vec4 main(vec2 fragCoord)`, with the shape size in `iResolution` and the time in `iTime`. Mistakes show up right under the code.

## In your code

Export HTML or React and the shader comes along, drawn with WebGL behind your content, with a plain color for browsers that cannot run it. SVG exports use the first color and PNG exports a still frame. The agent can add shader backgrounds too.
