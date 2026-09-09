<script setup lang="ts">
/** Sign in: email → 6-digit code. No passwords, no OAuth. */
definePageMeta({ layout: "bare" });
useHead({ title: "Sign in" });
const auth = useAuth();
const events = useEvents();
const route = useRoute();
const redirect = computed(() => { const n = route.query.next ?? route.query.redirect; return typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/app"; });

/**
 * Getting out of here.
 *
 * This page uses the `bare` layout, so there is no site nav. Sending people `history.back()` looks
 * polite and is how they get stuck: "Start free" on the landing page goes through /welcome, so Back
 * returns to the carousel, whose only prominent button is Sign in again. The landing page is the
 * one place they asked to return to, so both the labelled control and the logo go there on purpose.
 */
function goHome() {
  void navigateTo("/");
}

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
  <div class="safe-px mx-auto flex w-full max-w-md flex-1 flex-col">
    <div class="flex items-center gap-2 pt-6">
      <button
        v-if="step === 'code'"
        type="button"
        class="tap -ml-2.5 grid place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        aria-label="Back"
        @click="step = 'email'; error = null"
      ><Icon name="chevron-left" :size="22" /></button>
      <!-- labelled, because an icon on its own read as decoration and left people stuck here -->
      <button
        v-else
        type="button"
        class="tap -ml-2.5 flex items-center gap-1 rounded-full pr-3 text-[14px] font-bold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        @click="goHome"
      ><Icon name="chevron-left" :size="20" /><span>Home</span></button>
      <div class="flex-1" />
      <NuxtLink to="/" aria-label="CitePass home" class="tap grid place-items-center rounded-lg"><BrandMark :size="28" /></NuxtLink>
    </div>

    <div class="flex flex-1 flex-col justify-center gap-7 py-8">
      <div v-if="!auth.configured" class="rounded-card border border-dashed border-line-strong p-4 text-[13px] leading-relaxed text-muted">
        Accounts aren't configured in this build (no Supabase URL). Sign-in is unavailable until the
        environment is set.
      </div>

      <template v-if="step === 'email'">
        <div class="grid gap-2.5">
          <h1 class="display text-[32px]">Sign in</h1>
          <p class="text-[15px] leading-relaxed text-ink-2">
            No password. We email you a 6-digit code; you stay signed in on this device so studying is
            never interrupted.
          </p>
        </div>
        <form class="grid gap-4" novalidate @submit.prevent="sendCode">
          <AppInput
            v-model="email"
            type="email"
            label="Email"
            placeholder="you@example.com"
            autocomplete="email"
            inputmode="email"
            :error="error"
            autofocus
            required
          />
          <AppButton type="submit" variant="primary" size="lg" block :loading="busy" :disabled="!auth.configured">Email me a code</AppButton>
        </form>
        <p class="text-[12px] leading-relaxed text-muted">
          New here? The same code creates your account. By continuing you agree to the
          <NuxtLink to="/legal/terms" class="underline underline-offset-4 hover:text-ink-2">terms</NuxtLink>
          and
          <NuxtLink to="/legal/privacy" class="underline underline-offset-4 hover:text-ink-2">privacy policy</NuxtLink>.
        </p>
      </template>

      <template v-else>
        <div class="grid gap-2.5">
          <h1 class="display text-[32px]">Check your email</h1>
          <p class="text-[15px] leading-relaxed text-ink-2">
            We sent a 6-digit code to <strong class="break-all font-semibold text-ink">{{ email }}</strong>.
            It expires in a few minutes.
          </p>
        </div>

        <form class="grid gap-4" novalidate @submit.prevent="verify">
          <!-- One wide input rather than six boxes: it keeps paste and the OTP autofill working, and
               the underline ticks give the same "how many digits left" read. -->
          <label class="block">
            <span class="mb-2 block text-[13px] font-medium text-ink-2">Code</span>
            <div class="relative">
              <input
                ref="codeInput"
                :value="code"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                pattern="[0-9]*"
                maxlength="6"
                autofocus
                aria-label="6-digit code"
                :aria-invalid="!!error || undefined"
                class="tabular h-16 w-full rounded-panel border bg-surface pl-[0.5em] text-center text-[30px] font-semibold tracking-[0.5em] transition-shadow focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/20"
                :class="error ? 'border-danger' : 'border-line'"
                @input="onCodeInput"
              />
              <div class="pointer-events-none absolute inset-x-0 -bottom-1.5 flex justify-center gap-3" aria-hidden="true">
                <span
                  v-for="n in 6"
                  :key="n"
                  class="h-0.5 w-6 rounded-pill transition-colors"
                  :class="digits.length >= n ? 'bg-accent' : 'bg-line-strong'"
                />
              </div>
            </div>
            <span v-if="error" class="mt-2.5 block text-[13px] text-danger" role="alert">{{ error }}</span>
          </label>
          <AppButton type="submit" variant="primary" size="lg" block :loading="busy" :disabled="digits.length < 6">Verify and continue</AppButton>
        </form>

        <div class="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
          <button
            type="button"
            class="tap px-1 font-medium text-accent disabled:font-normal disabled:text-muted"
            :disabled="cooldown > 0 || busy"
            @click="sendCode"
          >{{ cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code' }}</button>
          <button type="button" class="tap px-1 text-muted transition-colors hover:text-ink" @click="step = 'email'; code = ''; error = null">Use a different email</button>
        </div>

        <p class="text-[12px] leading-relaxed text-muted">
          Nothing arrived? Check spam, and make sure the address is spelled right. On the web the email
          may also contain a sign-in link; tapping it works too.
        </p>
      </template>
    </div>
  </div>
</template>
