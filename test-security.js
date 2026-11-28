const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const assert = require("assert");
const { chromium } = require("playwright");

const APP_URL = pathToFileURL(path.resolve(__dirname, "index.html")).href;
const MANIFEST_PATH = path.resolve(__dirname, "android/app/src/main/AndroidManifest.xml");
const PKG_PATH = path.resolve(__dirname, "package.json");

async function run() {
  const browser = await chromium.launch();
  let passed = 0;
  const failures = [];

  async function test(name, fn, { allowConsoleError = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", e => errors.push(e.message));
    try {
      await fn(page, errors);
      if (!allowConsoleError && errors.length) {
        throw new Error("Console/page errors: " + errors.join(" | "));
      }
      passed++;
      console.log("  PASS:", name);
    } catch (err) {
      failures.push({ name, err });
      console.log("  FAIL:", name, "->", err.message);
    } finally {
      await context.close();
    }
  }

  console.log("\n=== Security Test Suite ===");

  // 1. XSS across habit names, custom exercises/topics, imports, bill, stats, banner, settings
  await test("1. XSS payloads render as plain text and execute zero scripts everywhere", async (page) => {
    await page.goto(APP_URL + "?date=2026-11-09");
    await page.evaluate(() => { window.__xssTriggered = 0; });
    const payloads = [
      '<script>window.__xssTriggered++</script>',
      '<img src=x onerror="window.__xssTriggered++">',
      '"><svg onload="window.__xssTriggered++">',
      'javascript:window.__xssTriggered++',
      'नमस्ते 🏋️‍♂️ ' + '🔥'.repeat(15)
    ];

    for (let i = 0; i < payloads.length; i++) {
      await page.click('.nav [data-go="newHabit"]');
      await page.click('input[name="category"][value="Custom"]', { force: true });
      await page.fill("#habitName", payloads[i]);
      await page.click("#everyDay");
      await page.click("#saveHabit");
    }

    // Add Gym & Study habits with XSS custom exercise/topic
    await page.click('.nav [data-go="newHabit"]');
    await page.click('input[name="category"][value="Gym"]', { force: true });
    await page.fill("#habitName", '<img src=x onerror="window.__xssTriggered++">Gym');
    await page.click("#everyDay");
    await page.click("#saveHabit");

    await page.locator('#habitList [data-act="choose"]').first().click();
    page.once("dialog", d => d.accept('"><svg onload=window.__xssTriggered++>'));
    await page.click("#addCustom");
    await page.click("#confirm");

    // Verify all payloads appear as plain text on Home and none executed
    const homeText = await page.textContent("#habitList");
    assert(homeText.includes('<script>window.__xssTriggered++</script>'), "Script payload missing as text on Home");
    assert(homeText.includes('javascript:window.__xssTriggered++'), "javascript: payload missing as text on Home");
    assert(homeText.includes('"><svg onload=window.__xssTriggered++>'), "Custom exercise payload missing as text on Home");

    // Check Stats
    await page.click('.nav [data-go="stats"]');
    const statsText = await page.textContent("#statsBody");
    assert(statsText.includes('<img src=x onerror="window.__xssTriggered++">'), "Payload missing as text in Stats");

    // Complete all habits -> Bill
    await page.click('.nav [data-go="home"]');
    const boxes = page.locator("#habitList input.check");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      await boxes.nth(i).scrollIntoViewIfNeeded();
      await boxes.nth(i).click();
    }
    await page.waitForTimeout(750);
    const billText = await page.textContent("#paperWin");
    assert(billText.includes('<script>window.__xssTriggered++</script>'), "Payload missing as text in Bill");
    await page.click("#billClose");

    // Also test XSS payloads delivered via JSON import
    await page.click('#home [data-go="settings"]');
    await page.click("#backupDetails summary");
    const xssImport = JSON.stringify({
      app: "punchout", version: 1,
      data: {
        habits: [{ id: "imp1", name: '<img src=x onerror="window.__xssTriggered++">Imp', category: "Custom", days: [0,1,2,3,4,5,6], createdAt: "2026-11-09" }],
        log: {}, customExercises: {}
      }
    });
    await page.fill("#importText", xssImport);
    page.once("dialog", d => d.accept());
    await page.click("#importBackup");
    await page.click("#settingsClose");
    assert((await page.textContent("#habitList")).includes('<img src=x onerror="window.__xssTriggered++">Imp'), "Imported XSS payload missing as text");

    // Check Banner with XSS name (via reminder banner)
    await page.evaluate(() => {
      showBanner('<img src=x onerror=window.__xssTriggered++> reminder', 4000);
    });
    assert((await page.textContent("#banner")).includes('<img src=x onerror=window.__xssTriggered++>'), "Banner XSS payload missing as text");
    assert.strictEqual(await page.evaluate(() => window.__xssTriggered), 0, "XSS script executed!");
  });

  // 2. Import/restore hardening
  await test("2. Import rejects empty, huge, prototype pollution, wrong types, out-of-range, unknown keys without overwriting", async (page) => {
    await page.goto(APP_URL + "?date=2026-11-09");
    await page.click('[data-go="newHabit"]');
    await page.click('input[name="category"][value="Code"]', { force: true });
    await page.click("#everyDay");
    await page.click("#saveHabit");

    await page.click('#home [data-go="settings"]');
    await page.click("#backupDetails summary");
    page.on("dialog", d => d.accept());

    const invalidInputs = [
      { label: "empty string", text: "" },
      { label: "whitespace only", text: "   \n  " },
      { label: "huge payload (>512KB)", text: JSON.stringify({ app: "punchout", version: 1, data: { habits: [], log: { "2026-11-09": { h1: true } }, pad: "x".repeat(600 * 1024) } }) },
      { label: "array root", text: "[]" },
      { label: "prototype pollution in log", text: '{"app":"punchout","version":1,"data":{"habits":[],"log":{"__proto__":{"polluted":true},"2026-11-09":{"__proto__":true}}}}' },
      { label: "prototype pollution in customExercises", text: '{"app":"punchout","version":1,"data":{"habits":[],"log":{},"customExercises":{"__proto__":["evil"],"constructor":["evil"]}}}' },
      { label: "unknown top-level key", text: JSON.stringify({ app: "punchout", version: 1, evil: 123, data: { habits: [], log: {} } }) },
      { label: "invalid category", text: JSON.stringify({ app: "punchout", version: 1, data: { habits: [{ id: "x1", name: "Test", category: "Hacked", days: [0] }], log: {} } }) },
      { label: "out-of-range days", text: JSON.stringify({ app: "punchout", version: 1, data: { habits: [{ id: "x1", name: "Test", category: "Code", days: [0, 9] }], log: {} } }) },
      { label: "invalid reminder time 99:99", text: JSON.stringify({ app: "punchout", version: 1, data: { habits: [{ id: "x1", name: "Test", category: "Code", days: [0], reminder: "99:99" }], log: {} } }) },
      { label: "negative intervalNum", text: JSON.stringify({ app: "punchout", version: 1, data: { habits: [{ id: "x1", name: "Test", category: "Water", days: [0], intervalNum: -5, intervalUnit: "minutes" }], log: {} } }) },
      { label: "habit name > 100 chars", text: JSON.stringify({ app: "punchout", version: 1, data: { habits: [{ id: "x1", name: "A".repeat(120), category: "Code", days: [0] }], log: {} } }) },
      { label: "> 100 habits", text: JSON.stringify({ app: "punchout", version: 1, data: { habits: Array.from({ length: 101 }, (_, i) => ({ id: "h" + i, name: "H" + i, category: "Code", days: [0] })), log: {} } }) }
    ];

    for (const c of invalidInputs) {
      await page.fill("#importText", c.text);
      await page.click("#importBackup");
      const note = await page.textContent("#importNote");
      assert(note.length > 0 && !/Restore complete/i.test(note), `Case "${c.label}" should be rejected, got note: "${note}"`);
      const count = await page.evaluate(() => data.habits.length);
      assert.strictEqual(count, 1, `Case "${c.label}" overwrote existing habit!`);
      const firstName = await page.evaluate(() => data.habits[0].name);
      assert.strictEqual(firstName, "Code", `Case "${c.label}" mutated existing habit!`);
      const polluted = await page.evaluate(() => ({}).polluted === true || Array.isArray(Object.getPrototypeOf(data.customExercises)));
      assert.strictEqual(polluted, false, `Case "${c.label}" polluted prototype!`);
    }
  });

  // 3. localStorage tampering
  await test("3. localStorage tampering: invalid fields sanitized, duplicate IDs fixed, 1-hour Water preserved, valid data kept", async (page) => {
    await page.goto(APP_URL + "?date=2026-11-09");
    await page.evaluate(() => {
      localStorage.setItem("habitStore.v1", '{"habits":[' +
        '{"id":"dup","name":"Water","category":"Water","days":[0,1,2,3,4,5,6],"intervalNum":1,"intervalUnit":"hours","reminder":"99:99","createdAt":"2026-11-09"},' +
        '{"id":"dup","name":"Code","category":"Code","days":[0,99,-1,"bad"],"intervalNum":null,"createdAt":"2026-11-09"},' +
        '{"id":"bad1","name":"","category":"Code","days":[0]},' +
        '42,null' +
        '],"log":{"2026-11-09":{"dup":true,"__proto__":true},"bad-date":{"dup":true},"2026-11-10":"bad"},' +
        '"customExercises":{"__proto__":["hack"],"Chest":["Bench Press",123,""]}}');
    });
    await page.reload();
    const state = await page.evaluate(() => ({
      count: data.habits.length,
      ids: data.habits.map(h => h.id),
      waterInterval: data.habits[0].intervalNum,
      waterReminder: data.habits[0].reminder,
      codeDays: data.habits[1].days,
      logKeys: Object.keys(data.log),
      dayKeys: Object.keys(data.log["2026-11-09"] || {}),
      protoOk: !Array.isArray(Object.getPrototypeOf(data.customExercises))
    }));
    assert.strictEqual(state.count, 2, "Expected 2 valid habits preserved");
    assert.notStrictEqual(state.ids[0], state.ids[1], "Duplicate IDs must be resolved");
    assert.strictEqual(state.waterInterval, 1, "1-hour Water interval must be preserved, got: " + state.waterInterval);
    assert.strictEqual(state.waterReminder, "07:15", "Invalid time 99:99 must fall back to 07:15");
    assert.deepStrictEqual(state.codeDays, [0], "Out-of-range days must be stripped");
    assert.deepStrictEqual(state.logKeys, ["2026-11-09"], "Invalid log date key must be stripped");
    assert.deepStrictEqual(state.dayKeys, ["dup"], "__proto__ key in log must be stripped");
    assert.strictEqual(state.protoOk, true, "customExercises prototype must not be polluted");
  });

  // 4. Storage limits (QuotaExceededError)
  await test("4. QuotaExceededError shows visible error and rolls back failed save without half-written state", async (page) => {
    await page.goto(APP_URL + "?date=2026-11-09");
    await page.click('[data-go="newHabit"]');
    await page.click('input[name="category"][value="Code"]', { force: true });
    await page.click("#everyDay");
    await page.click("#saveHabit");

    // Simulate full localStorage
    await page.evaluate(() => {
      const origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "habitStore.v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
        return origSet.call(this, k, v);
      };
    });

    // Attempt to add a 2nd habit while storage is full
    await page.click('.nav [data-go="newHabit"]');
    await page.click('input[name="category"][value="Custom"]', { force: true });
    await page.fill("#habitName", "ShouldRollback");
    await page.click("#everyDay");
    await page.click("#saveHabit");

    const bannerHidden = await page.getAttribute("#banner", "hidden");
    const bannerText = await page.textContent("#banner");
    assert.strictEqual(bannerHidden, null, "Visible error banner must appear when storage is full");
    assert.match(bannerText, /storage|full|could not be saved/i);

    const state = await page.evaluate(() => ({
      memCount: data.habits.length,
      storedCount: JSON.parse(localStorage.getItem("habitStore.v1")).habits.length
    }));
    assert.strictEqual(state.memCount, 1, "In-memory data must roll back on failed save");
    assert.strictEqual(state.storedCount, 1, "Stored data must remain intact");
  });

  // 5. CSP & Referrer Policy headers
  await test("5. Strict CSP and Referrer-Policy meta tags present and block disallowed vectors", async (page) => {
    await page.goto(APP_URL + "?date=2026-11-09");
    const metas = await page.evaluate(() => ({
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") || "",
      ref: document.querySelector('meta[name="referrer"]')?.getAttribute("content") || ""
    }));
    assert(metas.csp.includes("default-src 'none'"), "Missing default-src 'none' in CSP");
    assert(metas.csp.includes("connect-src 'none'"), "Missing connect-src 'none' in CSP");
    assert(metas.csp.includes("object-src 'none'"), "Missing object-src 'none' in CSP");
    assert(metas.csp.includes("base-uri 'none'"), "Missing base-uri 'none' in CSP");
    assert(metas.csp.includes("form-action 'none'"), "Missing form-action 'none' in CSP");
    assert.strictEqual(metas.ref, "no-referrer", "Missing referrer no-referrer meta");

    // Verify connect-src 'none' blocks fetch and script-src blocks external scripts
    const cspBlocks = await page.evaluate(async () => {
      let fetchBlocked = false;
      try { await fetch("https://example.com"); } catch (e) { fetchBlocked = true; }
      let scriptBlocked = false;
      await new Promise(res => {
        const s = document.createElement("script");
        s.src = "https://example.com/evil.js";
        s.onerror = () => { scriptBlocked = true; res(); };
        s.onload = () => res();
        document.head.appendChild(s);
      });
      return { fetchBlocked, scriptBlocked };
    });
    assert.strictEqual(cspBlocks.fetchBlocked, true, "CSP connect-src 'none' must block fetch()");
    assert.strictEqual(cspBlocks.scriptBlocked, true, "CSP script-src must block external script");
  }, { allowConsoleError: true });

  // 6 & 7. Supply chain & Privacy
  await test("6 & 7. Privacy & supply chain: only Google Fonts external requests, localStorage-only, clean export", async (page) => {
    const externalReqs = [];
    page.on("request", req => {
      const u = req.url();
      if (!u.startsWith("file://") && !u.startsWith("blob:") && !u.startsWith("data:")) {
        externalReqs.push(u);
      }
    });

    await page.goto(APP_URL + "?date=2026-11-09");
    await page.click('[data-go="newHabit"]');
    await page.click('input[name="category"][value="Code"]', { force: true });
    await page.click("#everyDay");
    await page.click("#saveHabit");
    await page.click('#habitList input.check', { force: true });
    await page.waitForTimeout(750);
    await page.click("#billClose");
    await page.click('.nav [data-go="stats"]');
    await page.click('.nav [data-go="home"]');
    await page.click('#home [data-go="settings"]');
    await page.click("#backupDetails summary");
    await page.click("#exportBackup");

    for (const u of externalReqs) {
      assert(
        u.startsWith("https://fonts.googleapis.com/") || u.startsWith("https://fonts.gstatic.com/"),
        "Unexpected external request: " + u
      );
    }

    const storageAudit = await page.evaluate(() => ({
      cookie: document.cookie,
      sessionLen: sessionStorage.length,
      localKeys: Object.keys(localStorage),
      exportKeys: Object.keys(buildExportJSON()),
      exportDataKeys: Object.keys(buildExportJSON().data)
    }));
    assert.strictEqual(storageAudit.cookie, "", "Expected no cookies");
    assert.strictEqual(storageAudit.sessionLen, 0, "Expected empty sessionStorage");
    assert.deepStrictEqual(storageAudit.exportKeys, ["app", "version", "exportedAt", "data", "settings"]);
    assert.deepStrictEqual(storageAudit.exportDataKeys, ["habits", "log", "customExercises"]);

    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
    assert(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, "Runtime dependencies must be empty");
    const html = fs.readFileSync(path.resolve(__dirname, "index.html"), "utf8");
    const externalScripts = [...html.matchAll(/<script[^>]+src=/gi)];
    assert.strictEqual(externalScripts.length, 0, "index.html must load no external scripts");
  });

  // 8. AndroidManifest static check
  await test("8. AndroidManifest: allowBackup=false, usesCleartextTraffic=false, minimal permissions", async () => {
    const xml = fs.readFileSync(MANIFEST_PATH, "utf8");
    assert(xml.includes('android:allowBackup="false"'), "AndroidManifest must set allowBackup=false");
    assert(xml.includes('android:usesCleartextTraffic="false"'), "AndroidManifest must set usesCleartextTraffic=false");
    const perms = [...xml.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(perms, ["android.permission.INTERNET"], "Unexpected Android permissions: " + perms.join(", "));
  });

  await browser.close();
  console.log(`\nSecurity Tests: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach(f => console.error("FAILURE:", f.name, f.err));
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
