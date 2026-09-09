<script setup lang="ts">
/**
 * Admin console shell (web only, client-rendered). Sidebar navigation, a top bar with user search
 * and a way back to the learner app, and the shared confirm dialog + toasts. The access guard runs
 * here as well as in each page so a direct deep-link never shows admin chrome to a non-admin.
 */
const route = useRoute();
const router = useRouter();
const auth = useAuth();
const { access, requireAdmin } = useAdmin();
const settings = useSettings();

const nav = [
  { to: "/admin", label: "Overview", icon: "◫" },
  { to: "/admin/users", label: "Users", icon: "◉" },
  { to: "/admin/sales", label: "Sales", icon: "◆" },
  { to: "/admin/support", label: "Support", icon: "◌" },
  { to: "/admin/reviews", label: "Reviews", icon: "★" },
  { to: "/admin/coupons", label: "Coupons", icon: "⌗" },
  { to: "/admin/devices", label: "Devices", icon: "▣" },
  { to: "/admin/content", label: "Content", icon: "≡" },
  { to: "/admin/audit", label: "Audit", icon: "⧗" },
];
const isActive = (to: string) => (to === "/admin" ? route.path === "/admin" : route.path.startsWith(to));

const search = ref(typeof route.query.q === "string" ? route.query.q : "");
function submitSearch() {
  const q = search.value.trim();
  void router.push({ path: "/admin/users", query: q ? { q } : {} });
}
const themes = ["system", "light", "dark"] as const;
function cycleTheme() { settings.set("theme", themes[(themes.indexOf(settings.theme) + 1) % themes.length]!); }

onMounted(() => { void requireAdmin(); });
</script>
<template>
  <div class="min-h-screen bg-bg text-ink lg:grid lg:grid-cols-[220px_1fr]">
    <aside class="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
      <div class="flex items-center gap-2 px-4 py-4">
        <span class="inline-flex size-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-ink" aria-hidden="true">A</span>
        <div>
          <div class="text-sm font-semibold leading-tight">Admin console</div>
          <div class="text-xs text-muted">Real Estate Exam Prep</div>
        </div>
      </div>
      <nav class="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:pb-0" aria-label="Admin sections">
        <NuxtLink
          v-for="n in nav"
          :key="n.to"
          :to="n.to"
          class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink no-underline hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
          :class="isActive(n.to) ? 'bg-surface-2 font-semibold' : 'text-muted'"
          :aria-current="isActive(n.to) ? 'page' : undefined"
        >
          <span class="w-4 text-center text-xs" aria-hidden="true">{{ n.icon }}</span>{{ n.label }}
        </NuxtLink>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-col">
      <header class="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <form class="flex min-w-[220px] flex-1 items-center gap-2" role="search" @submit.prevent="submitSearch">
          <label for="admin-search" class="sr-only">Search users</label>
          <input id="admin-search" v-model="search" type="search" placeholder="Search users by email or id…" class="w-full max-w-md !py-1.5 text-sm" autocomplete="off" />
          <button type="submit" class="!px-3 !py-1.5 text-sm">Search</button>
        </form>
        <span v-if="auth.user.value?.email" class="hidden text-xs text-muted md:inline">{{ auth.user.value.email }}</span>
        <button type="button" class="!px-2.5 !py-1.5 text-sm" :title="`Theme: ${settings.theme}`" aria-label="Cycle theme" @click="cycleTheme">{{ settings.theme === 'dark' ? '🌙' : settings.theme === 'light' ? '☀️' : '🌗' }}</button>
        <NuxtLink to="/app" class="rounded-lg border border-line px-3 py-1.5 text-sm text-ink no-underline hover:bg-surface-2">← Back to app</NuxtLink>
      </header>

      <main class="min-w-0 flex-1 p-4 lg:p-6">
        <ClientOnly>
          <div v-if="access === 'unconfigured'" class="notice">
            This build has no <code>NUXT_PUBLIC_SUPABASE_URL</code>, so there is no admin backend to talk to.
          </div>
          <div v-else-if="access === 'denied'" class="notice">This account is not an admin. Redirecting…</div>
          <div v-else-if="access === 'checking'" class="flex items-center gap-2 text-sm text-muted" aria-busy="true">
            <span class="inline-block size-3 animate-pulse rounded-full bg-accent" aria-hidden="true" />Checking access…
          </div>
          <slot v-else />
          <template #fallback>
            <div class="text-sm text-muted">Loading console…</div>
          </template>
        </ClientOnly>
      </main>
    </div>

    <AdminConfirmDialog />
    <AdminToasts />
  </div>
</template>
