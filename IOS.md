# Hack EX 2 Companion — iOS

The iOS version of the companion. Same app, same database, same log parser as
the Android version — but instead of an accessibility service, it reads the
game through an iOS **screen broadcast**: while you play, a broadcast extension
OCRs the screen a couple of times per second and feeds what it reads into the
database. Everything happens on the phone; nothing is uploaded anywhere.

There is no Mac and no paid Apple developer account involved. The app is built
unsigned in the cloud by GitHub Actions, and you sign it yourself when you
install it with Sideloadly.

---

## Getting the IPA

Every push to `main` (and the *Run workflow* button) builds the app:

1. On GitHub, open **Actions → Build iOS (unsigned IPA)**.
2. Open the latest green run and download the
   **HackEX2Companion-unsigned-ipa** artifact.
3. Unzip it — inside is `HackEX2Companion-unsigned.ipa`.

## Installing with Sideloadly

You need [Sideloadly](https://sideloadly.io) on your PC, a USB cable, and any
free Apple ID (you can create one just for this — it does not have to be the
one on the phone).

1. Connect the iPhone by USB and unlock it. In iTunes/Finder trust the
   computer if asked.
2. Open Sideloadly, drag the `.ipa` in, and enter your Apple ID.
3. **Open "Advanced options" and make sure signing the app *extensions* is
   enabled (do not strip PlugIns), and leave app-group entitlements enabled.**
   The broadcast capture lives in an extension and talks to the app through an
   app group — if Sideloadly strips either, the app installs fine but capture
   silently does nothing.
4. Start. The first time, Apple emails you a verification code — Sideloadly
   asks for it.
5. On the phone: **Settings → General → VPN & Device Management** → trust your
   Apple ID's developer profile.

**The 7-day rule.** Apps signed with a free Apple ID stop launching after
7 days. Nothing is lost — your database stays on the phone — you just plug in
and sideload the same IPA again. (AltStore/SideStore can automate the refresh
over Wi-Fi if that gets old.)

A free Apple ID can hold 3 sideloaded apps and 10 registered app IDs per week.
This app uses 2 of those IDs (app + extension).

## Using the game capture

1. Open the companion → **Settings** tab → **Game reader** card →
   **Start screen capture**.
2. In the system sheet, pick **HE2 Game Capture** and press **Start
   Broadcast**.
3. Switch to Hack EX 2 and play normally. The red pill/bar at the top of the
   screen means capture is running.
4. Come back to the companion whenever you like — imports are drained
   automatically, and capture pauses itself while the companion is on screen so
   it never reads its own UI.
5. Stop the broadcast from the red pill, Control Center's screen-record
   button, or the same Settings button.

If capture ever misbehaves, the **Import** tab still takes pasted logs exactly
like the Android version — that path needs no extension, no app group, no
broadcast.

## Good to know / limitations

- **OCR, not magic.** The Android reader gets the game's real text from the
  accessibility tree; iOS reads pixels. Vision OCR is very good, but a wallet
  character or an IP digit can occasionally be misread — anything ambiguous
  lands in the review inbox rather than being guessed at, same as always.
- iOS gives broadcast extensions a hard **50 MB** memory limit, so the
  extension deliberately OCRs one frame every ~2 seconds. Log screens you
  linger on are captured reliably; something flashed for half a second between
  screens may be missed.
- The capture records **the screen**, not the game specifically. It pauses
  while the companion itself is open, and OCR text from other apps will not
  match the game's log formats and gets ignored — but stop the broadcast
  before doing anything sensitive on the phone; it is simply good hygiene.
- Building locally on Windows is not possible (Apple only allows iOS builds on
  macOS) — that is what the GitHub Actions workflow is for. Everything else
  (`bun test`, `bun run typecheck`, Expo Go for UI work) works on Windows as
  usual; note Expo Go runs the app but has no capture module.

## First-run smoke test

After sideloading, in this order:

1. Open the app — Dashboard renders, no red screen.
2. Settings → Game reader → Start screen capture → pick HE2 Game Capture →
   Start Broadcast → the status row turns **green** ("Recording…").
3. Open Hack EX 2, open your LOG screen, wait ~10 seconds.
4. Return to the companion: the dashboard/import counters should show new
   data (or the review inbox has new entries).
5. Stop the broadcast; the status row goes back to amber.

If step 2 never turns green, the extension is not installed/entitled — redo
the Sideloadly advanced options from step 3 above.
