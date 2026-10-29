# IMPlanner

Plan, track and share Ironman training with friends. IMPlanner scores you on **how closely you follow your own plan**, not on how far or fast you went. There are no leaderboards, segments or kudos counts. Doing much more than planned lowers your score the same way doing less does.

Built for IRONMAN Canada–Ottawa (Sunday, August 8, 2027), but any race and date works.

## What it does

- **Plan**: builds a periodized season (prep → base → build → peak → taper → race week) from your race date and current and peak weekly hours. You tick which days you swim, ride, run and do strength work, with an optional fixed start time per sport (e.g. pool slots at 7:30), and pick the long-ride and long-run days; days left empty are rest days. A typical week previews as you choose. Easier weeks every 3rd or 4th week. Every session is editable (including its start time); drag sessions between days on the Plan page. Change the layout later in Settings and rebuild from any date: logged sessions stay.
- **Key races**: add races before your Ironman (5K to marathon, sprint to half-distance triathlon, bike or swim events) in Settings → Key races. A **B race** gets a taper (about 10 days for a half/full marathon or 70.3, 6 days for shorter races), the race on its day with an estimated time, a shake-out the day before, and recovery after scaled to the distance (after a marathon: a full rest day, two more days without running, then a week of easy training). In the six weeks before a B half or full marathon the plan leans toward running and builds the long run (to about 2h20 for a marathon). A **C race** is a training race: a two-day ease-off and a quicker return. Adding or removing a race rebuilds only the weeks around it; logged workouts stay.
- **Log**: sync workouts automatically from Garmin Connect (see [Garmin](#garmin)), or import Garmin rides and runs (`.fit`, Garmin's `.zip` "Export Original", `.tcx`, `.gpx`, several at once; multisport files are split into legs). Log swims by hand (time, distance, pool length). Each workout is matched to the planned session for that day and sport, and you can change the match.
- **Adherence**: every session is marked *On plan* (within about ±20 % of the planned time, or distance for swims), *Close* (within about ±50 %), *Off plan*, *Missed* or *Skipped* (with a reason). The weekly and season scores are weighted by planned time.
- **Crew**: create a crew, share the invite link, and see each member's week against their own plan, the sessions they finished or skipped, how they felt, and their notes. Send a 👏 💪 🙌 ❤️ 🫂 or a short message.
- **Progress**: season adherence, on-plan streak, weekly hours by sport against plan, time in heart-rate and power zones (if you enter your thresholds).
- Works on phones (add it to your home screen), tablets and desktops, in light and dark mode. Backups download as one JSON file.

## Privacy

| Who | Sees |
|---|---|
| You | Everything |
| Your crew | Your name, race, plan, finished and skipped sessions (date, sport, duration, how it felt, notes, skip reason) and cheers |
| Your crew, only if you turn on **Settings → Share distance, pace, heart rate and power** | Distance, pace/speed, heart rate, power, cadence, climbing |
| Nobody else | Nothing |

Your thresholds (FTP, threshold paces and heart rates) and plan settings are always private. GPS positions are never stored, so no maps reveal where you live. These rules are enforced in the database (row-level security), not just hidden in the page. `supabase/rls-test.sql` checks them (see below).

## How it's built

A static site (HTML, CSS, JavaScript modules, no build step) plus a free [Supabase](https://supabase.com) project for accounts and shared data.

```
index.html            app shell
css/app.css           styles (light and dark)
js/app.js             router and start-up
js/config.js          Supabase URL and publishable key (public by design)
js/store.js           data layer: Supabase, or IndexedDB on this device when config is empty
js/state.js           in-memory state and saving
js/plan.js            season plan generator
js/compliance.js      plan-adherence scoring
js/importer.js        FIT / ZIP / TCX / GPX import (Garmin's official FIT SDK)
js/charts.js          SVG charts
js/dialogs.js, ui.js  shared dialogs and components
js/views/*.js         one file per page
supabase/schema.sql   database tables, functions and privacy rules
supabase/rls-test.sql privacy-rule test (rolls itself back)
supabase/garmin.sql   Garmin key storage (Vault) and sync bookkeeping
supabase/functions/garmin/index.ts   Edge Function that fetches workouts from Garmin
js/garmin.js          sync: decode, match to plan, merge, save
```

Libraries load from jsDelivr at pinned versions: `@supabase/supabase-js@2.117.3`, and `@garmin/fitsdk@21.217.0` (only when you import a FIT file).

If `js/config.js` has no keys, IMPlanner runs entirely in the browser on one device (no account, no crew). If you sign in later, it offers to move that plan into your account.

## Hosting on GitHub Pages

1. Create a GitHub repository (e.g. `implanner`) and push this folder to it.
2. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The site appears at `https://<your-user>.github.io/implanner/` after a minute or two.
4. In Supabase: **Authentication → URL Configuration**. Set **Site URL** to that address and add it under **Redirect URLs**. This is only used for password-reset links.

Any static host works (Netlify, Cloudflare Pages, your own server). Use HTTPS: the browser features the app relies on need it.

## Supabase setup (already done for the IMPlanner project)

To set up a fresh project:

1. Create a free project at supabase.com (region: Canada (Central)).
2. **SQL Editor → New query**: paste `supabase/schema.sql` and run it. It is safe to re-run after changes.
3. **Authentication → Sign In / Providers**: turn **off "Confirm email"**. Supabase's built-in email service only delivers to the project's own team members, so confirmation emails would never reach your friends.
4. **Project Settings → API Keys**: copy the project URL and the **publishable** key into `js/config.js`. Never put the secret (service role) key in the site.
5. Optional: to check the privacy rules, run `supabase/rls-test.sql` in the SQL Editor. It finishes with an "error" on purpose: that error message is the report, every line should read as wanted, and everything it created is rolled back.

**Password resets.** Without custom email, the "Forgot password?" link only works for you, as the project owner. To make it work for everyone, add a free SMTP sender (e.g. Resend or Brevo) under **Authentication → Emails → SMTP Settings**. Until then, a friend who forgets their password can be removed under **Authentication → Users** and sign up again (their training data is removed with the account, so have them download a backup first if possible).

**Free-tier notes.** A free project pauses after a week with no activity at all. Your data is kept, and you restore it from the dashboard with one click. The free database holds 500 MB, which is plenty for a crew's season of workouts.

## Garmin

### Automatic sync (Garmin Personal API)

Each person can connect their own Garmin account in **Settings → Garmin Connect**:

1. Open the [Personal API Key page](https://connect.garmin.com/app/settings/personalApiToken) in Garmin Connect, select **Create Key**, accept Garmin's terms and pick an expiry (30 days to 1 year).
2. Paste the key into IMPlanner and select **Connect Garmin**. The last two weeks of workouts come in straight away.
3. From then on, new swims, rides, runs, bricks and strength sessions are pulled in whenever IMPlanner opens (at most every 10 minutes), or with **Sync now** on the Log page. Walks and other activity types are skipped.

Synced workouts are matched to the plan like imported files. If you'd already marked a session "Done as planned" or logged it by hand, the Garmin data fills in that entry (your notes and feel stay). Each Garmin workout is imported once.

How it works: the key is saved encrypted in Supabase Vault (`supabase/garmin.sql`). Nobody can read it back through the app, its owner included. Only the `garmin` Edge Function (`supabase/functions/garmin/index.ts`) can: it checks who is signed in, swaps the key for a 24-hour Garmin token, and returns that person's new workout files. Garmin doesn't allow browsers to call its API directly, which is why this step runs on the server. The key expires when you chose; renew it in Garmin Connect and use **Replace key**.

Garmin's Personal API is meant for "individual Garmin users who want programmatic access to their own data" and "not intended for commercial applications serving multiple end users". IMPlanner is non-commercial and each person connects only their own data; read the terms Garmin shows when you create a key.

Setting it up on a fresh Supabase project: run `supabase/garmin.sql` after `schema.sql`, then create an Edge Function named `garmin` with the code in `supabase/functions/garmin/index.ts` and turn **off** its "Verify JWT with legacy secret" setting (the function checks the signed-in user itself; Supabase recommends this for projects on the new JWT signing keys).

### Importing files

- **One workout**: on connect.garmin.com, open the activity → gear icon (⚙) → **Export Original**. Drop the downloaded `.zip` on the Log page as it is.
- **Your whole history**: Garmin account → Data Management → **Export Your Data**. Garmin emails a large zip; drop the `.fit` files from it on the Log page.

Duplicates are detected (same file, or same sport and start time) and left unticked.

## Training zones

Optional, under Settings: bike FTP, bike and run threshold heart rate, run threshold pace, swim CSS. With them, workout descriptions show your watts and paces, and imported workouts show time in zones (heart rate: Friel zones from threshold HR; power: Coggan zones from FTP). After changing them, use **Rebuild plan** to update future workout targets.

## Photos

The landing and setup pages use the owner's own photos from IRONMAN Mont-Tremblant (2012 and 2013), resized and stripped of camera and location data (`img/`). Original files placed in the project folder are kept out of git by `.gitignore`. To change a photo, edit `HERO` in `js/views/auth.js` or the banner in `js/views/setup.js`.

IMPlanner is an independent project. It isn't affiliated with or endorsed by IRONMAN.

The generated plan is a general template built on common Ironman training principles. It isn't medical or coaching advice: check with a doctor before starting, and adjust to how you feel.

