---
title: Absolute position in auto layout
date: 2026-10-24T19:00:00Z
summary: Layers inside an auto layout frame can float at their own position, for overlays, bottom sheets and badges. Pencil files with them now open correctly.
tags: [new, fixed]
---

## Float a layer over the layout

Select a layer inside an auto layout frame and turn on **Absolute position** under Position in Properties. The layer leaves the flow and stays where you put it, drawn over the other layers. The rest of the frame closes the gap, and a frame that hugs its content does not grow for it.

Use it for what sits on top of a screen: a dimming overlay, a bottom sheet or modal, a badge on an icon, a floating button. Drag the layer to move it freely, without reordering the others. Set its size to Fill and it covers the whole frame.

The agent knows about it too, so it can build sheets and overlays the same way. Exported code positions these layers absolutely inside their flex container.

## Pencil and Figma files

Screens from Pencil (`.pen`) with sheets or overlays now open the way they looked in Pencil. Before, the overlay and the sheet were stacked into the layout, pushing the screen's content out of view. Figma imports keep absolutely positioned layers in place as well.
