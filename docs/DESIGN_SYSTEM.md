# CitePass design system — warm and tactile

The visual language and information architecture for `apps/app` (web, iOS and Android from one
codebase). Source of truth for tokens is
[apps/app/app/assets/main.css](../apps/app/app/assets/main.css); this document explains the
reasoning so the next person does not have to reverse-engineer it from utility classes.

## The four rules

Everything below follows from these. If a decision is ever unclear, apply them in order.

1. **The app is a session, not a destination.** Opening `/app` puts a question on screen. There is
   no dashboard to cross, no tab bar to choose from, no "start practising" button to press. Every
   other screen — mocks, review, progress, glossary, account — lives behind one panel reached from
   one menu button. Studying is the only thing that happens without a navigation decision first.
2. **Controls look pressable.** Primary buttons and idle options carry a 3px solid bottom edge and
   lose it on `:active`, so the control physically sinks under the thumb. This is the one place
   shadow is allowed to be obvious; everywhere else it stays soft.
3. **Nothing is pure grey.** Canvas, ink and lines are all mixed warm — cream and clay in light,
   brown-black in dark. A neutral grey UI reads as unfinished tooling. Dark mode is mixed
   independently rather than inverted, so it lands warm rather than drifting blue.
4. **Serif means law.** `font-serif` is used for one thing: verbatim quoted statute in
   `CitationBlock`. That single restraint is the product's visual signature — the citation chain is
   the whole defensibility argument (SPEC §3.5), so it should *look* different from UI chrome.

## Structure

The IA has exactly three levels, and the depth never grows past them.

- **The loop** (`/app`) — full-bleed, chrome-free, keyboard-driven. A hairline progress rail and a
  menu button are the only things above the question. It runs in rounds of twenty and rolls into
  the next round from the milestone screen, so a study sitting never has to return to a hub.
- **The panel** (`AppPanel`) — the entire navigation model as one overlay: jurisdiction and level
  at the top, both readiness numbers, then five destination rows and a footer for help and upgrade.
  It is the only navigation surface in the app; there is no tab bar and no sidebar on any breakpoint.
- **The screens** (`/app/*`) — mocks, review, progress, glossary, account. Each gets a slim
  `AppShellHeader`: back arrow to the loop, title, menu button. They are places you read, not
  places you launch from.

`AppChrome` mounts the panel and the state picker once per layout, so both mobile and web shells
get the same overlays from a single instance. `useAppPanel` owns the open state, the immersive-route
predicate and the route-to-title map — layouts never hardcode either list.

Sessions and mock runs are *immersive*: the shell renders no header at all and the screen owns the
whole viewport including the safe areas. Everything else is not.

## Colour

Tokens are CSS variables bridged into Tailwind by `@theme inline`, so `bg-surface`, `text-muted`,
`border-line` and friends resolve correctly in both themes with no `dark:` prefix.

- **Canvas** — `bg` (`#faf6f1` cream) → `paper` → `surface` → `surface-2` / `surface-3` (nested
  fills, hover, skeletons). In dark these run `#15120f` up through `#382f28`.
- **Ink** — `ink` (primary), `ink-2` (body and secondary), `muted` (labels, hints, metadata). All
  warm-shifted; none of them is a neutral grey.
- **Action** — `action` / `action-ink`, plus `action-deep` for the pressed edge. Teal `#0b7a6e`
  in light, brightened to `#2dbaa6` in dark so it holds against the brown-black canvas.
- **Accent** — `accent`, `accent-text`, `accent-soft`. Progress, selection, focus rings, links.
  It shares the teal hue with `action`: the palette is deliberately one colour plus semantics,
  which is what keeps a warm UI from turning into a fruit bowl.
- **Semantic** — `ok`, `warn`, `danger`, each with a `-soft` background and `red-deep` for the
  danger button's pressed edge. These carry SRS box state and answer correctness.

Contrast: `ink` on `surface`, `ink-2` on `surface`, and `muted` on `bg` all clear WCAG AA for their
sizes in both themes.

## Type

Self-hosted variable fonts in `apps/app/public/fonts`, vendored from `@fontsource-variable` by
`pnpm --filter @rep/app fonts:sync`. **Never load fonts from a CDN** — the app runs offline inside
Capacitor, and a webfont request that fails leaves the interface in fallback for the whole session.
Only the latin subsets ship.

- **Sans — Nunito Variable**, with `ui-rounded` / `SF Pro Rounded` ahead of the system stack so a
  fallback still lands soft. Body text sits at weight 500 and leading 1.55; headings go to 800.
  Rounded terminals are what carry most of the friendliness, which is why the weight is heavier
  than a neutral UI font would need.
- **Serif — Fraunces Variable.** Quoted law only.
- **`tabular`** forces `tnum` for anything that counts: timers, scores, percentages, countdowns.
  Without it a running mock timer jitters as digits change width.

Voices, rather than a numeric scale, because screens should pick intent not size: `display`
(headlines, weight 800), `eyebrow` (11px uppercase label), `statute` (the serif reading voice),
`rich` (long-form prose from content files).

## Space, radius, elevation

- **Spacing** is Tailwind's default 4px scale, unmodified.
- **Radius** — `rounded-card` (20px) for cards and controls, `rounded-panel` (28px) for sheets and
  dialogs, `rounded-pill` for buttons, chips and progress tracks. Tailwind's own
  `rounded-sm|md|lg|xl` are left at their defaults, so a utility means what a Tailwind reader
  expects.
- **Elevation** — `shadow-card` and `shadow-float` for real depth (both tinted warm rather than
  black), plus `shadow-tactile` for the pressable bottom edge. Raised controls pair it with
  `active:translate-y-[3px] active:shadow-none`.

## Motion

- `--ease-standard` (`cubic-bezier(.32,1.06,.5,1)`) for state changes; `--ease-emphasized`
  (`cubic-bezier(.22,1.35,.36,1)`) for entrances and exits. Both overshoot slightly — the small
  bounce is the motion half of the friendly voice.
- Durations: 140ms route transitions, 180ms dialogs, 220–260ms sheets and entrances.
- Utilities: `anim-fade-up`, `anim-scale-in`, `anim-sheet-up`, `anim-pop`, `anim-deal-in`, `shimmer`.
- Everything is disabled wholesale by the `prefers-reduced-motion` rule in the base layer. Motion
  is never the only signal for a state change.

## Non-negotiable behaviours

These are load-bearing, not decorative. Preserve them in every component and screen.

- **`tap`** — 48px minimum hit area on every control that is not already that big.
- **`safe-pt` / `safe-pb` / `safe-px`** — Capacitor safe-area insets. Dropping these puts content
  under the notch or the home indicator. Immersive screens apply them themselves.
- **Focus** — a visible `:focus-visible` ring in accent on every interactive element. Never
  `outline: none` without a replacement.
- **`aria-live`** — answer feedback, toasts and sync status announce to screen readers.
- **Theme** — `data-theme` on `<html>` (system / light / dark) is the one setting stored on the
  device.

## Component contracts

Props and emits are frozen: primitives can be restyled without touching the screens that use them.

### Core

- **`AppButton`** — `variant` (`primary` = teal fill on a deep edge, `secondary` = bordered surface
  on a line edge, `soft` = accent tint, `ghost` = bare, `danger`), `size` (`xs|sm|md|lg`), `to` /
  `href` render a link instead of a button, `icon` / `iconRight`, `loading` swaps the leading icon
  for a spinner and sets `aria-busy`, `block` stretches.
- **`AppInput`** — labelled input / textarea / select with hint and error, wired with
  `aria-invalid` and `aria-describedby`.
- **`AppCard`** — bordered surface with optional `title` / `subtitle`, `tone` and `padding`.
- **`AppSheet`** — bottom sheet on mobile, centred dialog from `sm:` up. Teleported, focus-trapped,
  Escape closes unless `dismissible` is false.
- **`AppTabs`** — segmented control, `v-model`.
- **`Badge`**, **`ListRow`**, **`Skeleton`**, **`EmptyState`**, **`Toast`**.

### Shell

- **`AppPanel`** — the navigation overlay described under Structure.
- **`AppChrome`** — mounts `AppPanel` and `StatePicker` once per layout.
- **`AppShellHeader`** — back / title / menu for non-immersive `/app` screens.

### Study

`QuestionCard`, `OptionButton`, `CitationBlock`, `ProgressRing`, `ReadinessCard`, `CoverageTable`,
`PipelineBar`, `PlanCard`, `ReviewItem`, `StatTile`, `StatePicker`, `FreeTierGate`, `NarrationBar`,
`StatuteDemoCard`, `OnboardingArt`.

`OptionButton` carries the five answer states — `idle`, `selected`, `correct`, `wrong`, `dimmed` —
and each one is signalled by shape and badge glyph as well as colour, so it survives colour
blindness and the reduced-motion path.

### Icons

`Icon.vue` is a hand-rolled inline-SVG set on a 24px grid at 1.75px stroke, with no icon-font or npm
dependency. Every glyph inherits `currentColor`. Add glyphs to the map and the `IconName` union
together; the union is what gives call sites autocomplete and type errors on typos.

## Screen rationale

Only the decisions a reader could not infer from the markup are recorded here.

### The loop — `app/index`

- The question is the landing screen. An empty jurisdiction is the *only* thing that can preempt it,
  and it does so as a full-screen first step rather than a modal ambush.
- The advance control is pinned inside the bottom safe area rather than following the question, so
  the thumb does not have to hunt after every reveal. Web adds `1`–`4` / `A`–`D` to pick and
  `Enter` / `Space` to advance.
- Progress is a hairline rail of twenty ticks, not a counter card. At that size each tick can carry
  its own state and the learner sees the shape of the round in peripheral vision.
- The milestone screen ends on **Keep going**, which deals a fresh round in place. Returning to a
  hub is the secondary action, because the common case after twenty questions is twenty more.

### Behind the panel — mocks, mock run, review, progress, glossary, account

- **Progress** is a reading screen now that sessions start from the loop: readiness, then the review
  pipeline behind a hairline, then coverage. Its action buttons route back to `/app`.
- **Mocks** shows the exam format card above the form list, because "does this match my real exam" is
  the question the screen exists to answer. Locked forms keep their row and take a padlock rather
  than disappearing — the five-form ceiling is part of what Complete buys, so hiding them hides the
  offer.
- **Mock run** treats the palette as the exam's navigation, not a jump list: it summarises answered /
  left / flagged and offers the two jumps people want under time pressure — first unanswered and
  first flagged. Palette cells encode state three ways (fill for answered, a 2px amber edge for
  flagged, a ring for current) so flagged-and-answered stays legible.
- **Review** puts the due-now count in a filled tile so the number is the headline. Leeches are a
  separate section with their own explanation rather than a badge in a flat list, because they are
  drilled by a different action.
- **Glossary** definitions clamp to two lines collapsed, and the citation only mounts when a term is
  open — the serif quote is the payoff, not the preview.
- **Account** shows one device, because one device is all an account can have (SPEC §5.3). The
  entitlement summary is separated from the free-question count by a hairline so the upsell line
  does not look like part of the identity block.
