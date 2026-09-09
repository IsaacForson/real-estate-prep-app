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
  /**
   * Open the state sheet. Closing the menu in the same tap used to land that tap on the new
   * sheet's backdrop and instantly dismiss it — wait a beat so the click is finished first.
   */
  function pickState() {
    open.value = false;
    const openPicker = () => { statePicker.value = true; };
    if (import.meta.client) window.setTimeout(openPicker, 80);
    else openPicker();
  }

  return { open, statePicker, show, hide, pickState };
}

/**
 * Timed mock runner only. Practice, review and the rest of `/app/**` keep the shell header so
 * there is always a back arrow off the screen — including on the phone, where practice used to
 * hide the shell and show the logo instead.
 */
export function isImmersivePath(path: string, _native = false): boolean {
  return /^\/app\/mocks\/run/.test(path);
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
