---
title: Remove the background of a photo
date: 2026-10-24T18:00:00Z
summary: Cut a product, person, animal or dish out of its photo with one click, on your own device, or with your image model for finer edges.
tags: [new]
---

Select a photo and choose **Remove background**, under Image in the properties panel (or under Fill for a shape with an image fill). Pego cuts out the subject and leaves the background transparent, so you can place it on any color, gradient or design.

- **On your device:** the first time, Pego downloads a small background model (44 MB) and keeps it. After that it is free, private and works offline. A photo takes a few seconds.
- **High quality:** if you set up an OpenAI-compatible provider with a gpt-image model in Model settings, a second button sends the photo to that model for finer edges, such as hair and fur. This uses one request on your key.
- One click is one undo step, so you get the original back with Undo.

The agent can do it too. Ask it to "remove the background of this photo", or to put a product on a new background, and it cuts the subject out itself.

The on-device model is Silueta, a compact U²-Net released under the Apache-2.0 license.
