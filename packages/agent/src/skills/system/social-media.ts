import type { Skill } from "../types";

export const socialMediaSkill: Skill = {
  id: "social-media",
  title: "Social media graphics",
  description:
    "Posts, stories, carousels and banners at exact platform sizes with strong focal points.",
  keywords: [
    "social media",
    "instagram",
    "post",
    "story",
    "carousel",
    "banner",
    "thumbnail",
    "linkedin",
    "konten sosmed",
    "media sosial",
    "postingan",
    "feed instagram",
    "spanduk",
  ],
  styles: [
    "bold-block",
    "sunlit-pastel",
    "playful-rounded",
    "warm-editorial",
    "high-contrast-mono",
  ],
  content: `# Social media graphics

Purpose: stop the scroll, deliver one message in under two seconds, even at thumbnail size. Success: readable at 300px wide, one focal point, nothing in the unsafe zones.

## Exact sizes (frame width x height)
- Instagram feed 1080x1350 (4:5), square 1080x1080, Story/Reel/TikTok cover 1080x1920, carousel slides 1080x1350.
- LinkedIn post 1200x1200 or 1200x627 link image; LinkedIn banner 1584x396.
- X post 1600x900, X header 1500x500; Facebook cover 1640x624; YouTube thumbnail 1280x720; YouTube banner 2560x1440 (safe 1546x423 center).
- Pinterest 1000x1500. Open Graph 1200x630.
Use the requested platform, or ask once if unclear. Name the frame with the platform and size.

## Safe zones
Keep text 64px from the edges (feed), and 250px from the top and 340px from the bottom on 1080x1920 stories (UI overlays). Banners: critical content in the center third.

## Workflow
1. Decide the one message and the one action. Choose a style, set variables (accent, bg, text, one display font).
2. find_empty_space at the real size; for carousels place slides in a row with gap 80.
3. Build the Post Shell as a component (logo corner, handle, page counter) and fill instances.
4. get_screenshot, then look at it again scaled down: still readable? check_layout; fix; focus_nodes.

## Type
Headline 88-140 at 1080 wide (max 8 words, 2-4 lines), supporting text 36-44, handle and labels 28-32. Display font with character, heavy weight, tight line height 1.0-1.1. One headline size per post. Never below 28.

## Layout recipes
- Big statement: headline left-aligned, accent word, small footer row.
- Stat post: number 320+, one line of context, source.
- Quote: quote 72-88, attribution 32, no decorative quote marks stacked.
- Offer/announcement: date or price as the largest element, details small, one CTA label.
- Carousel: slide 1 hook, slides 2-n one point each with a consistent frame and counter, last slide the action. Same grid on every slide.
- Banner: name or message left, visual or pattern right, empty space deliberate.

## Color and imagery
Two colors plus neutral, high contrast, one saturated block of color is better than a gradient. Icons and shapes from the style, no stock-style abstract blobs, no faces or product photos unless provided. No emoji as decoration.

## Copy
In the audience's language, active and specific ("Diskon 30% sampai Jumat", not "Amazing deals"). Never invented numbers, awards or testimonials.

## Bans
Text over busy imagery, five font sizes, tiny handles, centered everything, gradients with glow, drop-shadow text, unreadable thumbnails.`,
  checklist: [
    "Frame has the exact platform size and a name that includes it",
    "A single focal point; message readable when the screenshot is viewed small",
    "Headline 88px or larger on 1080-wide posts; no text under 28px",
    "Text stays inside the safe zones for the platform",
    "Carousel slides share one grid, counter and style",
    "Two colors plus neutrals, text contrast at least 4.5:1",
    "No invented numbers, claims or testimonials; no emoji icons",
    "check_layout is clean and the CTA or next step is clear",
  ],
};
