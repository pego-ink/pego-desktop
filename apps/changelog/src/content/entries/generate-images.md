---
title: Generate images, with Nano Banana too
date: 2026-10-23T17:30:00Z
summary: Generate an image from a prompt in the Assets panel, with your own Google Gemini (Nano Banana), OpenAI or other image model.
tags: [new]
---

**Assets › Images › Generate** turns a prompt into an image and places it in the middle of your view. Pick a shape (square, 4:3, 16:9, 3:4 or 9:16) and, if you have several, which image model to use. Earlier results stay in the panel to place again or drag onto the canvas.

It works with your own API key:

- **Google Gemini**: a new preset in Settings › Agent & Models. Its image model `gemini-2.5-flash-image` ("Nano Banana") and Imagen models both work.
- **OpenAI** (`gpt-image-1`, DALL·E) and other OpenAI-compatible providers with an image model, as before.

The agent's `generate_image` uses the model you picked here.
