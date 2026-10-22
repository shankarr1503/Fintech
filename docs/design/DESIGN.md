# CoinQuest design notes

## What we took from each app

| App | What it gets right | What we borrow | What we avoid |
|---|---|---|---|
| **Google Pay** | People come first. Paying a friend is two taps; amount entry is huge and calm. | Recent-people row on Home, full-screen amount entry, one-line "Pay from" selector, big green success state. | Its sparse Home hides useful money context. |
| **PhonePe** | Scan is the centre of the tab bar. Everything for UPI is one step away. | Raised centre Scan button, service grid labels in plain words. | The wall of 30+ icons; ours stays to 8. |
| **Paytm** | Top row of the four most common jobs. | Four primary actions: Scan, Pay anyone, Bills, Balance. | Ad banners, carousels, competing colours. |
| **CRED** | Feels expensive: dark surfaces, big confident type, tactile slide-to-pay, rewards that feel earned. | Dark-first glass, vault "hero" cards, big display numbers, swipe-to-pay. | Hiding basic information behind gestures; low-contrast grey text. |
| **Safyre** (wallet concept) | Trust and ease in a crypto wallet: pixel-style type, muted colour, bold hierarchy. | Pixel type as the voice, one quiet accent, bold numbers over a calm surface. | Novelty type in places that must be read at a glance (we keep body sizes generous). |
| **1% Club / Jar** | Money habits as small daily wins. | Streaks, daily quests and levels, kept to one strip on Home and one tab. | Gamifying payments themselves: paying a bill should feel safe, not like a game. |

## Principles

1. **Calm by default, playful on success.** Screens that move money are quiet and precise. Delight (coins, level-ups, quest clears) appears only *after* something good happens.
2. **Numbers are the interface.** Amounts use tabular figures, the ₹ sits smaller than the digits, paise are muted, and negative amounts are words ("Spent"), not just red.
3. **One accent.** Mint means progress, coins and rewards, and nothing else. Green and red only ever mean money in and money out.
4. **Plain words.** "Left this month", "Due in 5 days", "Debt-free by Dec 2027". No "Unlock your financial potential".
5. **Every screen has one job.** The primary action is the only filled button on the screen.

## Dark glass, kept honest

The look is dark glassmorphism ("liquid glass"): frosted surfaces floating over one aurora. Glass goes wrong when it costs legibility or hides state, so it follows rules:

- **One backdrop, rendered once.** `Backdrop` (kit.tsx) paints three soft light pools on near-black behind the navigator. Screens and navigators are transparent; nothing paints its own gradient. Transitions fade, so two transparent screens never overlap mid-slide.
- **Glass is a fill, not a filter on text.** `Glass` adds the backdrop blur (expo-blur on iOS and web; Android gets the translucent tint, because its blur is experimental and costly), the tint and a sheen across the top edge. Text always sits on top of it, never inside a blur.
- **Contrast is checked against the brightest spot.** Every text colour meets WCAG AA (4.5:1) over the brightest aurora pool seen through glass, not just over the base colour. The lowest pair is 5.3:1.
- **Some surfaces must not be glass.** The app lock is opaque (it exists to hide the app). The reward toast and payment receipts use fixed smoked or deep tints so they stay readable over anything.
- **States never rely on colour.** Paid, waiting, held and failed each have their own icon and title as well as their tint.
- **Pixel type, one family.** Pixelify Sans everywhere. Weight carries the hierarchy (700 amounts, 600 headings, 500 labels, 400 reading), sizes sit a step below the usual scale because pixel letters run wide, and line heights are generous.

## Tokens

Dark is the default; a frosted light variant swaps the same tokens (light glass on a pastel aurora, with smoked vault cards).

| Token | Dark | Use |
|---|---|---|
| `paper` | `#06080F` | Base colour under the aurora; opaque surfaces |
| `surface` | white at 6.5% | Card glass |
| `glass` | `rgba(14,17,28,0.72)` | Denser glass: sheets, tab bar, sticky footers |
| `sheen` | white at 9% | Liquid highlight across the top of glass |
| `paperDeep` | white at 7% | Fields, tracks, segmented controls |
| `ink` / `ink2` / `ink3` | `#F4F6FB` / `#D2D7E4` / `#B4BBCB` | Text, by emphasis |
| `line` / `lineStrong` | white at 11% / 24% | Glass edges, outlines |
| `night` | white at 9% plus an aurora tint | Vault cards: balance, debt plan, rewards |
| `primary` / `onPrimary` | `#EEF1F8` / `#0A0D16` | Bright liquid primary buttons |
| `gold` | `#8CF0D2` | The mint accent: progress, rings, rewards, Scan. Text on it is `ON_ACCENT` |
| `green` / `red` / `blue` / `amber` | luminous tints, each with a 15% "soft" fill | Money in / problems / links / warnings |
| `aurora` | `#6B4DFF`, `#0B8F8E`, `#2D5BFF` | The backdrop's light pools (30% at the centre) |

Payment receipts sit on deep tints with white text (7:1 or better): Paid `#0C3A2C`, Waiting `#18203A`, On hold `#3A2C0E`, Failed `#3E1419`, each with its own icon (tick, clock, pause, cross) and title.

Type, all Pixelify Sans: Display (700, 36), Heading (600, 26), Title (600, 17), Body (400, 15), Small (400, 13), Label (500, 11, tracked capitals). Pixelify Sans has no ₹ sign or arrows; `frontend/scripts/build-fonts.py` draws them on the font's own pixel grid and writes the bundled `assets/fonts/PixelifySans-*.ttf`. Radius 14 inputs, 22 cards, 28 sheets; buttons, chips and the tab bar are pills. 4-pt spacing grid; screen gutter 20.

## Structure

`Home · Money · [Scan] · Rewards · Me`

- **Home:** what's left this month, the four jobs, people, today's streak, what's due, one insight, services.
- **Money:** everything you own and owe: accounts, activity, spending, debts, goals.
- **Scan:** camera QR scan → amount → swipe to pay → success.
- **Rewards:** the game: level, streak, quests, badges, coin store, leaderboard.
- **Me:** profile, security, linked accounts, help.
