import type { IconName } from "~/components/Icon.vue";

export interface AppNavRow { to: string; label: string; hint: string; icon: IconName; count?: number | null }

/** The app's sections, named for someone who has never used an exam-prep app. Shared by the menu and Home. */
export function useAppNav(opts: { due?: number | null; includeHome?: boolean } = {}): AppNavRow[] {
  const rows: AppNavRow[] = [
    { to: "/app", label: "Home", hint: "Your readiness at a glance and where to go next", icon: "home" },
    { to: "/app/practice", label: "Practice", hint: "One question at a time, with the answer, explanation and law reference", icon: "play" },
    { to: "/app/mocks", label: "Mock exam", hint: "Timed, real exam format. No explanations until you finish", icon: "clock" },
    { to: "/app/review", label: "Review", hint: "Missed questions and the ones due for repetition", icon: "refresh", count: opts.due ?? null },
    { to: "/app/study", label: "Progress", hint: "Readiness score and coverage by exam section", icon: "target" },
    { to: "/app/glossary", label: "Glossary", hint: "Key terms with the statute behind each", icon: "book" },
    { to: "/app/account", label: "Account", hint: "Plan, devices, exam date and settings", icon: "user" },
  ];
  return opts.includeHome === false ? rows.filter((r) => r.to !== "/app") : rows;
}
