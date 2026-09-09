<script setup lang="ts">
/** Sign in: email → 6-digit code. No passwords, no OAuth. */
definePageMeta({ layout: "bare" });
useHead({ title: "Sign in" });
const auth = useAuth();
const events = useEvents();
const route = useRoute();
const redirect = computed(() => { const n = route.query.next ?? route.query.redirect; return typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/app"; });

const step = ref<"email" | "code">("email");
const email = ref("");
const code = ref("");
const error = ref<string | null>(null);
const busy = ref(false);
const cooldown = ref(0);
const codeInput = ref<HTMLInputElement | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

watch(() => [auth.ready.value, auth.signedIn.value], ([ready, signedIn]) => { if (ready && signedIn) navigateTo(redirect.value, { replace: true }); }, { immediate: true });

function startCooldown(s = 30) {
  cooldown.value = s;
  if (timer) clearInterval(timer);
  timer = setInterval(() => { cooldown.value -= 1; if (cooldown.value <= 0 && timer) { clearInterval(timer); timer = null; } }, 1000);
}
onUnmounted(() => { if (timer) clearInterval(timer); });

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()));
const digits = computed(() => code.value.replace(/\D/g, "").slice(0, 6));

async function sendCode() {
  error.value = null;
  if (!emailValid.value) { error.value = "Enter a valid email address."; return; }
  busy.value = true;
  const r = await auth.signInWithEmail(email.value.trim());
  busy.value = false;
  if (!r.ok) { error.value = r.error ?? "We couldn't send the code. Check the address and try again."; return; }
  step.value = "code"; code.value = ""; startCooldown();
  await nextTick(); codeInput.value?.focus();
}
async function verify() {
  error.value = null;
  if (digits.value.length < 6) { error.value = "Enter the 6-digit code from the email."; return; }
  busy.value = true;
  const r = await auth.verifyEmailCode(email.value.trim(), digits.value);
  busy.value = false;
  if (!r.ok) { error.value = r.error ?? "That code didn't work. Codes expire after a few minutes — request a new one if needed."; code.value = ""; codeInput.value?.focus(); return; }
  events.track("sign_in", { method: "email_code" });
  await navigateTo(redirect.value, { replace: true });
}
watch(digits, (d) => { if (d.length === 6 && !busy.value) void verify(); });
function onCodeInput(e: Event) { code.value = (e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 6); }
</script>
<template>
  <div class="flex-1 flex flex-col max-w-md mx-auto w-full safe-px">
    <div class="pt-6 flex items-center gap-2">
      <button v-if="step === 'code'" type="button" class="tap -ml-2 grid place-items-center rounded-full hover:bg-surface-2" aria-label="Back" @click="step = 'email'; error = null"><Icon name="chevron-left" :size="24" /></button>
      <NuxtLink v-else to="/welcome" class="tap -ml-2 grid place-items-center rounded-full hover:bg-surface-2" aria-label="Back"><Icon name="chevron-left" :size="24" /></NuxtLink>
      <div class="flex-1" />
      <BrandMark :size="28" />
    </div>

    <div class="flex-1 flex flex-col justify-center py-8 gap-6">
      <div v-if="!auth.configured" class="rounded-card border border-dashed border-line-strong p-4 text-sm text-muted">
        Accounts aren't configured in this build (no Supabase URL). Sign-in is unavailable until the environment is set.
      </div>

      <template v-if="step === 'email'">
        <div class="grid gap-2">
          <h1 class="text-3xl display">Sign in</h1>
          <p class="text-ink-2">No password. We email you a 6-digit code; you stay signed in on this device so studying is never interrupted.</p>
        </div>
        <form class="grid gap-4" novalidate @submit.prevent="sendCode">
          <AppInput v-model="email" type="email" label="Email" placeholder="you@example.com" autocomplete="email" inputmode="email" :error="error" autofocus required />
          <AppButton type="submit" variant="primary" size="lg" block :loading="busy" :disabled="!auth.configured">Email me a code</AppButton>
        </form>
        <p class="text-xs text-muted">New here? The same code creates your account. By continuing you agree to the <NuxtLink to="/legal/terms" class="underline underline-offset-2">terms</NuxtLink> and <NuxtLink to="/legal/privacy" class="underline underline-offset-2">privacy policy</NuxtLink>.</p>
      </template>

      <template v-else>
        <div class="grid gap-2">
          <h1 class="text-3xl display">Check your email</h1>
          <p class="text-ink-2">We sent a 6-digit code to <strong class="text-ink break-all">{{ email }}</strong>. It expires in a few minutes.</p>
        </div>
        <form class="grid gap-4" novalidate @submit.prevent="verify">
          <label class="block">
            <span class="block text-sm font-medium text-ink-2 mb-1.5">Code</span>
            <div class="relative">
              <input
                ref="codeInput" :value="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" autofocus
                aria-label="6-digit code" :aria-invalid="!!error || undefined"
                class="w-full h-16 rounded-2xl border bg-surface text-center text-3xl font-semibold tabular tracking-[0.5em] pl-[0.5em] focus:outline-none focus:ring-2 focus:ring-accent/35 focus:border-accent"
                :class="error ? 'border-danger' : 'border-line'"
                @input="onCodeInput"
              />
              <div class="pointer-events-none absolute inset-x-0 -bottom-1 flex justify-center gap-3" aria-hidden="true">
                <span v-for="n in 6" :key="n" class="h-0.5 w-6 rounded-pill" :class="digits.length >= n ? 'bg-accent' : 'bg-line-strong'" />
              </div>
            </div>
            <span v-if="error" class="block text-sm text-danger mt-2" role="alert">{{ error }}</span>
          </label>
          <AppButton type="submit" variant="primary" size="lg" block :loading="busy" :disabled="digits.length < 6">Verify and continue</AppButton>
        </form>
        <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button type="button" class="tap px-1 text-accent font-medium disabled:text-muted disabled:font-normal" :disabled="cooldown > 0 || busy" @click="sendCode">{{ cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code' }}</button>
          <button type="button" class="tap px-1 text-muted hover:text-ink" @click="step = 'email'; code = ''; error = null">Use a different email</button>
        </div>
        <p class="text-xs text-muted">Nothing arrived? Check spam, and make sure the address is spelled right. On the web the email may also contain a sign-in link; tapping it works too.</p>
      </template>
    </div>
  </div>
</template>
