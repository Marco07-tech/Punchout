# Security Model & QA Report — Punchout

## Threat Model (Plain Words)

Punchout is a **single-user, offline-first habit tracker** with no backend server, no accounts, no login, and no analytics.

- **Where data lives:** Everything (`habitStore.v1`, `habitStore.v1.prev`, and `punchout.settings.v1`) is stored locally in browser `localStorage` on the user's device.
- **Trust boundaries:**
  1. **Untrusted input from backups / tampered storage:** A user can paste or import a `.json` backup file from outside the app, or browser `localStorage` can be modified by extensions or developer tools.
  2. **Cross-Site Scripting (XSS) via stored strings:** Habit names, custom exercises/topics, and imported strings are rendered into the DOM across Home cards, the Picker, Stats, the Receipt/Bill, Banners, and Settings.
  3. **Browser storage limits:** Filling `localStorage` (`QuotaExceededError`) could silently drop changes or leave in-memory state out of sync with stored state.
  4. **Network & third-party code:** The app must never exfiltrate habit data or load third-party scripts.

---

## What Was Tested

Automated verification lives in [`test-security.js`](test-security.js), [`test-ui.js`](test-ui.js), and [`test-streaks.js`](test-streaks.js), all executed by `npm test`:

1. **XSS Injection Tests:** Habit names, custom gym exercises/study topics, imported backups, receipt/bill lines, stats cards, and notification banners tested with `<script>`, `<img src=x onerror=...>`, `"><svg onload=...>`, `javascript:`, and long Unicode strings. Verified zero script execution and plain-text rendering.
2. **Import / Restore Validation:** Tested empty input, whitespace, oversized files (`> 512 KB`), JSON arrays instead of objects, `NaN`/negative/out-of-range intervals, invalid time strings (`99:99`), invalid categories, days outside `0..6`, habit names `> 100` chars, `> 100` habits, unknown keys, and prototype-pollution keys (`__proto__`, `constructor`, `prototype`). Verified invalid backups are rejected with an error message and never overwrite existing data.
3. **`localStorage` Tampering:** Seeded corrupted `habitStore.v1` containing duplicate habit IDs, wrong types, out-of-range days, invalid `99:99` times, null/negative intervals, `__proto__` keys, and valid 1-hour Water intervals (`intervalNum: 1, intervalUnit: "hours"`). Verified safe recovery without crashing or losing readable habits.
4. **Storage Quota (`QuotaExceededError`):** Simulated a full `localStorage` when saving a habit, ticking a habit, and importing a backup. Verified a visible error banner is shown and in-memory state rolls back cleanly.
5. **Content Security Policy & Referrer Policy:** Verified `<meta http-equiv="Content-Security-Policy">` blocks `fetch()` (`connect-src 'none'`) and external `<script>` loads, and `<meta name="referrer" content="no-referrer">` is set.
6. **Supply Chain & Git History Audit:** Ran `npm audit` (`0 vulnerabilities`), verified `package.json` has zero runtime `dependencies` (devDependencies only), verified `index.html` loads zero external `<script>` tags, and scanned source diffs in `git log -p` for secrets, tokens, or PII (`0` hits).
7. **Privacy Audit:** Recorded all Playwright network requests across full app usage (only local `file://` / `blob:` and Google Fonts CSS/WOFF2), verified zero cookies, empty `sessionStorage`, and minimal export payload (`app`, `version`, `exportedAt`, `data`, `settings`).
8. **Android Manifest Static Check:** Inspected `android/app/src/main/AndroidManifest.xml` for `android:allowBackup="false"`, `android:usesCleartextTraffic="false"`, and minimal permissions (`INTERNET` only).

---

## What Was Fixed

- **Strict Backup Schema & Prototype Pollution Protection:** Added `MAX_IMPORT_BYTES` (512 KB), `MAX_HABITS` (100), `MAX_LOG_DAYS` (2000), recursive `hasPoisonKey` check blocking `__proto__`, `constructor`, and `prototype`, strict allowlists for root/data/habit/settings keys, time validation (`00:00`–`23:59`), and safe object sanitization shared across `loadData` and `applyImport`.
- **`localStorage` Tampering Recovery:** Deduplicated habit IDs, enforced safe ID characters (`/^[a-zA-Z0-9_-]{1,40}$/`), fixed `fixHabit` so 1-hour Water intervals (`intervalNum >= 1`) are preserved instead of overwritten, sanitized `log` and `customExercises` on startup, and capped long habit names/custom items cleanly with `overflow-wrap: anywhere`.
- **Atomic Save & `QuotaExceededError` Handling:** Added `commitData` rollback and visible error banner/tone in `saveData()` so a full `localStorage` never fails silently or leaves half-written in-memory state.
- **CSP & Referrer Headers:** Added `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';">` (with `crossorigin="anonymous"` on the Google Fonts stylesheet link) and `<meta name="referrer" content="no-referrer">`.
- **Nav Clearance:** Added `scroll-margin-bottom: 96px` so scrolled controls do not get hidden under the fixed bottom navigation bar.

---

## Known Limitations & Accepted Risks

1. **CSP `script-src 'unsafe-inline'` and `style-src 'unsafe-inline'`:** Punchout is intentionally a single hand-edited `index.html` with no build pipeline or HTTP server to generate per-request cryptographic nonces, and works directly over `file://` and Capacitor's local WebView. Inline `<script>`, `<style>`, inline `style="..."` attributes, and the stylesheet `onload="this.media='all'"` handler therefore require `'unsafe-inline'`. This is mitigated by escaping every dynamic string via `esc(...)` before HTML interpolation and disallowing `eval` (`'unsafe-eval'` is omitted), external scripts, `connect-src`, `object-src`, `base-uri`, and `form-action`.
2. **Unencrypted Local Storage:** Because there is no login or user passphrase, `localStorage` data is stored as plaintext JSON on the device and can be read by anyone with physical/OS access to the browser profile or cleared if browser site data is wiped.
3. **Google Fonts Requests When Online:** Loading `Space Grotesk` and `Space Mono` contacts `fonts.googleapis.com` and `fonts.gstatic.com` when online; the app falls back to system fonts (`system-ui`, `monospace`) when offline.
4. **Testing Query Parameter (`?date=YYYY-MM-DD`):** Intended for automated tests and local date simulation; it only changes which local date the UI treats as "today" and does not expose data externally.
5. **Android `INTERNET` Permission:** Retained in `AndroidManifest.xml` for Capacitor WebView / font loading with `usesCleartextTraffic="false"` and `allowBackup="false"`.
