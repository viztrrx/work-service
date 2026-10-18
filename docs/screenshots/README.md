# Screenshots

Pictures of the newest features, taken from the real app during the
automated tests on Oct 18, 2026 (local test server, made-up test names like
`gifta28a` and `NewKidc8y`). Phone shots are an iPhone 15 size; the wide
ones are the console on a computer. Folders are numbered in the order a
new subscriber and then the owner would see things.

| Folder | What's in it |
|---|---|
| [0-subscriber-walkthrough](#0-what-a-new-subscriber-sees-step-by-step) | **Start here:** every screen a new subscriber sees after paying, in order |
| [1-new-subscriber](#1-a-new-subscriber-after-paying-close-ups) | Making the PIN, the school email box, the confirmation, signed in |
| [2-admin-security](#2-admin--security-owner-admins-moderators) | New subscribers card, automatic month, Recent events folding, Free access |
| [3-playlists](#3-playlists-everyone-signed-in) | Spotify / Apple Music playlist → YouTube links, for everyone |
| [4-youtube-to-mp3](#4-youtube-to-mp3-owner) | The MP3 converter in Music → My music |
| [5-subscribe-page](#5-subscribe-page) | The payment page and the $6 contribution box |
| [7-student-number-and-locks](#7-student-numbers-forgot-pin-and-locked-devices) | **New:** the required student-number screen, Forgot PIN by student number, locked devices, your Sign-in help card |
| [6-pin-reset](#6-resetting-a-forgotten-pin-owner) | Forgotten PINs: **Forgot PIN?** request + your Approve (no contact needed), or a reset code |

---

## 0. What a new subscriber sees, step by step

The whole page on a phone, from coming back from Stripe to done.

**Step 1: right after paying.** "You're in, NewKid…! Payment received. Your
username is approved." Then **Create your PIN** with the red "You must
remember this PIN" box and the "I'll remember this PIN" checkbox.

<img src="0-subscriber-walkthrough/step-1-after-paying.png" width="320" alt="Step 1: back from paying, Create your PIN">

**Step 2: PIN typed twice and the checkbox ticked**, ready for **Create my
account**. (Easy PINs like 1234 are refused at this point.)

<img src="0-subscriber-walkthrough/step-2-pin-filled-in.png" width="320" alt="Step 2: PIN filled in and checkbox ticked">

**Step 3: the account is made. "One last step: add your school email."**
The box shows `@alseducation.onmicrosoft.com`; **Send my email** stays off
until 6 numbers are typed.

<img src="0-subscriber-walkthrough/step-3-email-step.png" width="320" alt="Step 3: Add your school email, empty">

**Step 4: the 6 numbers typed** ("Your email: 223929@alseducation.onmicrosoft.com").
Letters and a 7th digit can't be typed.

<img src="0-subscriber-walkthrough/step-4-email-typed.png" width="320" alt="Step 4: 223929 typed">

**Step 5: done.** "Sent: 223929@alseducation.onmicrosoft.com. Next time you're
at school, sign in at docs.google.com with that school account: the
instructions for loading Saints Service will be in your Google Docs (shared
with you)." and how to sign in. At the
same moment you (and your admins) get the alert and it appears in
Admin → Security → New subscribers.

<img src="0-subscriber-walkthrough/step-5-all-done.png" width="320" alt="Step 5: email sent, account ready, sign-in steps">

---

## 1. A new subscriber after paying (close-ups)

**The checkbox** (styled like the rest of the page: teal-to-violet when ticked).

<img src="1-new-subscriber/0-checkbox-close-up.png" width="420" alt="Ticked checkbox with the site's teal-to-violet gradient">

**Create your PIN.** The red box says they must remember it, nobody can look
it up, and if they forget it they're locked out until the owner resets it. Easy PINs (1234, 0000, 9876, a year…) are refused, and the
checkbox must be ticked.

<img src="1-new-subscriber/1-create-pin-warning.png" width="320" alt="Create your PIN with the must-remember warning and checkbox">

**Add your school email.** Only the 6 numbers are typed;
`@alseducation.onmicrosoft.com` is fixed in the box.

<img src="1-new-subscriber/2-school-email.png" width="420" alt="School email box with 223929 typed and the fixed domain">

**Done.** "Sent: 223929@alseducation.onmicrosoft.com" and how to sign in.

<img src="1-new-subscriber/3-all-done.png" width="320" alt="Account ready, email sent, sign-in steps">

**Signed in to the console** with the PIN they made ("Subscribed · renews monthly").

<img src="1-new-subscriber/4-signed-in-console.png" width="640" alt="Console signed in with the subscription strip">

---

## 2. Admin → Security (owner, admins, moderators)

**New subscribers** (owner and admins): each new subscriber's school email,
your instructions Google Doc link, **Share the Doc** (copies their email and
opens your Doc; in Google Docs: Share → paste → Send; then it's marked
Shared), Copy email, Remove.

<img src="2-admin-security/1-new-subscribers-card.png" width="640" alt="New subscribers card with an email and the Google Doc link">

**Automatic month:** someone on Allowed users who isn't a subscriber gets
"Automatic · 14 days left", Oct 1 → Nov 1.

<img src="2-admin-security/2-automatic-month.png" width="320" alt="Subscribers row with the automatic month">

**Recent events** folded (just the title and a count) and opened.

<img src="2-admin-security/3-recent-events-folded.png" width="320" alt="Recent events folded"> <img src="2-admin-security/4-recent-events-open.png" width="320" alt="Recent events open">

**Free access** given by the owner (no end date), by an admin (1 week), and
the card as a moderator sees it (under Moderation).

<img src="2-admin-security/5-free-access-owner.png" width="320" alt="Free access given by the owner"> <img src="2-admin-security/6-free-access-admin.png" width="320" alt="Free access given by an admin">

<img src="2-admin-security/7-free-access-moderator.png" width="640" alt="Free access card in Moderation for a moderator">

---

## 3. Playlists (everyone signed in)

A regular user pastes an Apple Music link; a Spotify playlist with every
song's YouTube link; and Playlists in the console on a website.

<img src="3-playlists/1-regular-user.png" width="320" alt="Regular user's Playlists"> <img src="3-playlists/2-links-found.png" width="320" alt="Spotify playlist with YouTube links">

<img src="3-playlists/3-on-a-website.png" width="640" alt="Playlists in the console on a website">

---

## 4. YouTube to MP3 (owner)

In Music → My music: the converter, converting (real progress), done
(Download MP3 / Save to My music), and on an iPhone.

<img src="4-youtube-to-mp3/1-converter.png" width="640" alt="MP3 converter">

<img src="4-youtube-to-mp3/2-converting.png" width="640" alt="Converting with progress">

<img src="4-youtube-to-mp3/3-done.png" width="640" alt="Conversion finished">

<img src="4-youtube-to-mp3/4-iphone.png" width="320" alt="Converter on an iPhone">

---

## 5. Subscribe page

The payment page, and the contribution box for people who already
subscribe (from $6).

<img src="5-subscribe-page/1-subscribe.png" width="320" alt="Subscribe page"> <img src="5-subscribe-page/2-contribute-6-dollars.png" width="320" alt="Contribute box starting at $6">

---

## 6. Resetting a forgotten PIN (owner)

**Admin → Security → Allowed users → Reset PIN** on their row (or **Reset
PIN** in Admin → Users → their name → Actions). You get a one-time code and
the exact words to tell them; **Copy code** or **Cancel reset**. They're
signed out right away and keep their account, subscription and everything in it.

<img src="6-pin-reset/1-owner-gets-reset-code.png" width="420" alt="Allowed users row with the reset code and Copy code / Cancel reset">

**What they do:** on the sign-in screen, type their username and a **new**
PIN and tap Sign in. The console asks for the **Reset code (from the owner)**.
They type it, tap Sign in again, and they're back in with the new PIN. The
code works once, for 7 days; their old PIN works until then.

<img src="6-pin-reset/2-user-types-new-pin-and-code.png" width="640" alt="Sign-in screen asking for the reset code">

**When you can't reach them at all: "Forgot PIN?"** They type their username,
tap **Forgot PIN?**, pick a new PIN, add a message, and tap **Send to the
owner**.

<img src="6-pin-reset/3-forgot-pin-request.png" width="640" alt="Forgot your PIN? form on the sign-in screen">

Their screen waits for you, and signs them in by itself once you approve.

<img src="6-pin-reset/4-forgot-pin-waiting.png" width="640" alt="Waiting for the owner to approve">

**Your side** (Admin → Security → Allowed users, plus a phone alert): the
request, whether it came from **the device they usually use**, their message,
and **Approve new PIN** / **Deny**.

<img src="6-pin-reset/5-owner-approves.png" width="420" alt="Allowed users row: Forgot PIN, from the device they usually use, Approve new PIN / Deny">

---

## 7. Student numbers, Forgot PIN and locked devices

**Required student number.** Anyone signed in without one on file gets this
screen. It can't be closed or skipped, the boxes stay off for 8 seconds so
they read it, they tick the box, and they type the 6 digits twice (digits
only).

<img src="7-student-number-and-locks/1-student-number-required.png" width="640" alt="Add your school student number: read first, boxes off">

<img src="7-student-number-and-locks/2-student-number-filled.png" width="640" alt="Student number typed twice, Save turns on">

**Forgot PIN asks for the student number.** A wrong number is refused (shown
here); the right one sets the new PIN at once and signs them in.

<img src="7-student-number-and-locks/3-forgot-pin-wrong-number.png" width="640" alt="Forgot PIN with a student number; wrong number refused">

**No number on file:** it goes to you and your admins, and they're told to
check back every 10 minutes.

<img src="7-student-number-and-locks/4-waiting-check-back-10-min.png" width="640" alt="Sent to the owner and admins, check back every 10 minutes">

**Your Sign-in help card** (Admin → Security, you and admins): the request
with the number they gave, **Approve new PIN** / **Deny**.

<img src="7-student-number-and-locks/5-owner-request.png" width="420" alt="Sign-in help: Forgot PIN request">

**Unauthorized attempts lock the device** (3 names that aren't approved, or 5
wrong PINs/codes/numbers in an hour) until the end of the day session (12 PM
New York time; this test computer shows its own time zone). Nothing under it
works, and reloading doesn't help.

<img src="7-student-number-and-locks/6-device-locked.png" width="640" alt="This device is locked">

**You and your admins** get an alert, and Sign-in help shows the device and
the names it tried: **Approve (unlock)** or **Keep locked until the session
ends**.

<img src="7-student-number-and-locks/7-owner-locked-device.png" width="420" alt="Sign-in help: locked device with Approve (unlock) / Keep locked">

**Everyone's school email and the log.**

<img src="7-student-number-and-locks/8-owner-emails-and-log.png" width="420" alt="Approved people with school emails, and the Sign-in help log">
