import { expect, test } from "bun:test";
import { useThemeStore } from "@/theme/theme";
import { syncNativeTheme } from "./native-theme";

test("sends the current theme mode, then every change, until stopped", () => {
  useThemeStore.setState({ mode: "system", resolved: "dark" });
  const sent: string[] = [];
  const stop = syncNativeTheme({ setThemeSource: (mode) => sent.push(mode) });
  useThemeStore.setState({ mode: "light", resolved: "light" });
  useThemeStore.setState({ mode: "light", resolved: "light" });
  useThemeStore.setState({ mode: "dark", resolved: "dark" });
  stop();
  useThemeStore.setState({ mode: "system", resolved: "dark" });
  expect(sent).toEqual(["system", "light", "dark"]);
});

test("does nothing in a browser or an older desktop shell", () => {
  expect(() => syncNativeTheme(undefined)()).not.toThrow();
  expect(() => syncNativeTheme({})()).not.toThrow();
});
