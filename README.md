# IMPlanner

Plan, track and share Ironman training with friends. IMPlanner scores you on **how closely you follow your own plan**, not on how far or fast you went. There are no leaderboards, segments or kudos counts. Doing much more than planned lowers your score the same way doing less does.

Built for IRONMAN Canada–Ottawa (Sunday, August 8, 2027), but any race and date works.

## What it does

- **Plan**: builds a periodized season (prep → base → build → peak → taper → race week) from your race date, current and peak weekly hours, rest day, long-ride and long-run days, swims per week, and optional strength work. Easier weeks every 3rd or 4th week. Every session is editable; drag sessions between days on the Plan page.
- **Log**: import Garmin rides and runs (`.fit`, Garmin's `.zip` "Export Original", `.tcx`, `.gpx`, several at once; multisport files are split into legs). Log swims by hand (time, distance, pool length). Each workout is matched to the planned session for that day and sport, and you can change the match.
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

The app imports files rather than syncing automatically, because Garmin's Connect API is only open to approved business partners. To get files:

- **One workout**: on connect.garmin.com, open the activity → gear icon (⚙) → **Export Original**. Drop the downloaded `.zip` on the Log page as it is.
- **Your whole history**: Garmin account → Data Management → **Export Your Data**. Garmin emails a large zip; drop the `.fit` files from it on the Log page.

Duplicates are detected (same file, or same sport and start time) and left unticked.

## Training zones

Optional, under Settings: bike FTP, bike and run threshold heart rate, run threshold pace, swim CSS. With them, workout descriptions show your watts and paces, and imported workouts show time in zones (heart rate: Friel zones from threshold HR; power: Coggan zones from FTP). After changing them, use **Rebuild plan** to update future workout targets.

## Photos

The landing and setup pages use the owner's own photos from IRONMAN Mont-Tremblant (2012 and 2013), resized and stripped of camera and location data (`img/`). Original files placed in the project folder are kept out of git by `.gitignore`. To change a photo, edit `HERO` in `js/views/auth.js` or the banner in `js/views/setup.js`.

IMPlanner is an independent project. It isn't affiliated with or endorsed by IRONMAN.

The generated plan is a general template built on common Ironman training principles. It isn't medical or coaching advice: check with a doctor before starting, and adjust to how you feel.

