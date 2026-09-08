import { defineStore } from "pinia";

export type Theme = "system" | "light" | "dark";

export interface SettingsState {
  jurisdiction: string;
  licenseLevel: "salesperson" | "broker";
  examDate: string | null;
  theme: Theme;
  narrationRate: number;
  autoAdvance: boolean;
  sharingNoticeAck: boolean;
  sessionSize: number;
}

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
    set<K extends keyof SettingsState>(key: K, value: SettingsState[K]) { (this.$state as SettingsState)[key] = value; this.persist(); },
    persist() { try { localStorage.setItem("rep-settings", JSON.stringify(this.$state)); } catch {} },
    restore() { try { const raw = localStorage.getItem("rep-settings"); if (raw) this.$patch(JSON.parse(raw)); } catch {} },
  },
});
