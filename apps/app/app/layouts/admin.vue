<script setup lang="ts">
/**
 * Admin console shell (web only, client-rendered). Sidebar navigation, a top bar with user search
 * and a way back to the learner app, and the shared confirm dialog + toasts. The access guard runs
 * here as well as in each page so a direct deep-link never shows admin chrome to a non-admin.
 */
import type { IconName } from "~/components/Icon.vue";
const route = useRoute();
const router = useRouter();
const auth = useAuth();
const { access, requireAdmin } = useAdmin();
const nav: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/admin", label: "Overview", icon: "grid" },
  { to: "/admin/users", label: "Users", icon: "users" },
  { to: "/admin/sales", label: "Sales", icon: "dollar" },
  { to: "/admin/refunds", label: "Refunds", icon: "undo" },
  { to: "/admin/support", label: "Support", icon: "message" },
  { to: "/admin/reviews", label: "Reviews", icon: "star" },
  { to: "/admin/coupons", label: "Coupons", icon: "ticket" },
  { to: "/admin/devices", label: "Devices", icon: "device" },
  { to: "/admin/content", label: "Content", icon: "layers" },
  { to: "/admin/audit", label: "Audit", icon: "history" },
  { to: "/admin/settings", label: "Settings", icon: "sliders" },
];
const isActive = (to: string) => (to === "/admin" ? route.path === "/admin" : route.path.startsWith(to));

const search = ref(typeof route.query.q === "string" ? route.query.q : "");
function submitSearch() {
  const q = search.value.trim();
  void router.push({ path: "/admin/users", query: q ? { q } : {} });
}

onMounted(() => { void requireAdmin(); });
</script>
<template>
  <div class="min-h-dvh bg-bg text-ink lg:grid lg:grid-cols-[232px_1fr]">
    <aside class="border-b border-line bg-paper lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r">
      <div class="flex items-center gap-2.5 px-4 py-4">
        <BrandMark :size="26" />
        <div class="min-w-0">
          <div class="text-[13.5px] font-semibold leading-tight">Admin console</div>
          <div class="truncate text-[11.5px] text-muted">CitePass</div>
        </div>
      </div>

      <nav class="no-scrollbar flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:gap-0.5 lg:pb-0" aria-label="Admin sections">
        <NuxtLink
          v-for="n in nav"
          :key="n.to"
          :to="n.to"
          class="flex min-h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-[13.5px] font-medium no-underline transition-colors"
          :class="isActive(n.to) ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'"
          :aria-current="isActive(n.to) ? 'page' : undefined"
        >
          <Icon :name="n.icon" :size="16" :stroke-width="isActive(n.to) ? 2.05 : 1.75" />{{ n.label }}
        </NuxtLink>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-col">
      <header class="sticky top-0 z-10 flex flex-wrap items-center gap-2.5 border-b border-line bg-bg/85 px-4 py-2.5 backdrop-blur-xl">
        <form class="flex min-w-[220px] flex-1 items-center gap-2" role="search" @submit.prevent="submitSearch">
          <label for="admin-search" class="sr-only">Search users</label>
          <div class="relative w-full max-w-md">
            <Icon name="search" :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="admin-search"
              v-model="search"
              type="search"
              placeholder="Search users by email or id…"
              autocomplete="off"
              class="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[13.5px] text-ink placeholder:text-muted/70 transition-colors focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/20"
            />
          </div>
          <button
            type="submit"
            class="inline-flex h-9 items-center rounded-lg bg-action px-3 text-[13.5px] font-medium text-action-ink transition-opacity hover:opacity-90"
          >Search</button>
        </form>

        <span v-if="auth.user.value?.email" class="hidden text-[12px] text-muted md:inline">{{ auth.user.value.email }}</span>

        <ClientOnly><ThemeToggle class="!size-9 !min-h-0 !min-w-0 border border-line" /></ClientOnly>

        <NuxtLink
          to="/app"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13.5px] text-ink-2 no-underline transition-colors hover:bg-surface-2 hover:text-ink"
        ><Icon name="arrow-left" :size="15" />Back to app</NuxtLink>
      </header>

      <main class="min-w-0 flex-1 p-5 lg:p-7">
        <ClientOnly>
          <div v-if="access === 'unconfigured'" class="rounded-card border border-dashed border-line-strong px-4 py-3 text-[13.5px] text-muted">
            This build has no <code>NUXT_PUBLIC_SUPABASE_URL</code>, so there is no admin backend to talk to.
          </div>
          <div v-else-if="access === 'denied'" class="rounded-card border border-dashed border-line-strong px-4 py-3 text-[13.5px] text-muted">
            This account is not an admin. Redirecting…
          </div>
          <div v-else-if="access === 'checking'" class="flex items-center gap-2 text-[13.5px] text-muted" aria-busy="true">
            <span class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />Checking access…
          </div>
          <slot v-else />
          <template #fallback>
            <div class="text-[13.5px] text-muted">Loading console…</div>
          </template>
        </ClientOnly>
      </main>
    </div>

    <AdminConfirmDialog />
    <AdminToasts />
  </div>
</template>
