<script setup lang="ts">
/**
 * The icon set. Inline SVG on a 24px grid, drawn with round caps and joins at a 1.75 stroke so
 * glyphs stay legible at the 16-20px sizes the UI actually uses. Kept local on purpose: no icon
 * font, no npm dependency, nothing to fetch at runtime (the app ships offline inside Capacitor),
 * and every glyph inherits `currentColor` from its parent.
 *
 * Adding one: put the path in `paths` AND the name in `IconName` — the union is what gives call
 * sites autocomplete and turns a typo into a type error.
 */
export type IconName =
  | "home" | "book" | "book-open" | "clock" | "refresh" | "user" | "users"
  | "check" | "check-circle" | "x" | "x-circle" | "flag" | "flag-filled" | "play" | "pause"
  | "search" | "chevron-right" | "chevron-left" | "chevron-down" | "chevron-up"
  | "arrow-right" | "arrow-left" | "arrow-up-right"
  | "spark" | "shield" | "quote" | "map" | "moon" | "sun" | "monitor" | "mail" | "help" | "message"
  | "star" | "star-filled" | "tag" | "logout" | "device" | "calendar" | "list" | "target" | "info"
  | "external" | "plus" | "minus" | "skip-back" | "skip-forward" | "volume" | "menu" | "lock"
  | "gift" | "trophy" | "alert"
  | "grid" | "dollar" | "ticket" | "history" | "layers" | "filter" | "trash" | "edit" | "eye"
  | "sliders" | "dot" | "bolt";

withDefaults(defineProps<{ name: IconName; size?: number | string; strokeWidth?: number }>(), {
  size: 20,
  strokeWidth: 1.75,
});

const paths: Record<IconName, string> = {
  // navigation + structure
  home: "M3.6 10.8 12 4l8.4 6.8M5.5 9.6V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.6M9.75 20.5v-6h4.5v6",
  grid: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
  menu: "M4 7h16M4 12h16M4 17h16",
  list: "M8.5 6.5h12M8.5 12h12M8.5 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01",
  layers: "m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5ZM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5",
  filter: "M3.5 5.5h17l-6.5 7.5v6l-4 2v-8L3.5 5.5Z",
  sliders: "M4 7h9m4 0h3M4 17h3m4 0h9M15 4.5v5M9 14.5v5",

  // study
  book: "M19.5 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 1 7 15.5h12.5v-12ZM4.5 18A2.5 2.5 0 0 0 7 20.5h12.5",
  "book-open": "M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2ZM12 6.5v13",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-3.5h.01",
  refresh: "M20.5 12a8.5 8.5 0 1 1-2.49-6.01M20.5 4v5h-5",
  history: "M4 12a8 8 0 1 0 2.4-5.7M4 4.5V9h4.5M12 8v4.5l3 1.8",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 1.8",
  calendar: "M4.5 5.5h15v15h-15zM4.5 10h15M8.5 3v4.5M15.5 3v4.5",
  trophy: "M8 3.5h8V9a4 4 0 0 1-8 0V3.5ZM8 5.5H5.2a3 3 0 0 0 2.8 3M16 5.5h2.8a3 3 0 0 1-2.8 3M12 13v3.5M8.5 20.5h7",
  bolt: "M13 3 5.5 13.5H12l-1 7.5 7.5-10.5H12l1-7.5Z",

  // verdicts
  check: "m5 12.5 4.5 4.5L19 7.5",
  "check-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3.6-9.2 2.6 2.6 4.6-4.8",
  x: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  "x-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm2.8-11.8-5.6 5.6m0-5.6 5.6 5.6",
  alert: "M12 3.5 2.5 20.5h19L12 3.5Zm0 6v4.5m0 3.5h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9.5v5m0-8.5h.01",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.4-11.2a2.4 2.4 0 1 1 3.4 2.2c-.7.35-1 .8-1 1.6m0 2.9h.01",
  shield: "M12 3.5 4.75 6.2v5.4c0 4.2 3 7.5 7.25 8.9 4.25-1.4 7.25-4.7 7.25-8.9V6.2L12 3.5Zm-2.9 8.6 2.2 2.2 3.9-4",
  lock: "M6 10.5h12v10H6zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3",

  // marks
  flag: "M5.5 21V4.5h13l-2.5 4.25 2.5 4.25h-13",
  "flag-filled": "M5.5 4.5h13l-2.5 4.25 2.5 4.25h-13zM5.5 4.5V21",
  star: "m12 3.6 2.65 5.55 6.1.85-4.4 4.3 1.05 6.1L12 17.5l-5.4 2.9 1.05-6.1-4.4-4.3 6.1-.85L12 3.6Z",
  "star-filled": "m12 3.6 2.65 5.55 6.1.85-4.4 4.3 1.05 6.1L12 17.5l-5.4 2.9 1.05-6.1-4.4-4.3 6.1-.85L12 3.6Z",
  spark: "M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9 12 3.5Z",
  dot: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  quote:
    "M7.6 16.6c-1.75 0-2.9-1.35-2.9-3.1 0-2.7 1.95-5.35 4.75-6.7l.8 1.55c-1.65.95-2.65 2.25-2.8 3.4.25-.1.55-.15.9-.15 1.45 0 2.5 1.05 2.5 2.5s-1.15 2.5-2.7 2.5Zm8.8 0c-1.75 0-2.9-1.35-2.9-3.1 0-2.7 1.95-5.35 4.75-6.7l.8 1.55c-1.65.95-2.65 2.25-2.8 3.4.25-.1.55-.15.9-.15 1.45 0 2.5 1.05 2.5 2.5s-1.15 2.5-2.7 2.5Z",

  // people + account
  user: "M12 12.5a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5ZM4.5 21a7.5 7.5 0 0 1 15 0",
  users: "M9.5 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2.5 20.5a7 7 0 0 1 14 0M16.5 4.4a4 4 0 0 1 0 7.2M18 13.8a7 7 0 0 1 3.5 6.7",
  logout: "M9.5 20.5h-5v-17h5M14 16.5l4.5-4.5L14 7.5M18.5 12H9",
  device: "M7.5 2.5h9v19h-9zM12 18.5h.01",
  monitor: "M3.5 5.5h17v11h-17zM8.5 20.5h7M12 16.5v4",
  eye: "M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 2.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z",

  // commerce + comms
  dollar: "M12 3v18M16 7.2C15.2 5.8 13.7 5 12 5 9.7 5 8 6.3 8 8.3c0 4.6 8.5 2.3 8.5 7 0 2.2-2 3.7-4.5 3.7-2 0-3.7-.9-4.5-2.4",
  tag: "M3.5 3.5h7.6l9.4 9.4-7.6 7.6-9.4-9.4V3.5Zm3.6 3.6h.01",
  ticket: "M3.5 7h17v3a2 2 0 0 0 0 4v3h-17v-3a2 2 0 0 0 0-4V7ZM12 8v1m0 3v1m0 3v1",
  gift: "M4.5 11.5h15v9h-15zM3.5 7.5h17v4h-17zM12 7.5v13M12 7.5C9.5 7.5 8 6.7 8 5.4S9.2 3.2 12 7.5Zm0 0c2.5 0 4-.8 4-2.1S14.8 3.2 12 7.5Z",
  mail: "M3.5 6.5h17v11h-17zM3.5 7.5l8.5 5.5 8.5-5.5",
  message: "M4.5 5.5h15v11h-9l-6 4.5V5.5Z",

  // media
  play: "M8 5.2v13.6l11-6.8-11-6.8Z",
  pause: "M8.6 5.5h2.3v13H8.6zM13.1 5.5h2.3v13h-2.3z",
  "skip-back": "M6.5 5.5v13M18.5 5.5l-9.5 6.5 9.5 6.5v-13Z",
  "skip-forward": "M17.5 5.5v13M5.5 5.5 15 12l-9.5 6.5v-13Z",
  volume: "M4.5 9.5h3l4.5-3.5v12l-4.5-3.5h-3v-5ZM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11",

  // chrome
  search: "M11 18.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM16.4 16.4 21 21",
  "chevron-right": "m9.5 5.5 6.5 6.5-6.5 6.5",
  "chevron-left": "m14.5 5.5-6.5 6.5 6.5 6.5",
  "chevron-down": "m5.5 9.5 6.5 6.5 6.5-6.5",
  "chevron-up": "m5.5 14.5 6.5-6.5 6.5 6.5",
  "arrow-right": "M3.5 12h17m-6.5-6.5 6.5 6.5-6.5 6.5",
  "arrow-left": "M20.5 12h-17m6.5-6.5L3.5 12l6.5 6.5",
  "arrow-up-right": "M7 17 17 7m0 0H8.5M17 7v8.5",
  external: "M14 4.5h5.5V10M19.5 4.5 12 12M18 14v5.5H4.5v-14H10",
  plus: "M12 4.5v15M4.5 12h15",
  minus: "M4.5 12h15",
  trash: "M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5 7.5 21h9l1-14.5M10 10.5v6m4-6v6",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM14 5l4 4",
  map: "M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13l-5.5 2-6-2Zm0 0v13m6-11v13",
  moon: "M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z",
  sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.5v2m0 15v2M2.5 12h2m15 0h2M5.3 5.3l1.4 1.4m10.6 10.6 1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
};

/** Glyphs that read better as a solid shape than an outline. */
const filled = new Set<IconName>(["flag-filled", "star-filled", "play", "pause", "spark", "dot", "quote", "bolt"]);
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
    class="shrink-0"
  >
    <path
      :d="paths[name]"
      :fill="filled.has(name) ? 'currentColor' : 'none'"
      stroke="currentColor"
      :stroke-width="strokeWidth"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
