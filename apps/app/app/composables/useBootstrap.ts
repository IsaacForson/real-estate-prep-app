/**
 * Wires the app together once, from app.vue's setup (V2 §4, §6.1):
 *  - registers the signed-in hooks useAuth.init() runs BEFORE `ready` flips: device hash →
 *    entitlement + study-state hydrate (in parallel) → free tier → purchases → events
 *  - registers the signed-out hook (flush events, forget purchases identity)
 *  - theme (device-local) and the sync lifecycle
 * Everything here captures composable state at setup time so the hooks never call composables
 * from async continuations.
 */
import { onSignedIn, onSignedOut } from "~~/lib/state/hooks";

let registered = false;

export function useBootstrap() {
  const auth = useAuth();
  const device = useDevice();
  const entitlement = useEntitlement();
  const studyState = useStudyState();
  const { repo } = useRepo();
  const freeTier = useFreeTier();
  const events = useEvents();
  const sync = useSync();
  const purchases = usePurchases();
  const settings = useSettings();
  const contentEpoch = useContentEpoch();
  const nuxtApp = useNuxtApp();

  function applyTheme() {
    if (!import.meta.client) return;
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }

  if (!registered && import.meta.client) {
    registered = true;
    onSignedIn(async ({ uid, event }) => {
      await device.ensure();
      await Promise.all([entitlement.load(), repo.hydrate(uid)]);
      studyState.ready.value = true;
      // the home state chosen before sign-in (or on another device) scopes the free tier server-side
      const j = repo.settings().jurisdiction;
      if (j) void entitlement.setHomeJurisdiction(j);
      const p = entitlement.profile.value;
      if (p?.sharing_notice_ack && !repo.settings().sharingNoticeAck) void studyState.set({ sharingNoticeAck: true });
      else if (repo.settings().sharingNoticeAck && p && !p.sharing_notice_ack) void entitlement.ackSharingNotice();
      if (!p?.exam_date && repo.settings().examDate) void entitlement.setExamDate(repo.settings().examDate);
      await freeTier.load();
      // an admin may have republished items since this device last looked; off the critical path
      void contentEpoch.check().catch(() => {});
      // seed the item cache with one national batch so the first Study tap is instant (V2 "never an
      // empty screen"); composables need the nuxt context, which this async continuation lacks
      if (j) void nuxtApp.runWithContext(() => useStudy().seedCache()).catch(() => {});
      if (purchases.supported.value) void purchases.configure(uid).catch(() => {});
      events.track(event === "sign_in" ? "sign_in" : "app_open", { restored: event === "init" });
      sync.schedule(1000);
    });
    onSignedOut(async (reason) => {
      events.track("sign_out", { reason });
      await events.flush().catch(() => {});
      studyState.ready.value = false;
    });
  }

  /** Called from app.vue onMounted. */
  async function start(): Promise<void> {
    settings.restore();
    applyTheme();
    watch(() => settings.theme, applyTheme);
    if (!auth.configured) {
      // static dev mode: no accounts; the repo is a local store and study state is "ready" at once
      await repo.open();
      studyState.ready.value = true;
      events.track("app_open", { restored: false, mode: "static" });
    }
    await auth.init();
    sync.start();
    if (auth.user.value && purchases.supported.value) void purchases.configure(auth.user.value.id).catch(() => {});
  }

  return { start, applyTheme };
}
