<script setup lang="ts">
/**
 * Account: sign in / out, entitlement, the one-person notice (SPEC §5.2), devices with
 * self-service removal and the 7-day cooldown (SPEC §5.3), sync status.
 */
useHead({ title: "Account" });
const auth = useAuth();
const entitlement = useEntitlement();
const devices = useDevices();
const sync = useSync();
const settings = useSettings();
const freeTier = useFreeTier();
const mode = useAppMode();

const email = ref("");
const sent = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);
const removing = ref<string | null>(null);

async function magicLink() {
  error.value = null; busy.value = true;
  const r = await auth.signInWithEmail(email.value.trim());
  busy.value = false;
  if (r.ok) sent.value = true; else error.value = r.error ?? "Could not send the link.";
}
async function oauth(p: "apple" | "google") {
  error.value = null;
  const r = await auth.signInWithOAuth(p);
  if (!r.ok) error.value = r.error ?? "Sign-in failed.";
}
async function ack() {
  settings.set("sharingNoticeAck", true);
  await entitlement.ackSharingNotice();
}
async function removeDevice(id: string) {
  const mine = devices.isThisDevice(id);
  if (!confirm(mine ? "Remove this device? You will be signed out here and the slot stays used for 7 days." : "Remove this device? Its slot stays used for 7 days.")) return;
  removing.value = id;
  await devices.remove(id);
  removing.value = null;
}
const fmt = (s: string | number | null | undefined) => (s ? new Date(s).toLocaleString() : "—");
const fmtDay = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

watch(() => auth.user.value?.id, (id) => { if (id) { void entitlement.load(); void devices.refresh(); } }, { immediate: true });
onMounted(() => { void freeTier.load(); });
</script>
<template>
  <div>
    <h1>Account</h1>

    <div v-if="mode === 'static'" class="notice">
      This build runs in <strong>static dev mode</strong> (no <code>NUXT_PUBLIC_SUPABASE_URL</code>): no accounts, no sync, questions come from the local content file. Set the Supabase variables to enable sign-in.
    </div>

    <template v-else-if="!auth.ready.value">
      <p class="muted">Loading…</p>
    </template>

    <template v-else-if="!auth.signedIn.value">
      <div class="card">
        <h2>Sign in</h2>
        <p class="muted">No password. We email you a link; sessions stay signed in so studying is never interrupted.</p>
        <form v-if="!sent" class="row" @submit.prevent="magicLink">
          <input v-model="email" type="email" required placeholder="you@example.com" autocomplete="email" style="flex:1;min-width:220px" />
          <button class="primary" type="submit" :disabled="busy || !email">Email me a link</button>
        </form>
        <p v-else class="notice">Check <strong>{{ email }}</strong> for your sign-in link. You can close this tab.</p>
        <div class="row" style="margin-top:12px">
          <button @click="oauth('apple')"> Continue with Apple</button>
          <button @click="oauth('google')">Continue with Google</button>
        </div>
        <p v-if="error" class="muted" style="color:var(--red)">{{ error }}</p>
      </div>
      <div class="card">
        <h2>Studying without an account</h2>
        <p class="muted">Everything you answer is saved on this device. The free tier covers {{ freeTier.total }} questions in one state and one short mock — <strong>{{ freeTier.remaining.value }}</strong> left<template v-if="freeTier.state.value.jurisdiction"> in {{ freeTier.state.value.jurisdiction }}</template>. <NuxtLink to="/pricing">Complete</NuxtLink> is $59 once, forever.</p>
      </div>
    </template>

    <template v-else>
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div>
            <strong>{{ auth.user.value?.email ?? 'Signed in' }}</strong>
            <div class="muted" style="font-size:14px">
              <span class="pill" :class="entitlement.isComplete.value ? 'green' : ''">{{ entitlement.isComplete.value ? 'Complete' : 'Free tier' }}</span>
              <span v-if="entitlement.hasGuarantee.value" class="pill green" style="margin-left:6px">Pass guarantee</span>
              <span v-if="entitlement.entitlement.value.fetchedAt" style="margin-left:8px">checked {{ fmt(entitlement.entitlement.value.fetchedAt) }}</span>
            </div>
          </div>
          <button @click="auth.signOut()">Sign out</button>
        </div>
        <p v-if="!entitlement.isComplete.value" class="muted" style="margin-bottom:0">
          Free tier: {{ freeTier.remaining.value }} of {{ freeTier.total }} questions left<template v-if="entitlement.profile.value?.home_jurisdiction"> · home state {{ entitlement.profile.value.home_jurisdiction }}</template>. <NuxtLink to="/pricing">Unlock everything — $59 once.</NuxtLink>
        </p>
        <p v-else class="muted" style="margin-bottom:0">All 51 jurisdictions, both national banks, every mock. Forever.</p>
      </div>

      <div class="card">
        <h2>One person per account</h2>
        <p class="muted">Your readiness score assumes one person is answering. Sharing this account will make it inaccurate — the schedule, weak-topic diagnostics and readiness are all computed from one person's answers.</p>
        <p v-if="entitlement.profile.value?.sharing_notice_ack || settings.sharingNoticeAck" class="muted" style="margin-bottom:0">✓ Acknowledged</p>
        <button v-else @click="ack">Got it</button>
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">Devices</h2>
          <button @click="devices.refresh()" :disabled="devices.loading.value">Refresh</button>
        </div>
        <p class="muted">Up to 3 active devices. Removing one frees its slot after a 7-day cooldown. Signing in on a new device signs out the others (one active session per account).</p>
        <div v-if="auth.deviceLimit.value" class="notice">
          This account already has {{ auth.deviceLimit.value.max }} devices, so this one isn't registered yet<template v-if="auth.deviceLimit.value.nextSlotFreesAt"> — the next slot frees on {{ fmt(auth.deviceLimit.value.nextSlotFreesAt) }}</template>. Remove a device below, then <button @click="auth.registerDevice()" :disabled="auth.busy.value">register this device</button>.
        </div>
        <p v-if="devices.error.value" class="muted" style="color:var(--red)">{{ devices.error.value }}</p>
        <table v-if="devices.devices.value.length">
          <thead><tr><th>Device</th><th>Last seen</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="d in devices.devices.value" :key="d.id">
              <td>{{ d.name ?? d.platform }} <span class="muted" style="font-size:13px">({{ d.platform }})</span><span v-if="devices.isThisDevice(d.id)" class="pill" style="margin-left:6px">this device</span></td>
              <td>{{ fmt(d.last_seen) }}</td>
              <td>
                <span v-if="d.active" class="pill" :class="d.has_live_session ? 'green' : ''">{{ d.has_live_session ? 'active session' : 'registered' }}</span>
                <span v-else-if="d.cooling_down" class="pill yellow">slot busy until {{ fmtDay(d.cooldown_until) }}</span>
                <span v-else class="pill">removed</span>
              </td>
              <td style="text-align:right"><button v-if="d.active" :disabled="removing === d.id" @click="removeDevice(d.id)">Remove</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="!devices.loading.value" class="muted">No devices registered yet.</p>
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">Sync</h2>
          <button @click="sync.syncNow()" :disabled="sync.state.value.syncing">{{ sync.state.value.syncing ? 'Syncing…' : 'Sync now' }}</button>
        </div>
        <p class="muted" style="margin-bottom:0">
          Progress is saved on this device first and synced in the background. Last sync: {{ fmt(sync.state.value.lastSyncAt) }}<template v-if="sync.state.value.pending"> · changes waiting</template>.
          <span v-if="sync.state.value.error" style="color:var(--red)"> Last attempt failed: {{ sync.state.value.error }}</span>
        </p>
      </div>
    </template>
  </div>
</template>
