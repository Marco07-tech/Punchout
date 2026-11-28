const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file:///D:/PUNCHOUT/index.html');
  await page.waitForTimeout(500);
  // basic clicks
  await page.click('#newHabitBtn'.replace('#newHabitBtn','[data-go=newHabit]')).catch(()=>{});
  await page.waitForTimeout(300);
  console.log('console/page errors:', errors);
  await browser.close();
})();
