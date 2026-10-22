// Applies the saved theme before the app renders (no flash of the wrong palette). Kept in sync
// with src/theme/theme.ts; a separate file so the desktop app's CSP (script-src 'self') allows it.
(function () {
  var mode;
  try {
    mode = localStorage.getItem("pego.theme") || "system";
  } catch {
    mode = "system"; // Storage blocked: follow the system setting.
  }
  var light =
    mode === "light" ||
    (mode === "system" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches);
  var root = document.documentElement;
  root.classList.toggle("light", light);
  root.classList.toggle("dark", !light);
})();
