/**
 * Legacy settings store, kept so pages not yet rewritten keep compiling and reading the same keys.
 * Since V2 every learner-scoped value (jurisdiction, exam date, narration, …) lives on the server
 * (`study_state`, via useStudyState / lib/state/repo.ts) and this store only MIRRORS it (patched by
 * useRepo on every change). The one thing that stays on the device is `theme`.
 */
import { defineStore } from "pinia";
import type { StudySettings } from "~~/lib/state/types";

export type Theme = "system" | "light" | "dark";

export interface SettingsState extends StudySettings {
  theme: Theme;
}

const THEME_KEY = "rep-theme";

export const useSettings = defineStore("settings", {
  state: (): SettingsState => ({
    jurisdiction: "",                      // e.g. "FL"
    licenseLevel: "salesperson",
    examDate: null,                        // ISO date
    theme: "system",
    narrationRate: 1,                      // 0.75–2.5
    autoAdvance: false,
    sharingNoticeAck: false,
    sessionSize: 20,
  }),
  getters: {
    stateBank: (s) => (s.jurisdiction ? `state_${s.jurisdiction}` : null),
  },
  actions: {
    /** theme → device; everything else → server-backed study state (the mirror updates this store). */
    set<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
      if (key === "theme") {
        this.theme = value as Theme;
        this.persist();
        return;
      }
      (this.$state as SettingsState)[key] = value; // optimistic, so the UI updates on this tick
      void useStudyState().set({ [key]: value } as Partial<StudySettings>);
    },
    persist() { try { localStorage.setItem(THEME_KEY, this.theme); } catch {} },
    restore() {
      try {
        const t = localStorage.getItem(THEME_KEY);
        if (t === "light" || t === "dark" || t === "system") this.theme = t;
        else {
          // pre-V2 builds kept everything in one blob; salvage only the theme, drop the rest
          const raw = localStorage.getItem("rep-settings");
          if (raw) { const old = JSON.parse(raw) as { theme?: Theme }; if (old.theme) this.theme = old.theme; localStorage.removeItem("rep-settings"); }
        }
      } catch {}
    },
  },
});
