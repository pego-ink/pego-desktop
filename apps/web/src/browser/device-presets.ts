export type DeviceGroup = "phone" | "tablet" | "laptop" | "desktop";

export type DevicePreset = {
  id: string;
  label: string;
  group: DeviceGroup;
  width: number;
  height: number;
  /** Mobile emulation (mobile viewport meta, overlay scrollbars). */
  mobile: boolean;
  touch: boolean;
};

/** No emulation: the view fills the region. Width and height are unused. */
export const RESPONSIVE_ID = "responsive";

export const RESPONSIVE: DevicePreset = {
  id: RESPONSIVE_ID,
  label: "Responsive",
  group: "desktop",
  width: 0,
  height: 0,
  mobile: false,
  touch: false,
};

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  {
    id: "iphone-15",
    label: "iPhone 15",
    group: "phone",
    width: 393,
    height: 852,
    mobile: true,
    touch: true,
  },
  {
    id: "pixel-8",
    label: "Pixel 8",
    group: "phone",
    width: 412,
    height: 915,
    mobile: true,
    touch: true,
  },
  {
    id: "ipad-air",
    label: "iPad Air",
    group: "tablet",
    width: 820,
    height: 1180,
    mobile: true,
    touch: true,
  },
  {
    id: "macbook-air-13",
    label: 'MacBook Air 13"',
    group: "laptop",
    width: 1470,
    height: 956,
    mobile: false,
    touch: false,
  },
  {
    id: "macbook-pro-14",
    label: 'MacBook Pro 14"',
    group: "laptop",
    width: 1512,
    height: 982,
    mobile: false,
    touch: false,
  },
  {
    id: "desktop-1440",
    label: "Desktop 1440",
    group: "desktop",
    width: 1440,
    height: 900,
    mobile: false,
    touch: false,
  },
  {
    id: "desktop-1920",
    label: "Desktop 1920",
    group: "desktop",
    width: 1920,
    height: 1080,
    mobile: false,
    touch: false,
  },
];

export const GROUP_LABELS: Record<DeviceGroup, string> = {
  phone: "Phones",
  tablet: "Tablets",
  laptop: "Laptops",
  desktop: "Desktops",
};

export const GROUP_ORDER: readonly DeviceGroup[] = ["phone", "tablet", "laptop", "desktop"];

/** The preset for an id; unknown ids fall back to responsive. */
export const findPreset = (id: string): DevicePreset =>
  DEVICE_PRESETS.find((p) => p.id === id) ?? RESPONSIVE;

export const isResponsive = (preset: DevicePreset) => preset.id === RESPONSIVE_ID;

/** Phones and tablets can be turned to landscape. */
export const canRotate = (preset: DevicePreset) =>
  preset.group === "phone" || preset.group === "tablet";

/** Device size in CSS px, swapped when rotated (only phones and tablets rotate). */
export const deviceSize = (preset: DevicePreset, rotated: boolean) =>
  rotated && canRotate(preset)
    ? { width: preset.height, height: preset.width }
    : { width: preset.width, height: preset.height };

export const sizeLabel = (preset: DevicePreset, rotated: boolean) => {
  const { width, height } = deviceSize(preset, rotated);
  return `${width}×${height}`;
};

export type DeviceChoice = { id: string; rotated: boolean };

export const RESPONSIVE_CHOICE: DeviceChoice = { id: RESPONSIVE_ID, rotated: false };

/** Parse a stored choice; anything invalid becomes responsive. */
export const parseDeviceChoice = (raw: string | null): DeviceChoice => {
  if (!raw) return RESPONSIVE_CHOICE;
  try {
    const value = JSON.parse(raw) as Partial<DeviceChoice> | null;
    if (!value || typeof value.id !== "string") return RESPONSIVE_CHOICE;
    const preset = findPreset(value.id);
    return { id: preset.id, rotated: value.rotated === true && canRotate(preset) };
  } catch {
    return RESPONSIVE_CHOICE;
  }
};
