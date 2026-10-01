# Google setup: your own OAuth client

gcalcli needs an OAuth client that belongs to you before it can read your
calendar. You do this once, in your browser, and it takes about 20 minutes. It
costs nothing, and no billing account is needed.

**The one step that matters most is step 5.** Your app has to be **In
production**, not "Testing". A login made while the app is in Testing stops
working after 7 days.

## 1. Create a project

1. Open <https://console.cloud.google.com> and sign in with the Google account
   whose calendar you want.
2. Click the project picker at the top, then **New project**. Name it, for
   example `gcalcli-personal`, and click **Create**.
3. Make sure the new project is selected in the picker.

## 2. Turn on the Calendar API

**APIs & Services → Library**: search for **Google Calendar API**, open it, and
click **Enable**.

## 3. Set up the consent screen

Open **Google Auth Platform** (formerly the "OAuth consent screen") and click
**Get started**. Then fill in each part:

- **App information:** App name `gcalcli`. User support email: your address.
- **Audience:** **External**.
- **Contact information:** your address.
- **Finish:** tick the agreement to the Google API Services User Data Policy,
  then **Create**.

## 4. Give it a homepage and privacy page

Google won't let you publish (step 5) until Branding has an **Application home
page** and a **privacy policy link**, both on a domain you list under
**Authorized domains**.

GitHub Pages works and is free:

1. Create a public repository, for example `gcalcli-personal`, with two files:

   `index.html`

   ```html
   <!doctype html>
   <html lang="en"><head><meta charset="utf-8"><title>gcalcli (personal)</title></head>
   <body>
   <h1>gcalcli (personal)</h1>
   <p>A private, single-user OAuth client for gcalcli, used by one person to read and add
   events on their own Google Calendar from their own computer. <a href="privacy.html">Privacy policy</a>.</p>
   </body></html>
   ```

   `privacy.html`

   ```html
   <!doctype html>
   <html lang="en"><head><meta charset="utf-8"><title>Privacy</title></head>
   <body>
   <h1>Privacy policy</h1>
   <p>This OAuth client is used only by its owner, on their own computer, to access their own
   Google Calendar through gcalcli. Calendar data is read and written only at the owner's
   request and cached only on the owner's machine. Nothing is sent to anyone but Google.
   Access can be revoked at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>
   </body></html>
   ```

2. In that repository, go to **Settings → Pages**, set the source to the `main`
   branch, and **Save**. After a minute the site is live at
   `https://<your-username>.github.io/gcalcli-personal/`.
3. Back in **Google Auth Platform → Branding**:
   - Application home page: `https://<your-username>.github.io/gcalcli-personal/`
   - Application privacy policy link: `https://<your-username>.github.io/gcalcli-personal/privacy.html`
   - Authorized domains: **Add domain**, then `<your-username>.github.io`
   - Click **Save**.

Leave **App logo** empty. Uploading a logo means Google has to review the app.

## 5. Publish the app

**Google Auth Platform → Audience → Publish app → Confirm.** Publishing status
must now say **In production**.

You don't need to submit for verification. An unverified app is fine for your
own use. You'll just see a warning screen when you sign in (step 7).

## 6. Create the OAuth client

**Google Auth Platform → Clients → Create client**:

1. Application type: **Desktop app**. Name: `gcalcli`.
2. Click **Create**.
3. Keep the dialog open. It shows the **Client ID** and the **Client secret**,
   and the secret is shown only this once. You can also download the JSON.

Don't share the secret or paste it anywhere else.

## 7. Sign in with gcalcli

In a terminal:

```bash
gcalcli init
```

1. Paste the **Client ID**, then the **Client secret**.
2. A browser tab opens. Pick your account.
3. Google says **"Google hasn't verified this app"**. That's expected for your
   own client. Click **Advanced → Go to gcalcli (unsafe)**.
4. Click **Continue** to allow calendar access.
5. The terminal says the credentials loaded. Check it worked:

   ```bash
   gcalcli list
   ```

Your calendars should be listed. Now go back to the install steps in the
[README](README.md).

## If something goes wrong

| What you see | Fix |
|---|---|
| "Access blocked: gcalcli has not completed the Google verification process" (Error 403 access_denied) | The app is still in **Testing**. Do steps 4 and 5, then run `gcalcli init` again. |
| **Publish app** is greyed out | Branding is missing the homepage, privacy link or authorized domain (step 4). Fill them in and **Save**. |
| The login worked, but stops after a week | It was made while the app was in Testing. Publish it (step 5), then run `gcalcli init` again. |
| `calsync-doctor` says auth failed | Access was revoked or the password changed. Run `gcalcli init` again. |
| Lost the client secret | **Clients → your client**: add a new secret (or make a new Desktop client), then run `gcalcli init` again. |
