/* ==========================================================
   TESTS for the habit app's streak rules
   Run it with:  node test-streaks.js
   It pulls the script straight out of index.html and runs it
   with a fake page, so it always tests the real code.
   The ?date=... part works exactly like the testing helper in
   the app: it says which day counts as "today".
   ========================================================== */
const fs = require("fs");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// A tiny fake page so the app's script can run inside node.
// sharedStorage persists across loadApp calls so settings round-trip can be tested.
const sharedStorage = {};
function loadApp(store, date){
  sharedStorage["habitStore.v1"] = JSON.stringify(store);
  const nodes = {};
  const node = id => nodes[id] || (nodes[id] = {
    value: "", textContent: "", innerHTML: "", hidden: false, checked: false,
    style: {}, dataset: {},
    classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } },
    setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, focus(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; }
  });
  const fakeDocument = {
    querySelector: node,
    querySelectorAll(){ return []; },
    addEventListener(){},
    body: { style: {} },
    hidden: false
  };
  const fakeStorage = {
    getItem: k => sharedStorage[k],
    setItem: (k, v) => { sharedStorage[k] = v; },
    removeItem: k => { delete sharedStorage[k]; }
  };
  const fakeLocation = { search: date ? "?date=" + date : "", origin: "https://punchout.example.com", pathname: "/" };
  const fakeWindow = { addEventListener(){} };

  const build = new Function("document", "localStorage", "location", "window",
    script + "\nreturn {data, computeHabitStreak, computeStreak, computeBestStreak," +
    " restDaysUsed, countCompleteDays, isDayKept, isHabitDone, dayWord, dayExercises," +
    " writeDayExercises, lastWorkoutNames, repeatLastWorkout," +
    " playClick, playTick, playConfirm, playDelete, playError, playBillStep," +
    " playBillDing, playBillTear, audioReady, loadSettings, saveSettings, settings," +
    " vibrate, updateSettingsLabels, settingsLabels, buildIcs};");
  return build(fakeDocument, fakeStorage, fakeLocation, fakeWindow);
}

// --- small helpers to write the tests -----------------------------
const day = n => `2026-11-${String(n).padStart(2, "0")}`;   // 9 = Monday ... 15 = Sunday
const habit = o => Object.assign({
  id: "h1", name: "Test", icon: "drop", type: "normal",
  days: [0,1,2,3,4,5,6], reminder: "07:15", createdAt: day(9)
}, o);

let pass = 0, fail = 0;
function check(name, actual, expected){
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if(a === e){ pass++; console.log("  ok   " + name + " = " + a); }
  else { fail++; console.log("  FAIL " + name + " = " + a + "  (expected " + e + ")"); }
}

// =================================================================
console.log("\nBug 1 - computeHabitStreak walks forwards from createdAt");
// The examples are for a GYM habit: all days scheduled, one exercise to tick.
const gym = () => habit({ id:"g", name:"Gym", type:"gym" });
const done = () => ({ g: { Bench: true } });           // a completed gym day in the log

{
  // all days scheduled; Mon/Tue done, Wed/Thu missed, Fri done, Sat missed
  const store = { habits: [gym()], log: { [day(9)]: done(), [day(10)]: done(), [day(13)]: done() } };
  const app = loadApp(store, day(15));                     // ?date=2026-11-15 (Sunday)
  check("Mon/Tue done, Wed/Thu missed, Fri done, Sat missed, Sun not yet -> 0",
    app.computeHabitStreak(app.data.habits[0], day(15)), 0);
}
{
  // The same week, but Sunday is done as well.
  const store = { habits: [gym()],
    log: { [day(9)]: done(), [day(10)]: done(), [day(13)]: done(), [day(15)]: done() } };
  const app = loadApp(store, day(15));
  check("same, but Sunday done -> 1", app.computeHabitStreak(app.data.habits[0], day(15)), 1);
}
{
  // Mon/Tue done, Wed/Thu missed, Fri done -> streak on Friday is 3.
  const store = { habits: [gym()], log: { [day(9)]: done(), [day(10)]: done(), [day(13)]: done() } };
  const app = loadApp(store, day(13));                     // ?date=2026-11-13 (Friday)
  check("Mon/Tue done, Wed/Thu missed, Fri done -> 3",
    app.computeHabitStreak(app.data.habits[0], day(13)), 3);
}
{
  // A normal habit: one missed scheduled day resets it to 0.
  const store = { habits: [habit({})], log: { [day(9)]: {h1:true}, [day(10)]: {h1:true} } };
  const app = loadApp(store, day(15));
  check("normal habit with a miss -> 0", app.computeHabitStreak(app.data.habits[0], day(15)), 0);
}

// =================================================================
console.log("\nBug 2 - restDaysUsed never returns more than 2");
{
  // A gym habit scheduled every day and missed six times this week.
  const store = { habits: [habit({ id:"g", type:"gym", days:[0,1,2,3,4,5,6] })], log: {} };
  const app = loadApp(store, day(15));
  check("six missed days in one week -> 2", app.restDaysUsed(day(15)), 2);
}

// =================================================================
console.log("\nBug 6 - the day streak keeps going when a gym habit rests twice");
{
  // A normal habit done every day, plus a gym habit missed on two days of the week.
  const store = {
    habits: [
      habit({ id:"w", name:"Water" }),
      habit({ id:"g", name:"Gym", type:"gym", days:[0,1,2] })   // Monday, Tuesday, Wednesday
    ],
    log: {
      [day(9)]:  { w:true },        // Monday: Water done, Gym missed (rest day 1)
      [day(10)]: { w:true },        // Tuesday: Water done, Gym missed (rest day 2)
      [day(11)]: { w:true, g:{ Bench:true } },   // Wednesday: both done
      [day(12)]: { w:true }, [day(13)]: { w:true }, [day(14)]: { w:true }
    }
  };
  const app = loadApp(store, day(15));                     // ?date=2026-11-15 (Sunday)
  const water = app.data.habits[0], gym = app.data.habits[1];
  check("the two gym rest days do not break the day streak", app.computeStreak(day(15)), 6);
  check("best streak stays unbroken too", app.computeBestStreak(day(15)), 6);
  check("the gym habit's own streak carries over the 2 rest days",
    app.computeHabitStreak(gym, day(15)), 1);
  check("the Water habit streak", app.computeHabitStreak(water, day(15)), 6);
}
{
  // Control: a THIRD gym miss in the same week does break the day streak.
  const store = {
    habits: [
      habit({ id:"w", name:"Water" }),
      habit({ id:"g", name:"Gym", type:"gym", days:[0,2,4] })  // Monday, Wednesday, Friday
    ],
    log: { [day(9)]: {w:true}, [day(10)]: {w:true}, [day(11)]: {w:true}, [day(12)]: {w:true}, [day(13)]: {w:true}, [day(14)]: {w:true} }
  };
  const app = loadApp(store, day(15));
  // Mon, Wed and Fri are all missed by the gym habit -> the third miss breaks Friday.
  check("a third gym miss in the week breaks the day streak", app.computeStreak(day(15)), 1);
  check("best streak is Monday..Thursday = 4", app.computeBestStreak(day(15)), 4);
}

// =================================================================
console.log("\nBug 5 - the bill writes 1 DAY, not 1 DAYS");
{
  const app = loadApp({ habits: [], log: {} }, day(15));
  check("dayWord(1)", app.dayWord(1), " DAY");
  check("dayWord(2)", app.dayWord(2), " DAYS");
  check("dayWord(15)", app.dayWord(15), " DAYS");
}

// =================================================================
console.log("\nBugs 3 and 4 - the bill and the focus live in the checkbox handler");
{
  const renderHome = script.match(/function renderHome\(\)\{[\s\S]*?\n\}/)[0];
  check("renderHome does not open the bill", renderHome.includes("openBill"), false);
  // Take the handler that listens for ticks on the habit list.
  const start = script.indexOf('$("#habitList").addEventListener("change"');
  const handler = script.slice(start, script.indexOf("});", start) + 3);
  check("the tick handler opens the bill when the day is finished",
    handler.includes("setTimeout(openBill, 600)"), true);
  check("the tick handler restores keyboard focus",
    handler.includes("focusCheckbox(habitId, exercise)"), true);
}

// =================================================================
console.log("\nRegression - the rules from Step 2 still hold");
{
  // Unscheduled days are skipped, they do not break the streak.
  const store = { habits: [habit({ days:[0,2,4] })],
    log: { [day(9)]: {h1:true}, [day(11)]: {h1:true}, [day(13)]: {h1:true} } };
  const app = loadApp(store, day(15));
  check("only Mon/Wed/Fri scheduled, all done -> 3", app.computeHabitStreak(app.data.habits[0], day(15)), 3);
}
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
{
  // (d) writeDayExercises: keeps ticks for names that stay, drops the rest, new ones unticked
  const store = { habits: [habit({ id:"g", type:"gym" })],
    log: { [day(9)]: { g: { "Bench Press": true, "Squat": false } } } };
  const app = loadApp(store, day(9));
  const prev = { "Bench Press": true, "Squat": false };
  app.writeDayExercises(day(9), "g", ["Bench Press", "Deadlift"], prev);
  check("staying tick kept, dropped name gone, new name unticked",
    app.data.log[day(9)].g, { "Bench Press": true, "Deadlift": false });
  app.writeDayExercises(day(9), "g", [], null);
  check("an empty selection removes the day's list", app.dayExercises(day(9), "g"), []);
}

// =================================================================
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
{
  // Today already has an entry with a tick; repeat must preserve ticks for
  // exercises that are in both lists, and start the others unticked.
  const store = { habits: [habit({ id:"g", type:"gym" })], log: {
    [day(10)]: { g: { "Bench Press": true } },
    [day(11)]: { g: { "Bench Press": true, "Deadlift": false } }
  }};
  const app = loadApp(store, day(11));
  app.repeatLastWorkout("g", day(11));
  check("repeat keeps tick for shared exercise",
    app.data.log[day(11)].g, { "Bench Press": true });
  check("preserved tick completes the day",
    app.isHabitDone(app.data.habits[0], day(11)), true);
}
{
  // Fully completed days are what the order number counts.
  const store = { habits: [habit({})], log: { [day(9)]: {h1:true}, [day(10)]: {h1:true}, [day(11)]: {h1:false} } };
  const app = loadApp(store, day(15));
  check("two fully completed days", app.countCompleteDays(), 2);
}

// =================================================================
console.log("\nSound & vibration");
{
  // node has neither AudioContext nor navigator.vibrate
  const app = loadApp({ habits: [], log: {} });
  check("audioReady returns false with no AudioContext", app.audioReady(), false);
  let threw = false;
  try{
    app.playClick();
    app.playTick(true);
    app.playTick(false);
    app.playConfirm();
    app.playDelete();
    app.playError();
    app.playBillStep();
    app.playBillDing();
    app.playBillTear();
    app.vibrate(8);
    app.vibrate([20,40,20]);
  }catch(e){ threw = true; }
  check("no sound/vibrate function throws without AudioContext or navigator", threw, false);
}
{
  // settings are saved in a separate key and read back
  const app1 = loadApp({ habits: [], log: {} });
  check("default sound on", app1.settings.sound, true);
  check("default vibration on", app1.settings.vibration, true);
  app1.settings.sound = false;
  app1.settings.vibration = false;
  app1.saveSettings();
  const app2 = loadApp({ habits: [], log: {} });
  check("sound off read back", app2.settings.sound, false);
  check("vibration off read back", app2.settings.vibration, false);
  // back to defaults for other tests
  app2.settings.sound = true;
  app2.settings.vibration = true;
  app2.saveSettings();
}
{
  // nothing plays when sound is off: settings.sound = false must short-circuit
  const app = loadApp({ habits: [], log: {} });
  app.settings.sound = false;
  // creating the context must not happen while sound is off
  app.playClick();
  app.playConfirm();
  check("audio context not created while sound off", app.audioReady(), false);
}
{
  // settings labels follow state immediately on toggle and on open
  const app = loadApp({ habits: [], log: {} });
  app.updateSettingsLabels(); // simulate panel open (openSettings calls this)
  check("default labels ON/ON", JSON.stringify(app.settingsLabels()), JSON.stringify({ sound:"ON", vibration:"ON" }));
  app.settings.sound = false;
  app.settings.vibration = true;
  app.updateSettingsLabels();
  check("toggled labels OFF/ON", JSON.stringify(app.settingsLabels()), JSON.stringify({ sound:"OFF", vibration:"ON" }));
  app.settings.sound = true;
  app.settings.vibration = false;
  app.updateSettingsLabels();
  check("toggled labels ON/OFF", JSON.stringify(app.settingsLabels()), JSON.stringify({ sound:"ON", vibration:"OFF" }));
}

// =================================================================
console.log("\nCalendar reminders (buildIcs)");
{
  const mwf = habit({ id: "h-mwf", name: "Gym", days: [0, 2, 4], reminder: "07:15", createdAt: day(9) });
  const app = loadApp({ habits: [mwf], log: {} }, day(9));
  const ics = app.buildIcs([mwf]);
  check("VERSION/PRODID/CALSCALE present", ics.includes("VERSION:2.0") && ics.includes("PRODID:-//Punchout//EN") && ics.includes("CALSCALE:GREGORIAN"), true);
  check("lines use CRLF endings", ics.split("\n").filter(l => l !== "").every(l => l.endsWith("\r")), true);
  check("BEGIN:VEVENT present", ics.includes("BEGIN:VEVENT"), true);
  check("UID stable (habitId@punchout)", ics.includes("UID:h-mwf@punchout"), true);
  check("SUMMARY present", ics.includes("SUMMARY:Punchout: Gym"), true);
  check("DESCRIPTION present", ics.includes("DESCRIPTION:Open Punchout and tick off Gym."), true);
  check("DTSTART on scheduled day (Monday Nov 9)", ics.includes("DTSTART:20261109T071500"), true);
  check("DURATION 5 minutes", ics.includes("DURATION:PT5M"), true);
  check("RRULE BYDAY=MO,WE,FR", ics.includes("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"), true);
  check("VALARM with ACTION:DISPLAY and TRIGGER:PT0M", ics.includes("BEGIN:VALARM") && ics.includes("ACTION:DISPLAY") && ics.includes("TRIGGER:PT0M"), true);
  check("END blocks present", ics.includes("END:VALARM") && ics.includes("END:VEVENT") && ics.includes("END:VCALENDAR"), true);
}
{
  // folding: no folded line exceeds 75 chars and a fold occurs for long lines
  const longName = habit({ id: "h1", name: "A very long habit name that exceeds seventy five octets when combined with the Punchout prefix", days: [0], reminder: "08:00", createdAt: day(9) });
  const app = loadApp({ habits: [longName], log: {} }, day(9));
  const ics = app.buildIcs([longName]);
  check("no folded line exceeds 75 chars", ics.split("\r\n").every(l => l.length <= 75), true);
  check("a fold occurred (continuation starts with space)", ics.includes("\r\n "), true);
}
{
  // escaping: comma, semicolon, backslash, newline in habit name
  const weird = habit({ id: "h2", name: "A,B;C\\D\nE", days: [0], reminder: "09:00", createdAt: day(9) });
  const app = loadApp({ habits: [weird], log: {} }, day(9));
  const ics = app.buildIcs([weird]);
  check("comma escaped", ics.includes("SUMMARY:Punchout: A\\,B"), true);
  check("semicolon escaped", ics.includes("B\\;C"), true);
  check("backslash escaped", ics.includes("C\\\\D"), true);
  check("newline escaped", ics.includes("\\nE"), true);
}
{
  // first DTSTART falls on a scheduled day: Sunday-only habit, today is Monday
  const sunday = habit({ id: "h3", name: "SunHabit", days: [6], reminder: "18:30", createdAt: day(9) });
  const app = loadApp({ habits: [sunday], log: {} }, day(9));
  const ics = app.buildIcs([sunday]);
  check("DTSTART is next Sunday (Nov 15)", ics.includes("DTSTART:20261115T183000"), true);
  check("BYDAY=SU", ics.includes("RRULE:FREQ=WEEKLY;BYDAY=SU"), true);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);