<script setup lang="ts">
import { JURISDICTIONS } from "@rep/schema";
import { pushToast } from "~/components/Toast.vue";
/** Account: identity, entitlement, study settings, devices, appearance, reviews, help, redeem, sign out. */
useHead({ title: "Account" });
const auth = useAuth();
const entitlement = useEntitlement();
const devices = useDevices();
const studyState = useStudyState();
const settings = useSettings();
const reviews = useReviews();
const coupons = useCoupons();
const free = useFreeTier();

const picker = ref(false);
const dateSheet = ref(false);
const rateSheet = ref(false);
const redeemSheet = ref(false);
const signOutSheet = ref(false);
const removeId = ref<string | null>(null);
const draftDate = ref(studyState.settings.value?.examDate ?? "");
const rating = ref(0);
const reviewBody = ref("");
const code = ref("");
const busy = ref(false);
const err = ref<string | null>(null);

const jur = computed(() => studyState.settings.value?.jurisdiction ?? null);
const examDate = computed(() => studyState.settings.value?.examDate ?? null);
watch(examDate, (d) => { draftDate.value = d ?? ""; });
const themes = [{ value: "system", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }];
const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

async function chooseState(c: string) { picker.value = false; await studyState.set({ jurisdiction: c }); }
async function saveDate() { await studyState.set({ examDate: draftDate.value || null }); dateSheet.value = false; }
async function setLevel(v: string) { await studyState.set({ licenseLevel: v as "salesperson" | "broker" }); }
async function submitReview() {
  if (!rating.value) { err.value = "Pick a star rating."; return; }
  busy.value = true; err.value = null;
  const r = await reviews.submit(rating.value, reviewBody.value.trim());
  busy.value = false;
  if (!r.ok) { err.value = r.error ?? "Couldn't submit. Try again."; return; }
  rateSheet.value = false; pushToast("Thank you — your review is in the queue.", "ok");
}
async function redeem() {
  busy.value = true; err.value = null;
  const r = await coupons.redeem(code.value.trim().toUpperCase());
  busy.value = false;
  if (!r.ok) { err.value = r.error ?? "That code isn't valid."; return; }
  redeemSheet.value = false; code.value = "";
  await entitlement.refresh();
  pushToast(r.product === "complete" ? "Complete unlocked. Everything is yours." : "Code applied.", "ok");
}
async function removeDevice() { if (!removeId.value) return; busy.value = true; await devices.remove(removeId.value); busy.value = false; removeId.value = null; }
async function signOut() { await auth.signOut(); await navigateTo("/welcome", { replace: true }); }
watch(() => auth.user.value?.id, (id) => { if (id) { void entitlement.load(); void devices.refresh(); } }, { immediate: true });
onMounted(() => { void free.load(); });
</script>
<template>
  <div class="anim-fade-up grid gap-4">
    <!-- Identity and entitlement first: the two things people open this screen to check. -->
    <AppCard>
      <div class="flex items-center gap-3.5">
        <span class="grid size-12 shrink-0 place-items-center rounded-full bg-accent-soft text-[19px] font-semibold uppercase text-accent">
          {{ auth.user.value?.email?.[0] ?? '?' }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[15px] font-semibold">{{ auth.user.value?.email ?? 'Signed in' }}</p>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <Badge :tone="entitlement.isComplete.value ? 'ok' : 'neutral'">{{ entitlement.isComplete.value ? 'Complete' : 'Free tier' }}</Badge>
            <Badge v-if="entitlement.hasGuarantee.value" tone="accent">Pass guarantee</Badge>
            <Badge v-if="entitlement.isAdmin.value" tone="warn">Admin</Badge>
          </div>
        </div>
      </div>

      <p v-if="free.applies.value && auth.ready.value" class="mt-3.5 border-t border-line pt-3.5 text-[13.5px] leading-relaxed text-ink-2">
        <strong class="tabular font-semibold text-ink">{{ free.remaining.value }}</strong> free questions left<template v-if="free.jurisdiction.value"> in {{ free.jurisdiction.value }}</template>.
        <NuxtLink to="/pricing" class="font-medium text-accent hover:underline hover:underline-offset-4">Unlock everything — $59 once.</NuxtLink>
      </p>
      <p v-else-if="entitlement.isComplete.value" class="mt-3.5 border-t border-line pt-3.5 text-[13px] text-muted">
        All 51 jurisdictions, both national banks, every mock. Forever.
      </p>
    </AppCard>

    <AppCard title="Study settings" padding="none">
      <ListRow
        icon="map"
        label="Home state"
        :value="jur ? (JURISDICTIONS[jur as keyof typeof JURISDICTIONS] ?? jur) : 'Not set'"
        @click="picker = true"
      />
      <ListRow
        icon="calendar"
        label="Exam date"
        :value="examDate ? new Date(examDate + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set'"
        @click="dateSheet = true"
      />
      <div class="flex min-h-14 items-center gap-3 px-4">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2"><Icon name="shield" :size="17" /></span>
        <span class="flex-1 text-[15px] font-medium">License level</span>
        <AppTabs
          :model-value="studyState.settings.value?.licenseLevel ?? 'salesperson'"
          :tabs="[{ value: 'salesperson', label: 'Salesperson' }, { value: 'broker', label: 'Broker' }]"
          aria-label="License level"
          class="!w-auto shrink-0"
          @update:model-value="setLevel"
        />
      </div>
    </AppCard>

    <AppCard title="Appearance" padding="none">
      <div class="flex min-h-14 items-center gap-3 px-4">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
          <Icon :name="settings.theme === 'dark' ? 'moon' : settings.theme === 'light' ? 'sun' : 'monitor'" :size="17" />
        </span>
        <span class="flex-1 text-[15px] font-medium">Theme</span>
        <AppTabs
          :model-value="settings.theme"
          :tabs="themes"
          aria-label="Theme"
          class="!w-auto shrink-0"
          @update:model-value="(v) => settings.set('theme', v as 'system' | 'light' | 'dark')"
        />
      </div>
    </AppCard>

    <AppCard
      title="Signed in on"
      subtitle="One device at a time. Signing in somewhere else moves your account there and signs this one out."
      padding="none"
    >
      <p v-if="devices.error.value" class="mx-4 mb-3.5 text-[13px] text-danger">{{ devices.error.value }}</p>

      <div v-if="devices.current.value" class="flex min-h-14 items-center gap-3 border-t border-line px-4">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
          <Icon :name="devices.current.value.platform === 'web' ? 'monitor' : 'device'" :size="17" />
        </span>
        <span class="min-w-0 flex-1 py-2.5">
          <span class="flex items-center gap-2">
            <span class="truncate text-[15px] font-medium">{{ devices.current.value.name ?? devices.current.value.platform }}</span>
            <Badge v-if="devices.isThisDevice(devices.current.value.id)" tone="accent">this device</Badge>
          </span>
          <span class="mt-0.5 block text-[11.5px] text-muted">
            {{ devices.current.value.platform }} · last seen {{ fmt(devices.current.value.last_seen) }}
          </span>
        </span>
        <AppButton
          v-if="!devices.isThisDevice(devices.current.value.id)"
          size="xs"
          variant="ghost"
          @click="removeId = devices.current.value.id"
        >Sign out</AppButton>
      </div>
      <p v-else-if="!devices.loading.value" class="border-t border-line px-4 pb-4 pt-3.5 text-[13px] text-muted">This device isn't registered yet.</p>
      <Skeleton v-else class="mx-4 mb-4" height="3rem" />
    </AppCard>

    <AppCard padding="none">
      <ListRow icon="star" label="Rate the app" detail="Approved reviews appear on our site" @click="rateSheet = true" />
      <ListRow icon="help" label="Help Center" detail="Search answers or ask" to="/help" />
      <ListRow icon="message" label="Contact us" detail="We answer every ticket" to="/help/contact" />
      <ListRow icon="gift" label="Redeem a code" detail="Gift or discount code" @click="redeemSheet = true" />
      <ListRow icon="tag" label="Pricing" to="/pricing" />
    </AppCard>

    <AppCard padding="none">
      <ListRow icon="info" label="Methodology" to="/methodology" />
      <ListRow icon="shield" label="Privacy" to="/legal/privacy" />
      <ListRow icon="list" label="Terms" to="/legal/terms" />
      <ListRow icon="logout" label="Sign out" danger @click="signOutSheet = true" />
    </AppCard>

    <p class="px-2 pb-2 text-center text-[11.5px] leading-relaxed text-muted">
      One person per account. Readiness, plan and coverage are computed from one person's answers —
      sharing makes them describe nobody.
    </p>

    <StatePicker :open="picker" :current="jur" @close="picker = false" @select="chooseState" />

    <AppSheet :open="dateSheet" title="Exam date" @close="dateSheet = false">
      <form class="grid gap-3" @submit.prevent="saveDate">
        <AppInput v-model="draftDate" type="date" label="Exam date" hint="The plan schedules a 3-day review buffer before it." />
        <AppButton type="submit" variant="primary" size="lg" block>Save</AppButton>
      </form>
    </AppSheet>

    <AppSheet
      :open="rateSheet"
      title="Rate the app"
      description="Honest reviews help other candidates decide. Approved reviews appear publicly with your state, never your email."
      @close="rateSheet = false"
    >
      <form class="grid gap-4" @submit.prevent="submitReview">
        <div class="flex justify-center gap-1" role="radiogroup" aria-label="Rating">
          <button
            v-for="n in 5"
            :key="n"
            type="button"
            role="radio"
            :aria-checked="rating === n"
            :aria-label="`${n} star${n > 1 ? 's' : ''}`"
            class="tap grid place-items-center rounded-lg transition-transform duration-150 ease-emphasized active:scale-95"
            :class="n <= rating ? 'text-warn' : 'text-line-strong'"
            @click="rating = n"
          ><Icon :name="n <= rating ? 'star-filled' : 'star'" :size="30" /></button>
        </div>
        <AppInput
          v-model="reviewBody"
          multiline
          :rows="4"
          label="What should other candidates know?"
          placeholder="Which state, what helped, what didn't."
          :maxlength="800"
          :error="err"
        />
        <AppButton type="submit" variant="primary" size="lg" block :loading="busy">Submit review</AppButton>
      </form>
    </AppSheet>

    <AppSheet
      :open="redeemSheet"
      title="Redeem a code"
      description="Gift codes unlock Complete immediately. Discount codes apply at web checkout."
      @close="redeemSheet = false; err = null"
    >
      <form class="grid gap-3" @submit.prevent="redeem">
        <AppInput v-model="code" label="Code" placeholder="XXXX-XXXX" autocomplete="off" :error="err" autofocus />
        <AppButton type="submit" variant="primary" size="lg" block :loading="busy" :disabled="code.trim().length < 4">Redeem</AppButton>
      </form>
    </AppSheet>

    <AppSheet
      :open="!!removeId"
      title="Sign out that device?"
      description="Signing in on it again will simply move your account back to it."
      @close="removeId = null"
    >
      <div class="grid gap-2">
        <AppButton variant="danger" size="lg" block :loading="busy" @click="removeDevice">Sign it out</AppButton>
        <AppButton variant="ghost" size="lg" block @click="removeId = null">Cancel</AppButton>
      </div>
    </AppSheet>

    <AppSheet
      :open="signOutSheet"
      title="Sign out?"
      description="Your progress lives on your account, not this device. Sign back in any time with an email code."
      @close="signOutSheet = false"
    >
      <div class="grid gap-2">
        <AppButton variant="danger" size="lg" block @click="signOut">Sign out</AppButton>
        <AppButton variant="ghost" size="lg" block @click="signOutSheet = false">Stay signed in</AppButton>
      </div>
    </AppSheet>
  </div>
</template>
