import type { KeyboardEvent } from "react";

const NAV_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];

/**
 * Arrow/Home/End focus movement across `[data-nav]` elements inside the event's container
 * (menu rows, the model search input, model options). Disabled items are skipped.
 */
export const navigateList = (event: KeyboardEvent<HTMLElement>): void => {
  if (!NAV_KEYS.includes(event.key)) return;
  const target = event.target as HTMLElement;
  // Home/End keep their text-editing meaning inside the search field.
  if ((event.key === "Home" || event.key === "End") && target instanceof HTMLInputElement) return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[data-nav]:not(:disabled)"),
  );
  if (items.length === 0) return;
  const current = items.indexOf(target.closest<HTMLElement>("[data-nav]") as HTMLElement);
  const last = items.length - 1;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowDown"
          ? current < 0 || current === last
            ? 0
            : current + 1
          : current <= 0
            ? last
            : current - 1;
  event.preventDefault();
  items[next]?.focus();
};
