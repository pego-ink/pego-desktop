---
title: Smooth panning and zooming on big pages
date: 2026-10-24T22:00:00Z
summary: Panning and zooming stay smooth on pages with many screens. Pego draws only what is on screen and moves the view without redrawing it.
tags: [improved]
---

Pages with dozens of screens used to feel heavy: every small pan redrew the whole page, including everything off screen. On a page with about 100 screens and 4,000 layers, one frame took close to a tenth of a second.

Now Pego draws only the layers you can see, skips layers too small to show at the current zoom, and keeps a margin around the view ready. Panning and zooming just move that picture, and Pego redraws when you reach its edge or right after you stop zooming, so text stays sharp. On the same page a frame now takes under a millisecond while you pan.

Large pages also keep their text ready to draw, so coming back to screens you already passed is instant.
