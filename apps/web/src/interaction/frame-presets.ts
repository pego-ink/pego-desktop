// Common frame sizes, grouped like Figma's frame presets. Pure data + helpers (no store access).
// Sizes are CSS px (device presets: points / dp viewport; print: 72 dpi points).
import type { Box } from "@pego/doc";

export type FramePreset = {
  /** Stable id, safe to persist and to reference from agent skills. */
  id: string;
  name: string;
  width: number;
  height: number;
  /** Short hint shown next to the size, e.g. "4:5". */
  note?: string;
  /** Extra search terms (English + Indonesian aliases), lowercase. */
  keywords?: readonly string[];
};

export type FramePresetCategory = {
  id: string;
  name: string;
  /** Where the sizes were checked (spec / help page / guide). */
  source: string;
  presets: readonly FramePreset[];
};

const p = (
  id: string,
  name: string,
  width: number,
  height: number,
  note?: string,
  keywords?: readonly string[],
): FramePreset => ({ id, name, width, height, note, keywords });

export const FRAME_PRESET_CATEGORIES: readonly FramePresetCategory[] = [
  {
    id: "phone",
    name: "Phone",
    // Apple viewport points: https://www.ios-resolution.com/ (matches Apple HIG device specs).
    // Android window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/support-different-screen-sizes
    source: "https://www.ios-resolution.com/",
    presets: [
      p("iphone-16", "iPhone 16", 393, 852, undefined, ["ios", "apple", "hp", "ponsel"]),
      p("iphone-16-pro", "iPhone 16 Pro", 402, 874, undefined, ["ios", "apple", "hp"]),
      p("iphone-16-pro-max", "iPhone 16 Pro Max", 440, 956, undefined, ["ios", "apple", "hp"]),
      p("iphone-16-plus", "iPhone 16 Plus", 430, 932, undefined, ["ios", "apple", "hp"]),
      p("iphone-se", "iPhone SE", 375, 667, "3rd gen", ["ios", "apple", "hp"]),
      p("android-compact", "Android compact", 360, 800, "width < 600dp", ["hp", "material"]),
      p("android-medium", "Android medium", 700, 840, "600-840dp", ["foldable", "material"]),
      p("pixel-9", "Pixel 9", 412, 915, undefined, ["google", "hp", "android"]),
    ],
  },
  {
    id: "tablet",
    name: "Tablet",
    source: "https://www.ios-resolution.com/",
    presets: [
      p("ipad-mini", "iPad mini", 744, 1133, undefined, ["apple", "ios"]),
      p("ipad-air-11", 'iPad Air 11"', 820, 1180, undefined, ["apple", "ios"]),
      p("ipad-pro-11", 'iPad Pro 11"', 834, 1210, undefined, ["apple", "ios"]),
      p("ipad-pro-13", 'iPad Pro 13"', 1032, 1376, undefined, ["apple", "ios"]),
      p("android-tablet", "Android tablet", 1280, 800, "expanded", ["material"]),
    ],
  },
  {
    id: "desktop",
    name: "Desktop",
    // MacBook default scaled resolutions (Apple tech specs, "Default" display scaling).
    source: "https://support.apple.com/en-us/102057",
    presets: [
      p("macbook-air-13", 'MacBook Air 13"', 1470, 956, undefined, ["laptop", "mac"]),
      p("macbook-pro-14", 'MacBook Pro 14"', 1512, 982, undefined, ["laptop", "mac"]),
      p("macbook-pro-16", 'MacBook Pro 16"', 1728, 1117, undefined, ["laptop", "mac"]),
      p("desktop-1440", "Desktop", 1440, 1024, undefined, ["web", "website", "laman"]),
      p("desktop-hd", "Desktop HD", 1920, 1080, "16:9", ["web", "monitor", "full hd"]),
    ],
  },
  {
    id: "watch",
    name: "Watch",
    source: "https://www.ios-resolution.com/",
    presets: [
      p("watch-41", "Apple Watch 41mm", 176, 215, undefined, ["apple", "jam"]),
      p("watch-45", "Apple Watch 45mm", 198, 242, undefined, ["apple", "jam"]),
      p("watch-49", "Apple Watch 49mm", 205, 251, "Ultra", ["apple", "jam"]),
    ],
  },
  {
    id: "social",
    name: "Social media",
    // Third-party guides agree (no single official page): Instagram 1080x1080 / 1080x1350 / 1080x566 /
    // 1080x1920; Facebook cover 820x312, post 1200x630; X header 1500x500; LinkedIn 1584x396 / 1128x191;
    // Pinterest official 1000x1500 (https://help.pinterest.com/en/business/article/pinterest-product-specs);
    // YouTube banner 2560x1440 (safe area 1546x423), thumbnail 16:9
    // (https://support.google.com/youtube/answer/72431).
    source: "https://help.pinterest.com/en/business/article/pinterest-product-specs",
    presets: [
      p("instagram-post-square", "Instagram post (square)", 1080, 1080, "1:1", [
        "ig",
        "feed instagram",
        "post ig",
        "kotak",
      ]),
      p("instagram-post-portrait", "Instagram post (portrait)", 1080, 1350, "4:5", [
        "ig",
        "feed instagram",
        "post ig",
      ]),
      p("instagram-post-landscape", "Instagram post (landscape)", 1080, 566, "1.91:1", [
        "ig",
        "feed instagram",
      ]),
      p("instagram-story", "Instagram story / Reel", 1080, 1920, "9:16", [
        "ig",
        "story ig",
        "reels",
        "reel ig",
        "status",
      ]),
      p("tiktok", "TikTok", 1080, 1920, "9:16", ["video", "vertikal"]),
      p("facebook-post", "Facebook post", 1200, 630, "1.91:1", ["fb", "postingan"]),
      p("facebook-cover", "Facebook cover", 820, 312, undefined, ["fb", "sampul"]),
      p("x-post", "X post", 1600, 900, "16:9", ["twitter", "tweet", "postingan"]),
      p("x-header", "X header", 1500, 500, "3:1", ["twitter", "sampul"]),
      p("linkedin-post", "LinkedIn post", 1200, 627, "1.91:1", ["postingan"]),
      p("linkedin-banner", "LinkedIn banner", 1584, 396, "4:1", ["cover", "sampul", "profile"]),
      p("youtube-thumbnail", "YouTube thumbnail", 1280, 720, "16:9", ["yt", "sampul video"]),
      p("youtube-banner", "YouTube banner", 2560, 1440, "safe 1546 × 423", ["yt", "channel art"]),
      p("pinterest-pin", "Pinterest pin", 1000, 1500, "2:3", ["pin"]),
      p("whatsapp-status", "WhatsApp status", 1080, 1920, "9:16", ["wa", "story wa"]),
    ],
  },
  {
    id: "presentation",
    name: "Presentation",
    source: "https://support.microsoft.com/powerpoint (16:9 and 4:3 slide ratios)",
    presets: [
      p("slide-16-9", "Slide 16:9", 1920, 1080, undefined, ["slide", "ppt", "presentasi"]),
      p("slide-4-3", "Slide 4:3", 1024, 768, undefined, ["slide", "ppt", "presentasi"]),
    ],
  },
  {
    id: "print",
    name: "Print",
    // ISO 216 / US Letter / 3.5x2in card / 18x24in poster, at 72 dpi points.
    source: "https://en.wikipedia.org/wiki/ISO_216",
    presets: [
      p("a4", "A4", 595, 842, "210 × 297 mm", ["kertas", "dokumen", "print", "cetak"]),
      p("a5", "A5", 420, 595, "148 × 210 mm", ["kertas", "brosur", "flyer"]),
      p("a3", "A3", 842, 1191, "297 × 420 mm", ["kertas", "poster"]),
      p("us-letter", "US Letter", 612, 792, '8.5 × 11"', ["kertas", "letter"]),
      p("business-card", "Business card", 252, 144, '3.5 × 2"', ["kartu nama", "name card"]),
      p("poster-18-24", "Poster", 1296, 1728, '18 × 24"', ["poster", "cetak"]),
    ],
  },
  {
    id: "other",
    name: "Other",
    source: "https://ogp.me/ (Open Graph image 1200x630)",
    presets: [
      p("dribbble-shot", "Dribbble shot", 1600, 1200, "4:3", ["portfolio", "shot"]),
      p("og-image", "Open Graph image", 1200, 630, "1.91:1", ["og", "share", "thumbnail link"]),
      p("app-icon", "App icon", 1024, 1024, "1:1", ["favicon", "ikon", "logo"]),
    ],
  },
];

const ALL_PRESETS: readonly FramePreset[] = FRAME_PRESET_CATEGORIES.flatMap((c) => c.presets);

export const findFramePreset = (id: string): FramePreset | undefined =>
  ALL_PRESETS.find((preset) => preset.id === id);

const haystack = (preset: FramePreset, category: FramePresetCategory): string =>
  [
    preset.name,
    category.name,
    preset.note ?? "",
    `${preset.width}x${preset.height}`,
    `${preset.width} x ${preset.height}`,
    ...(preset.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();

/**
 * Categories narrowed to presets matching every whitespace-separated term of `query`
 * (name, category, note, size, keywords). Empty categories are dropped; blank query = all.
 */
export const searchFramePresets = (
  query: string,
  categories: readonly FramePresetCategory[] = FRAME_PRESET_CATEGORIES,
): FramePresetCategory[] => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...categories];
  return categories
    .map((category) => ({
      ...category,
      presets: category.presets.filter((preset) => {
        const text = haystack(preset, category);
        return terms.every((term) => text.includes(term));
      }),
    }))
    .filter((category) => category.presets.length > 0);
};

/** Preset of exactly this size, else one that matches rotated (portrait vs landscape). */
export const matchFramePreset = (width: number, height: number): FramePreset | undefined =>
  ALL_PRESETS.find((preset) => preset.width === width && preset.height === height) ??
  ALL_PRESETS.find((preset) => preset.width === height && preset.height === width);

export const formatPresetSize = (preset: Pick<FramePreset, "width" | "height">): string =>
  `${preset.width} × ${preset.height}`;

/** Portrait <-> landscape. */
export const swapOrientation = (size: { width: number; height: number }) => ({
  width: size.height,
  height: size.width,
});

/**
 * Where a new top-level frame goes: right of all existing top-level content, top aligned,
 * `gap` px away. Origin (0, 0) on an empty canvas.
 */
export const freeFrameSpot = (
  occupied: readonly Box[],
  size: { width: number; height: number },
  gap = 80,
): Box => {
  if (occupied.length === 0) return { x: 0, y: 0, ...size };
  const right = Math.max(...occupied.map((box) => box.x + box.width));
  const top = Math.min(...occupied.map((box) => box.y));
  return { x: Math.round(right + gap), y: Math.round(top), ...size };
};
