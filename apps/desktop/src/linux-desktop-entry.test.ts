import { describe, expect, test } from "bun:test";
import { desktopEntry, ENTRY_MARKER, planEntry } from "@/linux-desktop-entry";

describe("AppImage launcher entry", () => {
  test("launches the AppImage, names the icon and the window class", () => {
    const entry = desktopEntry("/home/a/Apps/Pego-0.1.0-beta-linux-x86_64.AppImage");
    expect(entry).toContain('Exec="/home/a/Apps/Pego-0.1.0-beta-linux-x86_64.AppImage" %U');
    expect(entry).toContain("Icon=pego");
    expect(entry).toContain("StartupWMClass=pego");
    expect(entry).toContain(ENTRY_MARKER);
    expect(entry.startsWith("[Desktop Entry]\n")).toBe(true);
  });

  test("quotes characters the Exec key treats specially", () => {
    expect(desktopEntry('/tmp/my "apps"/$x/Pego.AppImage')).toContain(
      'Exec="/tmp/my \\"apps\\"/\\$x/Pego.AppImage" %U',
    );
  });
});

describe("planEntry", () => {
  const appImage = "/home/a/Pego.AppImage";

  test("writes it the first time, keeps it while it is current", () => {
    expect(planEntry({ appImage, existing: null, systemEntry: false })).toBe("write");
    expect(planEntry({ appImage, existing: desktopEntry(appImage), systemEntry: false })).toBe(
      "keep",
    );
  });

  test("rewrites Pego's own entry when the AppImage moved", () => {
    const old = desktopEntry("/home/a/Downloads/Pego.AppImage");
    expect(planEntry({ appImage, existing: old, systemEntry: false })).toBe("write");
  });

  test("leaves a user's own entry, packaged installs and non-AppImage runs alone", () => {
    expect(
      planEntry({ appImage, existing: "[Desktop Entry]\nName=My Pego\n", systemEntry: false }),
    ).toBe("skip");
    expect(planEntry({ appImage, existing: null, systemEntry: true })).toBe("skip");
    expect(planEntry({ appImage: undefined, existing: null, systemEntry: false })).toBe("skip");
  });
});
