import { create } from "zustand";
import { desktopApi, type UpdateStatus } from "./desktop-api";

type UpdateState = { status: UpdateStatus };

/** Latest auto-update status from the desktop app ("idle" in a plain browser). */
export const useUpdateStatus = create<UpdateState>(() => ({ status: { state: "idle" } }));

let started = false;

/** Subscribe once to the desktop updater (call from the app root; no-op in a browser). */
export const startUpdateStatus = (): void => {
  if (started) return;
  const api = desktopApi();
  if (!api) return;
  started = true;
  api.onUpdateStatus((status) => useUpdateStatus.setState({ status }));
};
