const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await page.goto('file:///D:/PUNCHOUT/index.html');
  await page.click('[data-go=newHabit]');
  await page.waitForTimeout(200);
  await page.click('input[name="category"][value="Custom"]', {force:true});
  await page.fill('#habitName','My Custom');
  await page.click('.days input[data-day="4"]', {force:true});
  await page.click('#saveHabit');
  await page.waitForTimeout(500);
  console.log('errors',errs);
  console.log('home text', await page.textContent('#habitList'));
  await browser.close();
})();
