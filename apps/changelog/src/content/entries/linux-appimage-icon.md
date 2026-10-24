---
title: Pego's icon in the Linux dock
date: 2026-10-24T17:00:00Z
summary: The Linux AppImage now shows Pego's own icon in the dock and app grid, instead of a generic one.
tags: [fixed]
---

When you ran Pego as an AppImage on Linux, the dock showed a generic icon. This was most visible on Wayland desktops such as GNOME, Zorin OS and Ubuntu, which find an app's icon only through its launcher entry, and an AppImage installs none.

Pego now adds its own launcher entry and icon the first time it runs as an AppImage. The dock, the taskbar and the app grid show the Pego icon, and you can find and pin Pego like any installed app. If you move the AppImage, the entry follows it the next time Pego starts. When a new version brings a new logo, the dock shows it right away instead of the old one.

Installed packages (deb, rpm, pacman) already had an entry and are not changed. A launcher entry for Pego that you made yourself is left alone.
