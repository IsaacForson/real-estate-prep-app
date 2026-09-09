/**
 * Shared open/closed state for the one navigation surface (components/AppPanel.vue) and the state
 * picker it hands off to.
 *
 * The app has no tab bar and no sidebar, so "navigate" is an overlay any screen can raise rather
 * than chrome that is always on screen. Keeping the flags in `useState` means the study loop, the
 * slim header on secondary screens and the layouts all drive the same panel.
 */
export function useAppPanel() {
  const open = useState<boolean>("panel.open", () => false);
  const statePicker = useState<boolean>("panel.statePicker", () => false);

  function show() { open.value = true; }
  function hide() { open.value = false; }
  /** From inside the panel: swap it for the state picker so the two never stack. */
  function pickState() { open.value = false; statePicker.value = true; }

  return { open, statePicker, show, hide, pickState };
}

/**
 * Routes the study loop owns outright: they draw their own header and no shell chrome appears.
 * `/app` is the loop itself; a mock run is a timed exam and must not offer a way out by accident.
 */
/** Mock runner is always full-screen; the practice loop only on native (web keeps the shell header with title + back). */
export function isImmersivePath(path: string, native = false): boolean {
  return /^\/app\/mocks\/run/.test(path) || (native && /^\/app\/practice/.test(path));
}

const SCREEN_TITLES: Array<[RegExp, string]> = [
  [/^\/app\/mocks/, "Mock exam"],
  [/^\/app\/practice/, "Practice"],
  [/^\/app$/, "Home"],
  [/^\/app\/review/, "Review"],
  [/^\/app\/study/, "Progress"],
  [/^\/app\/glossary/, "Glossary"],
  [/^\/app\/account/, "Account"],
];

/** Header title for a secondary app screen. Kept here so both layouts agree. */
export function appScreenTitle(path: string): string {
  return SCREEN_TITLES.find(([re]) => re.test(path))?.[1] ?? "CitePass";
}
