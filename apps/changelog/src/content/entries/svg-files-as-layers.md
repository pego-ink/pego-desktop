---
title: SVG files become layers
date: 2026-10-24T09:00:00Z
summary: Drop or paste an SVG file on the canvas and it becomes editable vector layers, not a flat image.
tags: [improved]
---

Drag an `.svg` file from Finder or Explorer onto the canvas, or copy the file and paste it, and Pego turns it into a frame of shapes and paths you can select, recolor and reshape, the same as pasting SVG code. It lands where you drop it, inside the frame under the pointer, and large drawings are scaled down to fit (still as vectors). Artwork inside a nested SVG viewport, common in app icons and in SVGs exported from Pego, keeps its position and size, and linear and radial gradients stay gradients instead of turning into a flat color.

If an SVG uses something Pego can't turn into layers (scripts, or a file over 512 KB), it is placed as an image instead and a message tells you so.
