# CU Boulder Sign Messaging Review

A web app for reviewing wayfinding sign messaging for the CU Boulder campus wayfinding project.

**Built by [SIGNALS Studio](https://sendoutsignals.com)**

## Usage

### Option A: Google Sheets (recommended)
1. Open the app and click **Connect to Google Sheets**
2. Sign in with a Google account that has access to the Sheet
3. Sign data loads automatically from the MESSAGING tab
4. Approvals, edits, and flags write back to the Sheet in real-time

### Option B: CSV upload (fallback)
1. Export the MESSAGING tab from the Google Sheet as CSV (File → Download → CSV)
2. Open the app and drop the CSV onto the load screen
3. Review signs one at a time — approve, edit destinations, or flag for discussion
4. Use the Map Overview to see all signs at once
5. Export the reviewed CSV and import back into the Google Sheet

## File structure

```
index.html       ← HTML shell
style.css        ← All styles + light/dark mode
app.js           ← Core state, CSV parsing, rendering, actions, maps
firebase.js      ← Firebase Realtime DB sync, activity feed, reviewer identity
sheets.js        ← Google Sheets API OAuth + read/write
CUB_SignReview.html ← Archive: original monolithic file
```

## Google Sheets Setup

To enable the Sheets integration:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable **Google Sheets API**
4. Configure **OAuth consent screen** → External → Add scope `spreadsheets`
5. Create **OAuth 2.0 Client ID** (Web application) with origins:
   - `http://localhost`
   - `https://greensignals.vercel.app`
6. Copy the Client ID into `sheets.js` → `SHEETS_CLIENT_ID`

## Deploy

Hosted via Vercel. Any push to `main` triggers a redeploy.
