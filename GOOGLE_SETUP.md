# Connecting Google Calendar for Omarchy to your Google account

You'll need about **20 minutes, once**. It's all free: no credit card, no
billing account. Just follow the steps in order.

## Why this is needed

Before any program can read a Google Calendar, Google wants it to have its own
"app" registered in Google's developer console. Big shared apps go through a
long review by Google. For something personal like this, the simple route is
for **you to register your own private app**, used only by you, and point it at
your own calendar.

So in this guide you will:

1. **Make a project** in Google Cloud: a folder for your app.
2. **Switch on the Google Calendar API**, which lets the app talk to Calendar.
3. **Describe your app** on Google's consent screen (its name and links).
4. **Publish it.** This step matters: without it, your sign-in stops working
   after 7 days.
5. **Create a key pair**, a *Client ID* and *Client secret*. This is your app's
   username and password with Google.
6. **Sign in once** with `gcalcli init`. After that it just works.

Your data only ever goes between your computer and Google. See the
[privacy policy](https://dawestheperson.github.io/omarchy-google-calendar/privacy.html).

## Before you start

- [ ] gcalcli is installed: `omarchy pkg aur add gcalcli`
- [ ] You know which Google account has your calendar
- [ ] You have a browser where you're signed in to that account

---

## Step 1: Make a project

1. Go to **<https://console.cloud.google.com>** and sign in with your calendar's
   Google account. If it asks you to accept Google Cloud's terms, accept them.
   You **don't** need the free trial or a billing account; ignore those
   banners.
2. At the top left, click the **project picker** (it may say "Select a
   project"), then **New project**.
3. **Project name:** `Google Calendar for Omarchy`. Leave the rest as it is,
   then click **Create**.
4. Wait a few seconds. In the project picker, make sure your new project is
   selected.

✅ The top bar shows **Google Calendar for Omarchy**.

## Step 2: Switch on the Google Calendar API

1. Open the menu (☰) → **APIs & Services → Library**.
2. Search for **Google Calendar API** and click it.
3. Click **Enable**.

✅ The page now says **API enabled** (or the button changes to **Manage**).

## Step 3: Describe your app (the consent screen)

1. Open the menu (☰) → **Google Auth Platform**. In older consoles this was
   **APIs & Services → OAuth consent screen**.
2. Click **Get started**. A four-part form opens:
   - **App information.** App name: `Google Calendar for Omarchy`. User support
     email: pick your address. Click **Next**.
   - **Audience.** Choose **External** (personal Gmail accounts can't pick
     Internal). Click **Next**.
   - **Contact information.** Type your email address and press Enter. Click
     **Next**.
   - **Finish.** Tick **I agree to the Google API Services: User Data Policy**,
     click **Continue**, then **Create**.
3. In the left sidebar, open **Branding** and scroll to **App domain**. Fill in:
   - **Application home page:**
     `https://dawestheperson.github.io/omarchy-google-calendar/`
   - **Application privacy policy link:**
     `https://dawestheperson.github.io/omarchy-google-calendar/privacy.html`
   - Under **Authorized domains**, click **+ Add domain** and enter
     `dawestheperson.github.io`
4. Leave **App logo** empty. A logo makes Google require a review.
5. Click **Save** at the bottom.

✅ You see "Branding changes saved".

> The homepage and privacy page are this project's own. They cover the way
> every user uses it: a private app per person, with no shared server. Google
> needs these links before it lets you publish (next step). If you'd rather
> host your own pages, see [Hosting your own pages](#hosting-your-own-pages).

## Step 4: Publish the app (don't skip this)

1. In the left sidebar, open **Audience**.
2. Under **Publishing status**, click **Publish app**, then **Confirm**.

✅ Publishing status says **In production**.

**Why it matters:** while an app is in "Testing", Google expires every sign-in
after 7 days, and your calendar would stop updating every week. You do **not**
need to "Submit for verification". An unverified app is fine for your own
use; it just shows a warning screen when you sign in (step 6).

If **Publish app** is greyed out, the Branding links from step 3 are missing or
weren't saved. Go back, fill them in, and click **Save**.

## Step 5: Create your key pair (Client ID and secret)

1. In the left sidebar, open **Clients**, then click **+ Create client**.
2. **Application type:** **Desktop app**.
3. **Name:** `Google Calendar for Omarchy`. This is only shown to you.
4. Click **Create**.
5. A dialog shows your **Client ID** and **Client secret**. Click
   **Download JSON**, or keep the dialog open for the next step. **Google shows
   the secret only this once.**

🔒 Treat the secret like a password. Don't post it, screenshot it, or paste it
anywhere except the next step.

## Step 6: Sign in once

Open a terminal and run:

```bash
gcalcli init
```

1. When it asks for the **Client ID**, paste it and press Enter.
2. When it asks for the **Client secret**, paste it and press Enter.
3. A browser tab opens. Choose your Google account.
4. You'll see **"Google hasn't verified this app."** That's expected: it's your
   own app. Click **Advanced**, then **Go to Google Calendar for Omarchy
   (unsafe)**.
5. Google lists what the app may do (see and edit your calendars). Click
   **Continue**.
6. The browser says you can close the window. The terminal says
   `Successfully loaded credentials`.

✅ Check it worked:

```bash
gcalcli list
```

You should see your calendars listed. **You're done with Google.** Go back to
the [install steps in the README](README.md#install).

---

## If something goes wrong

| What you see | What to do |
|---|---|
| **"Access blocked: … has not completed the Google verification process"** (Error 403: access_denied) | The app is still in Testing. Do step 4 (Publish), then run `gcalcli init` again. |
| **Publish app** is greyed out | The homepage, privacy link or authorized domain from step 3 is missing or unsaved. Fill them in and click **Save**. |
| The calendar worked, then stopped about a week later | Your sign-in was made while the app was in Testing. Publish it (step 4), then run `gcalcli init` again. |
| `gcalcli init` doesn't open a browser | Copy the long `https://accounts.google.com/...` link it prints into your browser. |
| You lost the Client secret | **Clients** → your client → **Add secret** (or create a new Desktop client), then run `gcalcli init` again. |
| `calsync-doctor` says the login failed | Access was removed or your password changed. Run `gcalcli init` again. |
| Google says the app name isn't allowed | Use a different name, e.g. `Calendar for Omarchy`. Only you see it. |

## Hosting your own pages

Optional. Instead of the project's homepage and privacy page, you can publish
your own with GitHub Pages:

1. Create a public repository with an `index.html` (one line saying what the
   app is) and a `privacy.html`. You can copy and edit
   [docs/privacy.html](docs/privacy.html).
2. In that repository: **Settings → Pages**, source **main** branch, then
   **Save**.
3. In step 3, use your own `https://<you>.github.io/<repo>/` links and
   authorized domain `<you>.github.io`.
