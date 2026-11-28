const path = require("path");
const { pathToFileURL } = require("url");
const assert = require("assert");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const APP_URL = pathToFileURL(path.resolve(__dirname, "index.html")).href;

const VIEWPORTS = [
  { label: "mobile 390x844", viewport: { width: 390, height: 844 }, hasTouch: true },
  { label: "desktop 1280x800", viewport: { width: 1280, height: 800 }, hasTouch: false }
];

async function run() {
  const browser = await chromium.launch();
  let passed = 0;
  const failures = [];

  async function runSuite(vpCfg) {
    console.log(`\n=== Running UI suite on ${vpCfg.label} ===`);

    async function test(name, fn) {
      const context = await browser.newContext({ viewport: vpCfg.viewport, hasTouch: vpCfg.hasTouch });
      const page = await context.newPage();
      const errors = [];
      page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", e => errors.push(e.message));
      try {
        await fn(page, errors);
        if (errors.length) throw new Error("Console/page errors: " + errors.join(" | "));
        passed++;
        console.log("  PASS:", name);
      } catch (err) {
        failures.push({ name: `[${vpCfg.label}] ${name}`, err });
        console.log("  FAIL:", name, "->", err.message);
      } finally {
        await context.close();
      }
    }

    await test("Create all 7 categories (every day) appear on Home immediately and after reload", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-09");
      const cats = [
        { cat: "Water", name: "Water" },
        { cat: "Gym", name: "Gym" },
        { cat: "Study", name: "Study" },
        { cat: "Code", name: "Code" },
        { cat: "Break from screen", name: "Break from screen" },
        { cat: "No social media", name: "No social media" },
        { cat: "Custom", name: "Journal" }
      ];
      for (const c of cats) {
        await page.click('.nav [data-go="newHabit"]');
        await page.click(`input[name="category"][value="${c.cat}"]`, { force: true });
        if (c.cat === "Custom") await page.fill("#habitName", c.name);
        await page.click("#everyDay");
        await page.click("#saveHabit");
      }
      const listText = await page.textContent("#habitList");
      for (const c of cats) {
        assert(listText.includes(c.name), `Expected ${c.name} on Home immediately`);
      }
      assert.strictEqual(await page.locator("#habitList .habit").count(), 7);

      await page.reload();
      const reloadedText = await page.textContent("#habitList");
      for (const c of cats) {
        assert(reloadedText.includes(c.name), `Expected ${c.name} on Home after reload`);
      }
      assert.strictEqual(await page.locator("#habitList .habit").count(), 7);
    });

    await test("Off-day habit save banner and Home empty state message", async (page) => {
      // 2026-11-09 is Monday (0). Schedule for Tue/Wed/Thu (1,2,3).
      await page.goto(APP_URL + "?date=2026-11-09");
      await page.click('[data-go="newHabit"]');
      await page.click('input[name="category"][value="Code"]', { force: true });
      await page.fill("#habitName", "Algorithms");
      await page.click("#clearDays");
      await page.click('.days input[data-day="1"]', { force: true });
      await page.click('.days input[data-day="2"]', { force: true });
      await page.click('.days input[data-day="3"]', { force: true });
      await page.click("#saveHabit");

      assert.strictEqual(await page.getAttribute("#banner", "hidden"), null);
      const bannerText = await page.textContent("#banner");
      assert.match(bannerText, /Saved\.\s*Scheduled for Tue, Wed, Thu\.\s*Not due today\./);

      const empty1 = await page.textContent("#habitList");
      assert.match(empty1, /No habits due today\.\s*1 habit is scheduled on other days\./);

      await page.click('.nav [data-go="newHabit"]');
      await page.click('input[name="category"][value="Custom"]', { force: true });
      await page.fill("#habitName", "Reading");
      await page.click("#clearDays");
      await page.click('.days input[data-day="5"]', { force: true });
      await page.click("#saveHabit");

      const empty2 = await page.textContent("#habitList");
      assert.match(empty2, /No habits due today\.\s*2 habits are scheduled on other days\./);
      assert.strictEqual(await page.locator("#habitList .habit").count(), 0);
    });

    await test("Form validation: no days error, quick-select buttons, Water interval < 15 min error", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-09");
      await page.click('[data-go="newHabit"]');

      // Clear days -> Save -> "Select at least one day."
      await page.click("#clearDays");
      let checkedDays = await page.locator(".days input:checked").count();
      assert.strictEqual(checkedDays, 0);
      await page.click("#saveHabit");
      assert.strictEqual(await page.getAttribute("#formError", "hidden"), null);
      assert.strictEqual(await page.textContent("#formErrorText"), "Select at least one day.");

      // Weekdays button -> 5 days (Mon-Fri)
      await page.click("#weekdays");
      checkedDays = await page.locator(".days input:checked").count();
      assert.strictEqual(checkedDays, 5);
      assert.strictEqual(await page.isChecked('.days input[data-day="4"]'), true);
      assert.strictEqual(await page.isChecked('.days input[data-day="5"]'), false);

      // Every day button -> 7 days
      await page.click("#everyDay");
      checkedDays = await page.locator(".days input:checked").count();
      assert.strictEqual(checkedDays, 7);

      // Water interval under 15 min shows error
      await page.click('input[name="category"][value="Water"]', { force: true });
      await page.selectOption("#intervalUnit", "minutes");
      await page.fill("#intervalNum", "10");
      await page.click("#saveHabit");
      assert.strictEqual(await page.getAttribute("#formError", "hidden"), null);
      assert.match(await page.textContent("#formErrorText"), /15 minutes/);

      // Valid interval saves cleanly
      await page.fill("#intervalNum", "20");
      await page.click("#saveHabit");
      assert.strictEqual(await page.locator("#habitList .habit").count(), 1);
    });

    await test("Gym picker: choose, add custom, edit list, repeat last workout", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-09");
      await page.click('[data-go="newHabit"]');
      await page.click('input[name="category"][value="Gym"]', { force: true });
      await page.click("#everyDay");
      await page.click("#saveHabit");

      assert.strictEqual(await page.locator("#habitList .hr input.check").count(), 0);
      await page.click('#habitList [data-act="choose"]');
      await page.click('#items input[value="Bench Press"]', { force: true });
      page.once("dialog", d => d.accept("Cable Fly"));
      await page.click("#addCustom");
      await page.click("#confirm");

      assert.match(await page.textContent("#habitList"), /Bench Press/);
      assert.match(await page.textContent("#habitList"), /Cable Fly/);

      // Edit today's exercises
      await page.click('#habitList [data-act="choose"]');
      await page.click('#groups [data-g="Legs"]');
      await page.click('#items input[value="Squat"]', { force: true });
      await page.click("#confirm");
      assert.match(await page.textContent("#habitList"), /Squat/);

      // Next day: Repeat last workout
      await page.goto(APP_URL + "?date=2026-11-10");
      await page.click('#habitList [data-act="repeat"]');
      const listText = await page.textContent("#habitList");
      assert.match(listText, /Bench Press/);
      assert.match(listText, /Cable Fly/);
      assert.match(listText, /Squat/);
      assert.strictEqual(await page.locator("#habitList .routine input.check:checked").count(), 0);
    });

    await test("Study picker: choose 3 topics, add custom, edit, repeat, tick one then all -> no undefined, bill opens once", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-09");
      await page.click('[data-go="newHabit"]');
      await page.click('input[name="category"][value="Study"]', { force: true });
      await page.click("#everyDay");
      await page.click("#saveHabit");

      assert.strictEqual(await page.locator("#habitList .hr input.check").count(), 0);
      await page.click('#habitList [data-act="choose"]');
      assert.match(await page.textContent("#confirm"), /Confirm topics/i);

      await page.click('#items input[value="Mathematics"]', { force: true });
      await page.click('#items input[value="Physics"]', { force: true });
      page.once("dialog", d => d.accept("Organic Chemistry"));
      await page.click("#addCustom");
      await page.click("#confirm");

      // Tick one topic
      await page.click('#habitList input[data-ex="Mathematics"]', { force: true });
      let store = await page.evaluate(() => JSON.parse(localStorage.getItem("habitStore.v1")));
      const id = store.habits[0].id;
      assert.strictEqual("undefined" in store.log["2026-11-09"][id], false);
      assert.strictEqual(await page.locator("#bill.open").count(), 0);

      // Tick remaining topics
      await page.click('#habitList input[data-ex="Physics"]', { force: true });
      await page.click('#habitList input[data-ex="Organic Chemistry"]', { force: true });
      await page.waitForTimeout(750);
      assert.strictEqual(await page.locator("#bill.open").count(), 1);
      assert.match(await page.textContent("#paperWin"), /Mathematics, Physics, Organic Chemistry/);
      await page.click("#billClose");

      // Edit topics on same day preserves ticks for kept topics
      await page.click('#habitList [data-act="choose"]');
      await page.click('#items input[value="Chemistry"]', { force: true });
      await page.click("#confirm");
      assert.strictEqual(await page.isChecked('#habitList input[data-ex="Mathematics"]'), true);
      assert.strictEqual(await page.isChecked('#habitList input[data-ex="Chemistry"]'), false);

      // Next day: repeat last topics
      await page.goto(APP_URL + "?date=2026-11-10");
      await page.click('#habitList [data-act="repeat"]');
      assert.match(await page.textContent("#habitList"), /Topic checklist/);
      assert.strictEqual(await page.locator("#habitList .routine input.check:checked").count(), 0);
    });

    await test("Ticking, unticking, completing all opens bill once; rapid double-tap safety", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-09");
      await page.click('[data-go="newHabit"]');
      await page.click('input[name="category"][value="Code"]', { force: true });
      await page.click("#everyDay");
      // Rapid double click on Save must not create duplicate habits
      await page.dblclick("#saveHabit");
      assert.strictEqual(await page.locator("#habitList .habit").count(), 1);

      // Add second habit
      await page.click('.nav [data-go="newHabit"]');
      await page.click('input[name="category"][value="Custom"]', { force: true });
      await page.fill("#habitName", "Walk");
      await page.click("#everyDay");
      await page.click("#saveHabit");

      await page.evaluate(() => {
        window.__billOpenCount = 0;
        const orig = openBill;
        openBill = function () { window.__billOpenCount++; return orig.apply(this, arguments); };
      });

      const boxes = page.locator("#habitList input.check");
      await boxes.nth(0).click({ force: true });
      assert.strictEqual(await page.textContent("#pctText"), "50%");
      // Untick
      await boxes.nth(0).click({ force: true });
      assert.strictEqual(await page.textContent("#pctText"), "0%");

      // Tick both, rapidly toggle last one
      await boxes.nth(0).click({ force: true });
      await boxes.nth(1).click({ force: true });
      await boxes.nth(1).click({ force: true }); // untick
      await boxes.nth(1).click({ force: true }); // tick again
      await page.waitForTimeout(800);

      assert.strictEqual(await page.evaluate(() => window.__billOpenCount), 1, "Bill must open exactly once");
      assert.strictEqual(await page.locator("#bill.open").count(), 1);
      await page.click("#billClose");
    });

    await test("Stats tab shows correct numbers for seeded data", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-15");
      await page.evaluate(() => {
        localStorage.setItem("habitStore.v1", JSON.stringify({
          habits: [
            { id: "h1", name: "Code", category: "Code", days: [0,1,2,3,4,5,6], createdAt: "2026-11-09" },
            { id: "h2", name: "Water", category: "Water", days: [0,1,2,3,4,5,6], createdAt: "2026-11-09" }
          ],
          log: {
            "2026-11-09": { h1: true, h2: true },
            "2026-11-10": { h1: true, h2: true },
            "2026-11-11": { h1: true },
            "2026-11-12": { h1: true },
            "2026-11-14": { h1: true, h2: true },
            "2026-11-15": { h1: true }
          }
        }));
      });
      await page.reload();
      await page.click('.nav [data-go="stats"]');
      const txt = await page.textContent("#statsBody");
      assert.match(txt, /Best streak2/);
      assert.match(txt, /Today50%/);
      assert.match(txt, /Last 7 days/);
      assert.doesNotMatch(txt, /Current streak/);
      // Code: current 2, 30-day 86% (6/7)
      // Water: current 1, 30-day 43% (3/7)
      const rows = await page.locator("#statsBody .stats-row").allTextContents();
      assert.strictEqual(rows.length, 2);
      assert.match(rows[0], /Code.*2.*86%/);
      assert.match(rows[1], /Water.*1.*43%/);
      // Verify flame icon in compact rows and single-line height
      assert.strictEqual(await page.locator('#statsBody .stats-row use[href="#flame"]').count(), 2);
      const rowHeight = await page.locator("#statsBody .stats-row").first().evaluate(el => el.getBoundingClientRect().height);
      assert(rowHeight < 56, `Expected compact single-line row (< 56px), got ${rowHeight}px`);
      // Bar chart bars must actually render visible heights (> 20px for 100% days)
      const barH = await page.locator('#statsBody [title="100%"]').first().evaluate(el => el.getBoundingClientRect().height);
      assert(barH > 40, `Expected 100% bar height > 40px, got ${barH}px`);
    });

    await test("Reset stats clears history, keeps habits, supports undo and cancel, and works after reload", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-15");
      // When no history, Reset stats button must be hidden
      await page.click('.nav [data-go="newHabit"]');
      await page.click('input[name="category"][value="Code"]', { force: true });
      await page.click("#everyDay");
      await page.click("#saveHabit");
      await page.click('.nav [data-go="stats"]');
      assert.notStrictEqual(await page.getAttribute("#resetStats", "hidden"), null, "Reset stats must be hidden when no history");

      // Seed history
      await page.evaluate(() => {
        data.log = {
          "2026-11-14": { [data.habits[0].id]: true },
          "2026-11-15": { [data.habits[0].id]: true }
        };
        saveData();
        renderStats();
      });
      assert.strictEqual(await page.getAttribute("#resetStats", "hidden"), null, "Reset stats must be visible when history exists");

      // Cancel changes nothing
      let dialogMsg = "";
      page.once("dialog", d => { dialogMsg = d.message(); d.dismiss(); });
      await page.click("#resetStats");
      assert.match(dialogMsg, /streaks/i);
      assert.strictEqual(await page.evaluate(() => Object.keys(data.log).length), 2);

      // Confirm reset: clears history, keeps habits, shows banner with Undo
      page.once("dialog", d => d.accept());
      await page.click("#resetStats");
      assert.strictEqual(await page.evaluate(() => Object.keys(data.log).length), 0);
      assert.strictEqual(await page.evaluate(() => data.habits.length), 1);
      assert.notStrictEqual(await page.getAttribute("#resetStats", "hidden"), null);
      assert.match(await page.textContent("#banner"), /Stats reset/);
      assert.strictEqual(await page.textContent("#bannerAction"), "Undo");
      assert.strictEqual(await page.textContent("#fracText"), "0/1");

      // Undo via banner brings history back
      await page.click("#bannerAction");
      assert.strictEqual(await page.evaluate(() => Object.keys(data.log).length), 2);
      assert.strictEqual(await page.getAttribute("#resetStats", "hidden"), null);
      assert.strictEqual(await page.textContent("#fracText"), "1/1");

      // Reset again, reload page, then undo via Settings -> Backup -> Undo last restore
      page.once("dialog", d => d.accept());
      await page.click("#resetStats");
      await page.reload();
      assert.strictEqual(await page.evaluate(() => Object.keys(data.log).length), 0);
      assert.strictEqual(await page.evaluate(() => data.habits.length), 1);
      await page.click('#home [data-go="settings"]');
      await page.click("#backupDetails summary");
      assert.strictEqual(await page.getAttribute("#undoRestore", "hidden"), null);
      await page.click("#undoRestore");
      await page.click("#settingsClose");
      assert.strictEqual(await page.evaluate(() => Object.keys(data.log).length), 2);
    });

    await test("Logo favicon, apple-touch-icon, and Home header logo render cleanly", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-09");
      const iconHref = await page.getAttribute('link[rel="icon"]', "href");
      assert(iconHref && iconHref.startsWith("data:image/svg+xml,"), "Favicon must be inline SVG data URI");
      const appleHref = await page.getAttribute('link[rel="apple-touch-icon"]', "href");
      assert.strictEqual(appleHref, "assets/icon-192.png");
      const headerLogoLoaded = await page.locator("#home header.top img").evaluate(el => el.complete && el.naturalWidth > 0);
      assert.strictEqual(headerLogoLoaded, true, "Home header logo must load");
    });

    await test("Settings: sound, vibration, export, import, restore, undo restore", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-09");
      await page.click('[data-go="newHabit"]');
      await page.click('input[name="category"][value="Code"]', { force: true });
      await page.click("#everyDay");
      await page.click("#saveHabit");

      await page.click('#home [data-go="settings"]');
      assert.strictEqual(await page.getAttribute("#settingsPanel", "hidden"), null);

      await page.click("#settingSound", { force: true });
      assert.strictEqual(await page.textContent("#settingSoundText"), "OFF");
      await page.click("#settingVibration", { force: true });
      assert.strictEqual(await page.textContent("#settingVibrationText"), "OFF");

      await page.click("#backupDetails summary");
      await page.click("#exportBackup");
      await page.waitForTimeout(100);
      assert.match(await page.textContent("#exportNote"), /Exported punchout-backup-2026-11-09\.json/);

      const importedPayload = JSON.stringify({
        app: "punchout",
        version: 1,
        exportedAt: "2026-11-09T00:00:00.000Z",
        data: {
          habits: [{ id: "imp1", name: "Restored Habit", category: "Custom", days: [0,1,2,3,4,5,6], createdAt: "2026-11-09" }],
          log: {},
          customExercises: {}
        },
        settings: { sound: false, vibration: false }
      });
      await page.fill("#importText", importedPayload);
      page.once("dialog", d => d.accept());
      await page.click("#importBackup");
      assert.match(await page.textContent("#importNote"), /Restore complete/);
      assert.match(await page.textContent("#habitList"), /Restored Habit/);

      // Undo restore
      assert.strictEqual(await page.getAttribute("#undoRestore", "hidden"), null);
      await page.click("#undoRestore");
      assert.match(await page.textContent("#importNote"), /Undone last restore/);
      assert.match(await page.textContent("#habitList"), /Code/);
      await page.click("#settingsClose");
    });

    await test("Edit and delete habit", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-09");
      await page.click('[data-go="newHabit"]');
      await page.click('input[name="category"][value="Code"]', { force: true });
      await page.click("#everyDay");
      await page.click("#saveHabit");

      // Edit
      await page.click("#habitList [data-edit]");
      assert.strictEqual(await page.textContent("#habitTitle"), "Edit habit");
      assert.strictEqual(await page.getAttribute("#reminderSimple", "hidden"), null);
      assert.notStrictEqual(await page.getAttribute("#reminderInterval", "hidden"), null);
      await page.fill("#habitName", "TypeScript");
      await page.click("#saveHabit");
      assert.match(await page.textContent("#habitList"), /TypeScript/);

      // Delete
      page.once("dialog", d => d.accept());
      await page.click('#habitList button.del[data-id]');
      assert.strictEqual(await page.locator("#habitList .habit").count(), 0);
      assert.match(await page.textContent("#habitList"), /Tap \+ to add your first habit/);
    });

    await test("Old localStorage without category loads and corrupted JSON does not crash", async (page) => {
      await page.goto(APP_URL + "?date=2026-11-09");
      await page.evaluate(() => {
        localStorage.setItem("habitStore.v1", JSON.stringify({
          habits: [
            { id: "old1", name: "Hydrate", icon: "drop", type: "normal", days: [0,1,2,3,4,5,6], createdAt: "2026-11-09" },
            { id: "old2", name: "Weights", type: "gym", days: [0,1,2,3,4,5,6], createdAt: "2026-11-09" },
            { id: "old3", name: "Prep", type: "items", days: [0,1,2,3,4,5,6], createdAt: "2026-11-09" }
          ],
          log: { "2026-11-09": { old1: true } }
        }));
      });
      await page.reload();
      const cats = await page.evaluate(() => data.habits.map(h => h.category));
      assert.deepStrictEqual(cats, ["Water", "Gym", "Study"]);
      assert.strictEqual(await page.locator("#habitList .habit").count(), 3);

      // Corrupted JSON in localStorage
      await page.evaluate(() => {
        localStorage.setItem("habitStore.v1", "{bad-json!!!");
      });
      await page.reload();
      assert.strictEqual(await page.locator("#habitList .habit").count(), 0);
      assert.match(await page.textContent("#habitList"), /Tap \+ to add your first habit/);
    });

    await test("Reminder logic with page.clock: one reminder, no burst, none when done", async (page) => {
      await page.clock.install({ time: new Date(2026, 10, 9, 8, 59, 0) });
      await page.goto(APP_URL);
      await page.evaluate(() => {
        data.habits.push({
          id: "w1", name: "Water", icon: "drop", category: "Water", type: "normal",
          days: [0,1,2,3,4,5,6], reminder: "07:15",
          intervalNum: 1, intervalUnit: "hours", windowFrom: "09:00", windowTo: "21:00",
          createdAt: "2026-11-09"
        });
        saveData();
        renderHome();
        window.__bannerShows = [];
        const orig = showBanner;
        showBanner = function (msg, ms) { window.__bannerShows.push(msg); return orig.apply(this, arguments); };
      });

      // Jump past 09:00 and 10:00 (to 10:00:30): 09:00 should be skipped silently (no burst), 10:00 fires once
      await page.clock.fastForward("01:01:30");
      await page.clock.runFor(30000); // fires interval once at ~10:01
      let shows = await page.evaluate(() => window.__bannerShows.slice());
      assert.strictEqual(shows.length, 1, "Expected exactly 1 reminder (no burst), got: " + JSON.stringify(shows));
      assert.strictEqual(shows[0], "Water reminder");

      // Another 30s tick for the same 10:00 slot must NOT fire again
      await page.clock.runFor(30000);
      shows = await page.evaluate(() => window.__bannerShows.slice());
      assert.strictEqual(shows.length, 1, "Same slot must not fire twice");

      // Mark Water done, then jump to 11:00:30 -> must NOT fire when done
      await page.click('#habitList input[data-h="w1"]', { force: true });
      await page.clock.fastForward("00:59:00");
      await page.clock.runFor(30000);
      shows = await page.evaluate(() => window.__bannerShows.slice());
      assert.strictEqual(shows.length, 1, "Reminder must not fire when habit is already done");
    });

    await test("Bill sound & print animation sync (page.clock) and stop on close", async (page) => {
      await page.clock.install({ time: new Date(2026, 10, 9, 10, 0, 0) });
      await page.goto(APP_URL);
      const t0 = await page.evaluate(() => {
        data.habits.push({ id: "h1", name: "Code", icon: "code", category: "Code", type: "normal", days: [0,1,2,3,4,5,6], reminder: "07:15", createdAt: "2026-11-09" });
        data.log["2026-11-09"] = { h1: true };
        saveData();
        renderHome();
        window.__billSteps = [];
        window.__billDings = [];
        window.__billTears = [];
        const origStep = playBillStep;
        const origDing = playBillDing;
        const origTear = playBillTear;
        playBillStep = function () { window.__billSteps.push(performance.now()); return origStep.apply(this, arguments); };
        playBillDing = function () { window.__billDings.push(performance.now()); return origDing.apply(this, arguments); };
        playBillTear = function () { window.__billTears.push(performance.now()); return origTear.apply(this, arguments); };
        const start = performance.now();
        openBill();
        return start;
      });

      // Advance through the 1920 ms print duration
      await page.clock.runFor(2000);
      const res = await page.evaluate(() => ({
        steps: window.__billSteps.length,
        dings: window.__billDings.slice(),
        tears: window.__billTears.slice(),
        printMs: getPrintMs()
      }));
      assert.strictEqual(res.printMs, 1920);
      assert.strictEqual(res.steps, 40, `Expected 40 sound steps, got ${res.steps}`);
      assert.strictEqual(res.dings.length, 1, "Expected 1 ding");
      assert.strictEqual(res.tears.length, 1, "Expected 1 tear");
      const dingElapsed = res.dings[0] - t0;
      assert(Math.abs(dingElapsed - res.printMs) <= 100,
        `Ding happened at ${dingElapsed}ms, expected within 100ms of ${res.printMs}ms`);

      // Closing the bill mid-print must stop all remaining sound steps and the ding
      await page.click("#billClose");
      await page.evaluate(() => {
        window.__billSteps = [];
        window.__billDings = [];
        window.__billTears = [];
        openBill();
      });
      await page.clock.runFor(500);
      await page.click("#billClose");
      const stepsAtClose = await page.evaluate(() => window.__billSteps.length);
      assert(stepsAtClose > 0 && stepsAtClose < 40, `Expected partial steps mid-print, got ${stepsAtClose}`);
      await page.clock.runFor(2500);
      const afterClose = await page.evaluate(() => ({
        steps: window.__billSteps.length,
        dings: window.__billDings.length,
        tears: window.__billTears.length
      }));
      assert.strictEqual(afterClose.steps, stepsAtClose, "Remaining sound steps must stop on closeBill");
      assert.strictEqual(afterClose.dings, 0, "Ding must not fire after closeBill");
      assert.strictEqual(afterClose.tears, 0, "Tear must not fire after closeBill");
    });
  }

  for (const vp of VIEWPORTS) {
    await runSuite(vp);
  }

  // Accessibility (axe-core across every screen) & prefers-reduced-motion check
  console.log("\n=== Running Accessibility (axe-core) & Reduced-Motion checks ===");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", e => errors.push(e.message));
    try {
      const checkAxe = async (label) => {
        const res = await new AxeBuilder({ page }).analyze();
        assert.strictEqual(res.violations.length, 0,
          `${label} had ${res.violations.length} axe violation(s): ${res.violations.map(v => v.id).join(", ")}`);
      };
      await page.goto(APP_URL + "?date=2026-11-09");
      await checkAxe("Home (empty)");
      await page.click('[data-go="newHabit"]');
      await checkAxe("New Habit (Water interval)");
      await page.click('input[name="category"][value="Code"]', { force: true });
      await page.click("#everyDay");
      await checkAxe("New Habit (Code)");
      await page.click("#saveHabit");

      await page.click('.nav [data-go="newHabit"]');
      await page.click('input[name="category"][value="Gym"]', { force: true });
      await page.click("#everyDay");
      await page.click("#saveHabit");

      await page.click('.nav [data-go="newHabit"]');
      await page.click('input[name="category"][value="Study"]', { force: true });
      await page.click("#everyDay");
      await page.click("#saveHabit");
      await checkAxe("Home (with habits)");

      await page.click('#habitList [data-act="choose"]');
      await page.click('#items input[value="Bench Press"]', { force: true });
      await checkAxe("Gym Picker");
      await page.click("#confirm");

      await page.locator('#habitList [data-act="choose"]').nth(1).click();
      await page.click('#items input[value="Mathematics"]', { force: true });
      await checkAxe("Study Picker");
      await page.click("#confirm");

      await page.click('.nav [data-go="stats"]');
      await checkAxe("Stats");

      await page.click('.nav [data-go="home"]');
      await page.click('#home [data-go="settings"]');
      await checkAxe("Settings");
      await page.click("#settingsClose");

      await page.click('#habitList input[type="checkbox"]', { force: true });
      await page.click('#habitList input[data-ex="Bench Press"]', { force: true });
      await page.click('#habitList input[data-ex="Mathematics"]', { force: true });
      await page.waitForTimeout(750);
      await checkAxe("Bill");

      assert.strictEqual(errors.length, 0, "Console/page errors during axe pass: " + errors.join(" | "));
      passed++;
      console.log("  PASS: Zero axe-core violations across all 9 screens");
    } catch (err) {
      failures.push({ name: "Accessibility (axe-core)", err });
      console.log("  FAIL: Accessibility (axe-core) ->", err.message);
    } finally {
      await ctx.close();
    }

    const rmCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const rmPage = await rmCtx.newPage();
    try {
      await rmPage.goto(APP_URL + "?date=2026-11-09");
      await rmPage.evaluate(() => {
        window.__rmSteps = 0;
        window.__rmDings = 0;
        const origStep = playBillStep;
        const origDing = playBillDing;
        playBillStep = function () { window.__rmSteps++; return origStep.apply(this, arguments); };
        playBillDing = function () { window.__rmDings++; return origDing.apply(this, arguments); };
        data.habits.push({ id: "h1", name: "Code", icon: "code", category: "Code", type: "normal", days: [0,1,2,3,4,5,6], reminder: "07:15", createdAt: "2026-11-09" });
        data.log["2026-11-09"] = { h1: true };
        saveData();
        renderHome();
        openBill();
      });
      const rm = await rmPage.evaluate(() => ({
        paperDur: getComputedStyle(document.querySelector(".paper")).animationDuration,
        btnDur: getComputedStyle(document.querySelector("#bill .btn")).animationDuration,
        btnDelay: getComputedStyle(document.querySelector("#bill .btn")).animationDelay,
        steps: window.__rmSteps,
        dings: window.__rmDings
      }));
      assert.strictEqual(rm.paperDur, "0.01s");
      assert.strictEqual(rm.btnDur, "0.01s");
      assert.strictEqual(rm.btnDelay, "0s");
      assert.strictEqual(rm.steps, 0, "Reduced motion must not play 40-step printing noise");
      assert.strictEqual(rm.dings, 1, "Reduced motion must play only the final ding");
      passed++;
      console.log("  PASS: prefers-reduced-motion shortens bill & button animations");
    } catch (err) {
      failures.push({ name: "prefers-reduced-motion", err });
      console.log("  FAIL: prefers-reduced-motion ->", err.message);
    } finally {
      await rmCtx.close();
    }
  }

  await browser.close();
  console.log(`\nUI Tests: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach(f => console.error("FAILURE:", f.name, f.err));
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
