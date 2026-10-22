/** Minimal File System Access API typings (not in TS lib.dom) plus feature detection. */
export type PegoFileHandle = {
  readonly name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{
    write: (data: Blob | string) => Promise<void>;
    close: () => Promise<void>;
  }>;
  queryPermission?: (desc: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (desc: { mode: "readwrite" }) => Promise<PermissionState>;
};

type PickerType = { description: string; accept: Record<string, string[]> };

type FsWindow = {
  showOpenFilePicker?: (opts: {
    types?: PickerType[];
    multiple?: boolean;
  }) => Promise<PegoFileHandle[]>;
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: PickerType[];
  }) => Promise<PegoFileHandle>;
};

const fsWindow = () => window as unknown as FsWindow;

/** Looked up lazily so feature detection reflects the current environment. */
export const getOpenFilePicker = () => fsWindow().showOpenFilePicker?.bind(window);
export const getSaveFilePicker = () => fsWindow().showSaveFilePicker?.bind(window);

export const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";
