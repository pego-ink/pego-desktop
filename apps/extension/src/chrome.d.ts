/**
 * The few Chrome extension APIs this extension uses (MV3), typed by hand so the package needs no
 * extra dependency. See https://developer.chrome.com/docs/extensions/reference/api.
 */
declare namespace chrome {
  namespace runtime {
    type MessageSender = { tab?: { id?: number; windowId?: number } };
    const onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    function sendMessage(message: unknown): Promise<unknown>;
  }
  namespace storage {
    const local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  }
  namespace tabs {
    type Tab = { id?: number; windowId: number; url?: string; title?: string };
    function query(query: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    function get(tabId: number): Promise<Tab>;
    function captureVisibleTab(windowId: number, options: { format: "png" }): Promise<string>;
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
  }
  namespace scripting {
    type InjectionResult = { result?: unknown };
    function executeScript(injection: {
      target: { tabId: number };
      files?: string[];
      func?: (...args: never[]) => unknown;
    }): Promise<InjectionResult[]>;
  }
}
