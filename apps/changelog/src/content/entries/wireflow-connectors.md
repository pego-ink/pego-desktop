---
title: Wireflows with connectors
date: 2026-10-24T21:00:00Z
summary: Connect screens with arrows that follow them when they move. Draw a flow with the Connector tool, or ask the agent to connect your screens for you.
tags: [new]
---

## Draw the flow between screens

Pick the **Connector** tool (`C`) and drag from one screen to another. Pego draws an arrow between them that stays attached: move a screen and the arrow follows, delete it and its arrows go too. Hold ⌘ or Ctrl while you drag to start from a button or a card inside a screen, so the flow shows exactly what the user taps.

Select an arrow by clicking its line. In Properties you can give it a label ("Tap Beli", "PIN salah"), choose right angles, a straight line or a curve, pick the side it leaves and enters, and change its color, width and arrow heads.

## Let the agent connect them

Ask for a user flow or wireflow and the agent lays the screens out, then draws the arrows with short labels for each step, branches like errors or empty states included.

Arrows show on the canvas and in SVG and PNG exports of a frame that contains them. Code export leaves them out, since they describe the flow, not the screen.

## Turn them off

Don't need the arrows right now? Turn off **Wireflow connectors** in Settings › General, or uncheck **Show wireflow connectors** in the canvas menu (right-click). The arrows and the Connector tool are hidden, and your connectors stay in the file for when you turn them back on.
