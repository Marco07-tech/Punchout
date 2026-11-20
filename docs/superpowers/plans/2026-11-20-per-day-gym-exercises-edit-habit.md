# Per-Day Gym Exercises + Edit Habit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gym exercises are chosen per day in the log (not stored on the habit), and every habit card gains an Edit button that reuses the New Habit form.

**Architecture:** Single-file app (`index.html`: markup + CSS + JS). The log already stores `log["YYYY-MM-DD"][gymHabitId] = { name: bool }`, so no migration: the reading side (`isHabitDone`, habit card, bill) switches from `habit.exercises` to the day's entry keys. The existing picker screen is retargeted to one habit + one day. Edit habit reuses the form with an `editingId`.

**Tech Stack:** Vanilla HTML/CSS/JS, localStorage, no libraries. Tests: `node test-streaks.js` (pulls the script out of index.html and runs it against a fake DOM).

**Spec:** In-conversation spec approved 2026-11-20 (recap below).

## Spec recap (decisions locked)

- Gym habit stores only: `id, name, icon, type, days, reminder, createdAt`. The old `exercises` field is ignored everywhere (no crash if present, never read).
- Day entry: `log[date][gymHabitId] = { "Bench Press": false, "Squat": true }`. Keys = that day's chosen exercises; values = ticked or not.
- Gym done for a day ⇔ entry exists, has ≥1 key, and every value === true. Before choosing: pending (not done). Streaks, rest days, ring, bill, day streak all follow from `isHabitDone`.
- New Habit: "Choose exercises" button removed; gym-with-no-exercise validation removed.
- Picker: opened from Home only. Confirm writes picked names into the target day's entry and returns Home. "Back" on the picker goes Home (discards selection). Selected counts start from the day's list (empty if none).
- Unticking an exercise writes `false` (key stays), so the row remains in the checklist.
- Home gym card:
  - No list for today → button "Choose today’s exercises".
  - List exists → checklist + small "Edit today’s exercises" button (picker reopened with today's names preselected; confirm keeps ticks for staying names, drops unselected, adds new as unticked).
  - "Repeat last workout" (both states, per approved answer): copies names from the most recent earlier log day that has a list for that habit, all unticked. Hidden when there is none.
- Edit habit: pencil button (`.del` style, `#pencil` symbol, `aria-label="Edit <name>"`) next to Delete. Fills the form; heading "Edit habit"; button "Save changes"; type radios disabled; saves update the same id (no new habit, history kept); same validation as create (name + ≥1 day); Back/`+` reset to an empty form.

## Global Constraints

- Keep everything in `index.html`; only `test-streaks.js` also changes (plus this plan file).
- Escape all user text with `esc()` before it goes into HTML.
- No new libraries; keep the existing design, colours, and any behaviour not named above.
- Small, clearly named functions.
- Tests must pass: `node test-streaks.js`.

## Review Focus

- Old data: a stored habit with an `exercises` array and log entries holding only ticked keys must still load and count as done → pinned by "old log entry still counts" test (Task 1).
- Unticking must not remove a row from today's checklist → pinned by `setDone` writing `false` (Task 1) + manual check.
- Picker confirm must not create a duplicate habit or lose ticks on "Edit today’s exercises" → manual check (Task 2) + `writeDayExercises` merge semantics.
- "+" after editing must show an empty form, and editing must never change `id`/`createdAt` → manual check (Task 4).
- Source-scan tests in test-streaks.js grep the script (`renderHome` must not contain `openBill`; the tick handler must keep `setTimeout(openBill, 600)` and `focusCheckbox(habitId, exercise)`) → keep those shapes intact (Task 1).

---

### Task 1: Per-day exercise rule (core)

**Files:**
- Modify: `index.html` (script sections 1, 3, 8, 9)
- Test: `test-streaks.js`

**Interfaces:**
- Produces: `dayEntry(key, habitId) -> object|null`, `dayExercises(key, habitId) -> string[]`, `writeDayExercises(key, habitId, names, prevEntry) -> void`, `isHabitDone(h, key) -> boolean` (gym = day's list all ticked), `setDone(h, key, done, exercise)` (gym keeps key with `false`).

- [ ] **Step 1: Rewrite/extend the tests in `test-streaks.js` (failing first)**

Add to the `loadApp` export string: `, dayExercises, lastWorkoutNames, repeatLastWorkout`
(`lastWorkoutNames`/`repeatLastWorkout` arrive in Task 3; their tests are added there).

Habit helper: drop the default `exercises: []`; `gym()` helper: drop `exercises:["Bench"]`; line ~106 gym habit: drop `exercises:["Bench"]`.

New block (replaces the "one exercise out of two" block at line ~171):

```js
console.log("\nNew rule - a gym day is done only from that day's own exercise list");
{
  // (a) nothing chosen for the day yet -> pending, not done
  const store = { habits: [habit({ id:"g", type:"gym" })], log: {} };
  const app = loadApp(store, day(9));
  check("gym not done before exercises are chosen", app.isHabitDone(app.data.habits[0], day(9)), false);
}
{
  // (b) one ticked, one unticked -> not done; all ticked -> done
  const store = { habits: [habit({ id:"g", type:"gym" })],
    log: { [day(9)]: { g: { "Bench Press": true, "Squat": false } } } };
  const app = loadApp(store, day(9));
  check("not done while one exercise is unticked", app.isHabitDone(app.data.habits[0], day(9)), false);
  store.log[day(9)].g.Squat = true;
  const app2 = loadApp(store, day(9));
  check("done after ticking all", app2.isHabitDone(app2.data.habits[0], day(9)), true);
}
{
  // (c) OLD data: habit still carries an exercises field, log entry has only ticked keys
  const store = { habits: [habit({ id:"g", type:"gym", exercises:["Bench"] })],
    log: { [day(9)]: { g: { Bench: true } } } };
  const app = loadApp(store, day(9));
  check("old log entry still counts", app.isHabitDone(app.data.habits[0], day(9)), true);
  check("old habit.exercises field is ignored", app.data.habits[0].exercises, undefined);
}
```

- [ ] **Step 2: Run `node test-streaks.js` — expect FAIL** (`isHabitDone` still reads `h.exercises`).

- [ ] **Step 3: Implement in `index.html`**

  - `fixHabit`: delete the `exercises:` line (drop the old field).
  - New helpers next to `isHabitDone` (section 3): `dayEntry(key, habitId)` (returns the object only when it is a plain object, else `null`), `dayExercises(key, habitId)` (`Object.keys` of it or `[]`), `writeDayExercises(key, habitId, names, prevEntry)` (builds `{name: !!(prev && prev[name] === true)}`; deletes the entry when `names` is empty; deletes the day when empty).
  - `isHabitDone`: gym branch → `const e = dayEntry(key, h.id)`; done iff `e` has ≥1 key and every value === true.
  - `setDone`: gym branch → `day[h.id][exercise] = done === true` (keep the key; do not delete on untick), keep empty-object cleanup.
  - `habitCard` gym rows: use `dayExercises(today, h.id)` instead of `h.exercises`.
  - Bill: same switch (`dayExercises(today, h.id)`).

- [ ] **Step 4: Run `node test-streaks.js` — expect PASS** (all old + new).

- [ ] **Step 5: Grep `index.html` for `h.exercises` / `f.exercises` — expect no readers left.**

### Task 2: Picker retargeted to a day

**Files:**
- Modify: `index.html` (markup lines ~206, ~226; script sections 5–7)

**Interfaces:**
- Produces: `openPicker(habitId, key) -> void`, `pickerTarget = {habitId, key}|null`.

- [ ] **Step 1:** Remove the `#gymRow` "Choose exercises" button (markup) and its two references (type-change listener in section 5, `resetForm`). Remove `#pickCount` from `renderSlip`.
- [ ] **Step 2:** Picker back button: `data-go="newHabit"` → `data-go="home"`.
- [ ] **Step 3:** Replace `$("#confirm")` handler with: `writeDayExercises(target.key, target.id, [...picked], dayEntry(target.key, target.id))`, `saveData()`, clear `pickerTarget`, `show("home")`.
- [ ] **Step 4:** Add `openPicker(habitId, key)` (sets target, `picked` = day's names, resets search/group, re-renders, `show("picker")`). Wire the Home card buttons (Task 3) to it.
- [ ] **Step 5:** Run `node test-streaks.js` (source-scan tests still green).

### Task 3: Home gym card buttons

**Files:**
- Modify: `index.html` (script section 8, small CSS addition)
- Test: `test-streaks.js`

**Interfaces:**
- Produces: `lastWorkoutNames(habitId, beforeKey) -> string[]|null`, `repeatLastWorkout(habitId, key) -> void`; card buttons carry `data-act="choose"` / `data-act="repeat"` and `data-id`.

- [ ] **Step 1: Failing tests in `test-streaks.js`**

```js
console.log("\nRepeat last workout - copies the most recent earlier list, all unticked");
{
  const store = { habits: [habit({ id:"g", type:"gym" })], log: {
    [day(9)]:  { g: { "Bench Press": true } },
    [day(10)]: { g: { "Squat": true, "Lunges": false } },
    [day(11)]: {}
  }};
  const app = loadApp(store, day(11));
  check("most recent earlier day with a list wins",
    app.lastWorkoutNames("g", day(11)), ["Squat", "Lunges"]);
  check("no earlier list -> hidden", app.lastWorkoutNames("none", day(11)), null);
  app.repeatLastWorkout("g", day(11));
  check("repeat writes today's list all unticked",
    app.data.log[day(11)].g, { "Squat": false, "Lunges": false });
  check("so the day is not done yet", app.isHabitDone(app.data.habits[0], day(11)), false);
}
```

- [ ] **Step 2: Run — expect FAIL** (functions undefined).
- [ ] **Step 3: Implement** — `lastWorkoutNames` (scan date keys `< beforeKey`, newest first, first non-empty plain-object entry for the habit → its keys; else `null`); `repeatLastWorkout` (`writeDayExercises(key, id, names, null)`, `saveData()`, `renderHome()`); `habitCard` gym branch renders: choose-button state when `dayExercises` is empty, else checklist (`x/y active` from the day's keys) + "Edit today’s exercises"; "Repeat last workout" appended when `lastWorkoutNames` is non-null; wrap buttons in a small `.acts` flex row (CSS: `.acts{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}` + `.acts .btn.sm{margin-top:0}`).
- [ ] **Step 4: Click delegation** in `#habitList` (order: `[data-go]` → `[data-edit]` → `[data-act]` → `.del`): `choose` → `openPicker(id, todayKey())`; `repeat` → `repeatLastWorkout(id, todayKey())`.
- [ ] **Step 5: Run `node test-streaks.js` — expect PASS.**

### Task 4: Edit habit

**Files:**
- Modify: `index.html` (symbol list, markup `#habitTitle`/`#saveLabel`, script sections 6 & 8, CSS for disabled chips)

**Interfaces:**
- Produces: `openEdit(h) -> void`, `editingId: string|null`.

- [ ] **Step 1:** Add `#pencil` symbol; give the form heading `id="habitTitle"` and the save button label `id="saveLabel"`.
- [ ] **Step 2:** `openEdit(h)`: `resetForm()` → set `editingId` → fill name/icon/type/days/reminder → disable both type radios → heading "Edit habit", label "Save changes" → `show("newHabit")`.
- [ ] **Step 3:** `resetForm()`: also re-enable type radios, restore heading/label, set `editingId = null`.
- [ ] **Step 4:** Save handler: validate name + days (drop the gym-exercise check); if `editingId` matches a habit → update `name/icon/days/reminder` in place (never `type`, `id`, `createdAt`), else push a new habit **without** an `exercises` field. Then `saveData(); resetForm(); show("home")`.
- [ ] **Step 5:** Generic `[data-go]` listener: when target is `newHabit`, `resetForm()` first (so "+" always shows an empty form). Card: pencil button `class="del" data-edit` before Delete, `aria-label="Edit <name>"`.
- [ ] **Step 6:** CSS: `.chip:has(input:disabled){opacity:.55;cursor:not-allowed}`.
- [ ] **Step 7: Run `node test-streaks.js` — expect PASS.** Manual browser checks (below).

### Task 5: Full verification

- [x] `node test-streaks.js` → `30 passed, 0 failed`.
- [x] Manual smoke in browser (`index.html`, use `?date=2026-11-10` to pin a day): create gym habit → Home shows "Choose today’s exercises" + "Repeat last workout" (if history) → choose → checklist appears → untick keeps the row → edit keeps ticks/adds unticked → bill lists that day's exercises → pencil edit changes name in place, `+` afterwards is empty. All green.

## Test-to-spec mapping

| Spec requirement | Test |
|---|---|
| not done before choosing | `gym not done before exercises are chosen` |
| done after ticking all | `done after ticking all` |
| Repeat last workout | `most recent earlier day with a list wins`, `no earlier list -> hidden`, `repeat writes today's list all unticked` |
| old log entry still counting | `old log entry still counts`, `old habit.exercises field is ignored` |
