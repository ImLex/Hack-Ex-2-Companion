# Hack EX 2 Companion

An offline intelligence database for Hack Ex. Paste your game logs in, and it
builds a searchable record of every target, IP, wallet, crypto payment and piece
of software you have ever seen.

Everything is stored on your phone. Nothing is uploaded anywhere.

> **iPhone?** This folder is the iOS version. See **[IOS.md](IOS.md)** for how
> the screen-capture import works, how the unsigned IPA is built on GitHub
> Actions, and how to install it with Sideloadly. The rest of this README
> describes the Android/Expo Go workflow and still applies to development.

---

## Running it on your phone

You need to do this once:

1. Install **Expo Go** from the Play Store (it is free).
2. On this computer, open a terminal in this folder and run:

   ```
   bun start
   ```

3. A QR code appears. Open Expo Go on your phone and scan it.

Hack EX 2 Companion opens on your phone. Leave the terminal running while you use it —
that terminal *is* the app server. Press `Ctrl+C` in the terminal to stop.

While it is running, any change you make to a file appears on your phone within
a second or two. You do not need to restart anything.

### Why this project is pinned to Expo SDK 54

**Do not upgrade the `expo` package without reading this.**

Expo Go can only run projects built for the exact SDK version that particular
copy of Expo Go was compiled against. The Expo Go you get from the Play Store
is currently built for **SDK 54** — newer Expo Go builds (SDK 55, 56, 57) exist,
but Expo ships those only through `eas go` and the Expo CLI, not the store.

So this project deliberately targets SDK 54. If you bump `expo` to a newer
version, Expo Go will refuse to open it with:

> Project is incompatible with this version of Expo Go. The project you
> requested requires a newer version of Expo Go.

If you ever do want to move to a newer SDK, you have to stop using Expo Go and
build a *development build* instead (`eas build --profile development`), which
is a custom version of Expo Go containing your exact SDK. The `preview` build
described below is unaffected by any of this — a real `.apk` bundles its own
runtime and can be on any SDK.

To check what a change did to the SDK version, run `bunx expo-doctor`.

### If your phone will not find it

Expo Go has a "Development servers" list that is supposed to find your computer
by itself. It often does not — it relies on broadcast traffic that most home
routers quietly drop. **Do not wait for it to appear.** Instead, in Expo Go tap
**Enter URL manually** and type:

```
exp://192.168.1.14:8081
```

That is this computer's address on your network. To check it is still correct:

```
ipconfig
```

and look for the **IPv4 Address** under your Ethernet or Wi-Fi adapter — ignore
any `vEthernet`, `172.x`, or `169.254.x` entries, those are virtual adapters your
phone cannot reach.

If the QR code itself points at the wrong address (this computer has several
network adapters, and Expo has to guess), use:

```
bun run lan
```

which forces the correct one. If your IP ever changes, update it in the `lan`
script in `package.json`.

**Still nothing?** Tunnel mode routes through Expo's servers and works on any
network, including when phone and computer are on different ones:

```
bun run tunnel
```

The first run asks to install `@expo/ngrok` — say yes. It is slower than LAN but
network-proof.

**Also check** your phone is on the same network: its IP should start
`192.168.1.` too. A separate guest Wi-Fi will never connect.

### Getting a real installable app later

Expo Go is the easy way to run it, but the app only exists while your computer
is running. When you want a proper `.apk` you install once and keep:

```
bunx eas-cli@latest login          # once, asks for your Expo account
bunx eas-cli@latest build --platform android --profile preview
```

It builds in the cloud (about fifteen minutes) and gives you a download link
for an `.apk`. Open that link on your phone to install it. You will need to
allow "install from unknown sources" the first time — that is Android asking
because the file did not come from the Play Store, not a problem with the app.

This project is already connected to EAS: the project ID lives in `app.json`
under `extra.eas.projectId`, so `eas init` is not needed.

> **Why `preview` and not `production`?** By default an EAS *production* Android
> build produces an `.aab` (Android App Bundle), which is an upload format for
> the Play Store — you **cannot install it on a phone**. `eas.json` in this
> folder overrides that so every profile produces an installable `.apk`, but
> `preview` is still the right one for putting the app on your own phone.
> If you ever do publish to the Play Store, change `production.android.buildType`
> in `eas.json` from `"apk"` to `"app-bundle"`.

---

## Using it

### 1. Import your logs

Go to the **Import** tab, paste your logs straight out of the game, and tap
*Read these logs*.

You get a preview first — how many lines are new, how many you have already
imported, how much crypto is in them, and which targets they belong to.
**Nothing is saved until you tap Import.**

The log formats it understands:

| Log line | What the companion does with it |
|---|---|
| `Accessed device at 216.22.206.218` | Links that IP to a target, counts an attack |
| `Cracking password on 154.9.12.100...` | Records the attempt |
| `Cracked password on 113.39.182.104` | Records the success |
| `Failed to crack password on 154.9.12.100` | Records it, and notes the target has a Password Encryptor |
| `Bypassed firewall on 216.22.206.218` | Notes the target runs a Firewall |
| `Uploaded Lv3 Siphon to 216.22.206.218` | Records Siphon Lv3 as software *you* uploaded |
| `Stole 172 Crypto from hx84d9...762d` | Adds 172 to crypto history, via that wallet |

You can paste the same logs twice. Duplicate lines are recognised and skipped,
so your crypto totals never get counted twice.

### 2. Deal with the review inbox

Here is the thing that shapes the whole app: **crypto log lines name a wallet,
never an IP.**

```
[7-18 18:00] Stole 172 Crypto from hx84d9...762d      <- no IP anywhere
[7-18 18:00] Accessed device at 153.95.66.226         <- no wallet anywhere
```

So when the companion sees crypto from a wallet it does not recognise, it genuinely
cannot tell whose it is. Rather than guessing and attaching your money to the
wrong target, it stores the crypto and puts the wallet in the **review inbox**.

Assign that wallet to a target once, and every past *and* future payment from it
is credited automatically. It is the one bit of manual work the app asks of you,
and you only do it once per wallet.

### 3. Everything else

- **Dashboard** — daily income chart, best targets, biggest earners, what needs
  attention.
- **Targets** — sort by score, crypto, earnings, level or recent activity.
- **Target profile** — every IP, wallet, log line, crypto payment and piece of
  software for one target, plus a breakdown of exactly why it scored what it did.
- **Search** — one box covering names, devices, IPs, wallets, software, tags,
  notes, raw log text, and numbers (levels, crypto amounts, scores).
- **Settings** — backups, spreadsheet export, and the erase button.

**Take a backup.** Settings → *Save a backup* gives you one file with everything
in it. Your data exists only on your phone; if you lose the phone without a
backup, it is gone.

---

## How the value tiers work

Instead of keeping thirty separate tables of "what counts as a good target at
level N", the companion scales from the level 30 reference values:

```
LOW 250    MEDIUM 500    HIGH 1000    ULTRA 1500    GODLY 2500
```

Each tier scales linearly with level, so `LOW` at level 10 is 83, and at level
20 it is 166. A level 5 target holding 420 crypto is GODLY *for its level*,
which is what actually matters when deciding who to hit.

> The original spec's level 20 example table (167 / 334 / 667 / 1667) disagrees
> with the spec's own formula, which gives 166 / 333 / 666 / 1666. The code
> follows the formula, because that reproduces the level 1, 10 and 30 tables
> exactly. To switch, change `ROUNDING` in `src/logic/valueScale.ts` to `'ceil'`.

---

## Where things live

You do not need to read this to use the app. It is here for when you want to
change something.

```
app/                      Every screen. The folder layout IS the navigation:
  (tabs)/index.tsx          the Dashboard tab
  (tabs)/targets.tsx        the Targets tab
  (tabs)/import.tsx         the Import tab
  (tabs)/search.tsx         the Search tab
  (tabs)/settings.tsx       the Settings tab
  target/[id].tsx           a target's profile ([id] is the target number)
  target/new.tsx            add a target by hand
  target/edit/[id].tsx      edit a target
  review.tsx                the review inbox

src/
  db/
    schema.ts             The database structure and migrations. Start here.
    types.ts              One TypeScript type per table.
    database.ts           Opens the database and runs migrations on startup.
    seed.ts               The software list and system tags.
    useQuery.ts           How screens load data and stay fresh.
    repo/                 All the database queries, grouped by subject.
  logic/
    parser.ts             Reads raw log text. Add new log formats here.
    ingest.ts             Decides what to do with what the parser found.
    valueScale.ts         The LOW/MEDIUM/HIGH/ULTRA/GODLY maths.
    potentialScore.ts     The 0-100 target score.
  ui/
    theme.ts              Every colour and size in the app.
    components.tsx        Buttons, cards, chips, inputs.
    Charts.tsx            The graphs.
```

### Making changes safely

```
bun test          Runs all 47 tests. Do this after any change.
bun run typecheck Checks for mistakes without running anything.
```

The tests are not decoration. `src/db/database.test.ts` runs the real schema and
the real queries against a real database using the real sample logs, so if you
break a query it tells you immediately — something a type check cannot catch,
because SQL is just text as far as TypeScript is concerned.

**To teach the parser a new log line:** add an entry to `RULES` in
`src/logic/parser.ts`, then add a line to the sample in `parser.test.ts` and run
`bun test`. Nothing else needs to change.

**To add a column to the database:** add a new migration to `MIGRATIONS` in
`src/db/schema.ts` and bump `LATEST_VERSION`. Never edit an existing migration —
phones have already run it. The app upgrades itself on next launch, and nobody
loses data.

---

## Design decisions worth knowing

These follow the "build it properly once" rule from the original spec.

**Totals are never stored.** `cryptoExtractedTotal` and `cryptoExtractedToday`
are calculated from `crypto_history` every time they are read. A stored total
can drift out of sync with its history; a calculated one cannot.

**Tags are a proper table, not comma-separated text.** The spec listed this as a
future improvement. Doing it later would have meant a migration and rewriting
every query that touches tags, so it is done from the start.

**Software distinguishes yours from theirs.** `Uploaded Lv3 Siphon to X` means
you put a Siphon on their device; `Bypassed firewall on X` means they run a
firewall. Both are software on that target, but they mean opposite things, so
`installed_software.owner` records which is which.

**Parsed data never overwrites what you typed.** A log proving a Lv3 Siphon will
not overwrite the Lv20 Siphon you recorded by hand — automatic updates only
raise levels. Manual edits always win.

**Nothing is ever guessed.** If the parser is under 50% confident, or cannot work
out which target a line belongs to, the line is still stored but goes to the
review inbox instead of being attached to something that might be wrong.

---

## Troubleshooting

**`Cannot find module 'debug'` or other odd missing-module errors after
installing packages.** On Windows, bun's default install mode can silently create
empty package folders. `bunfig.toml` in this folder already forces the safe mode.
If it happens anyway:

```
bun pm cache rm
rm -r node_modules
bun install
```

**The app shows a red error screen.** Read the top line — it usually names the
file and line number. Shake the phone to bring up the developer menu and tap
*Reload*.

**Changes are not showing up.** Stop the terminal with `Ctrl+C` and run
`bun run reset`, which clears the cache and starts fresh.
