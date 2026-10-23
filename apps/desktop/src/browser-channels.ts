/** IPC channel allowlist for the in-app browser view, shared by main and preload. */
export const BROWSER_CHANNELS = {
  show: "pego:browser:show",
  hide: "pego:browser:hide",
  navigate: "pego:browser:navigate",
  back: "pego:browser:back",
  forward: "pego:browser:forward",
  reload: "pego:browser:reload",
  stop: "pego:browser:stop",
  cdp: "pego:browser:cdp",
  setEmulation: "pego:browser:set-emulation",
  fetchImage: "pego:browser:fetch-image",
  getState: "pego:browser:get-state",
  state: "pego:browser:state",
  pageMessage: "pego:browser:page-message",
} as const;

/** Console messages starting with this prefix are forwarded to the editor as page messages. */
export const PAGE_MESSAGE_PREFIX = "__pego__:";
