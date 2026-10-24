/**
 * The built-in browser introduces itself as the Chrome it is: Electron's default user agent adds
 * "Electron/x" and the app's "Pego/x", which sites (Google's search among them) treat as a bot.
 */
export const browserUserAgent = (electronUserAgent: string): string =>
  electronUserAgent
    .replace(/ Electron\/\S+/g, "")
    .replace(/ Pego\/\S+/gi, "")
    .replace(/ @pego\/desktop\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
