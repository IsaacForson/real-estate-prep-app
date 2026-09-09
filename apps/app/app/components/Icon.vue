<script setup lang="ts">
/**
 * Inline SVG icon set (stroke, currentColor). Kept local so the app has no icon-font or binary
 * dependency and every glyph inherits the text colour of its parent.
 */
export type IconName =
  | "home" | "book" | "clock" | "refresh" | "user" | "check" | "x" | "flag" | "flag-filled" | "play" | "pause"
  | "search" | "chevron-right" | "chevron-left" | "chevron-down" | "arrow-right" | "arrow-left" | "spark"
  | "shield" | "quote" | "map" | "moon" | "sun" | "monitor" | "mail" | "help" | "message" | "star" | "star-filled"
  | "tag" | "logout" | "device" | "calendar" | "list" | "target" | "info" | "external" | "plus" | "minus"
  | "skip-back" | "skip-forward" | "volume" | "menu" | "lock" | "gift" | "trophy" | "alert";

withDefaults(defineProps<{ name: IconName; size?: number | string; strokeWidth?: number }>(), { size: 20, strokeWidth: 1.9 });

const paths: Record<IconName, string> = {
  home: "M3 11.5 12 4l9 7.5M5 10v10h14V10",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5ZM4 18.5A2.5 2.5 0 0 1 6.5 16H20",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  refresh: "M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
  check: "m5 12 5 5L20 7",
  x: "M6 6l12 12M18 6 6 18",
  flag: "M5 21V4h13l-2 4 2 4H5",
  "flag-filled": "M5 21V4h13l-2 4 2 4H5",
  play: "M7 5v14l12-7-12-7Z",
  pause: "M7 5h4v14H7zM13 5h4v14h-4z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4",
  "chevron-right": "m9 6 6 6-6 6",
  "chevron-left": "m15 6-6 6 6 6",
  "chevron-down": "m6 9 6 6 6-6",
  "arrow-right": "M4 12h16m-6-6 6 6-6 6",
  "arrow-left": "M20 12H4m6-6-6 6 6 6",
  spark: "M12 3v4m0 10v4m9-9h-4M7 12H3m14.5-6.5-2.8 2.8M9.3 14.7l-2.8 2.8m11 0-2.8-2.8M9.3 9.3 6.5 6.5",
  shield: "M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Zm-3 9 2 2 4-4",
  quote: "M7 7h4v6H8v3H6v-6.5A2.5 2.5 0 0 1 7 7Zm9 0h4v6h-3v3h-2v-6.5A2.5 2.5 0 0 1 16 7Z",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  monitor: "M3 5h18v11H3zM8 20h8m-4-4v4",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.5-11a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .8-1 1.7m0 3h.01",
  message: "M4 5h16v11H9l-5 4V5Z",
  star: "m12 3 2.8 5.9 6.2.8-4.5 4.4 1.1 6.3L12 17.4 6.4 20.4l1.1-6.3L3 9.7l6.2-.8L12 3Z",
  "star-filled": "m12 3 2.8 5.9 6.2.8-4.5 4.4 1.1 6.3L12 17.4 6.4 20.4l1.1-6.3L3 9.7l6.2-.8L12 3Z",
  tag: "M3 3h8l10 10-8 8L3 11V3Zm4 4h.01",
  logout: "M9 21H4V3h5m5 13 5-4-5-4m5 4H9",
  device: "M7 2h10v20H7zM12 18h.01",
  calendar: "M4 5h16v16H4zM4 10h16M8 3v4m8-4v4",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-4h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9v5m0-8h.01",
  external: "M14 4h6v6m0-6-9 9M19 14v6H4V5h6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  "skip-back": "M6 5v14M19 5 8 12l11 7V5Z",
  "skip-forward": "M18 5v14M5 5l11 7-11 7V5Z",
  volume: "M4 10v4h3l4 3V7L7 10H4Zm12-2a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14",
  menu: "M4 7h16M4 12h16M4 17h16",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  gift: "M4 11h16v10H4zM3 7h18v4H3zM12 7v14m0-14c-3 0-4-1-4-2.5S9 2 12 7Zm0 0c3 0 4-1 4-2.5S15 2 12 7Z",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 3m8-3h3a3 3 0 0 1-3 3m-4 4v4m-4 3h8",
  alert: "M12 3 2 21h20L12 3Zm0 7v4m0 4h.01",
};
const filled = new Set<IconName>(["flag-filled", "star-filled", "play"]);
</script>
<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" class="shrink-0">
    <path :d="paths[name]" :fill="filled.has(name) ? 'currentColor' : 'none'" stroke="currentColor" :stroke-width="strokeWidth" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
