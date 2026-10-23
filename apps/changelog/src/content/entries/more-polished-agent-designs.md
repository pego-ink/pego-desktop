---
title: More polished designs from the agent
date: 2026-10-23T16:00:00Z
summary: The agent now follows a set of polish rules on every design and checks its own work for uneven corners, thin icons, ragged card rows and lopsided padding.
tags: [improved]
version: 0.1.0-beta
---

- Every design the agent makes now follows polish rules on top of its style: nested corners that line up, icons sized to the text beside them, cards in a row that end together, even padding and clean image edges. Your chosen style still decides the look.
- When the agent checks its work, it now spots corners that don't nest, icons too thin next to bold text, cards in one row with different heights and padding that is much bigger on one side, and fixes them before it is done.
- Rows of equal-height cards no longer get a false layout warning.
