---
title: Resizing a group scales its contents
date: 2026-10-24T11:00:00Z
summary: Drag a handle on a group and everything inside it grows or shrinks with it, and imported SVGs now behave this way.
tags: [improved]
---

Resizing a group used to move only its box while the layers inside stayed the same size. Now the layers scale with the group: positions, sizes, corner radius, stroke width, shadows, blur and text size follow the handle, and vector paths stretch to the new box. Hold Shift to keep the proportions. It stays one undo step. Frames keep their usual resize behavior.

SVG files and SVG code you paste or drop now arrive as a group instead of a clipped frame, so you can resize a logo or an icon as one object. Content that sticks out past the original SVG area is no longer cut off. Values that use variables are left as they are when a group is scaled.
