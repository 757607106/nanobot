const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:6788/');
  await page.waitForTimeout(2000);
  
  // check if there's a login form
  try {
     const inputs = await page.$$('input');
     if (inputs.length >= 2) {
       await inputs[0].fill('admin');
       await inputs[1].fill('admin123');
       await page.keyboard.press('Enter');
       await page.waitForTimeout(3000);
     }
  } catch(e) {}
  
  await page.screenshot({ path: '../docs/assets/showcase/dashboard.png' });
  console.log("Screenshot: dashboard.png");
  
  // try to list interactive elements
  await browser.close();
})();
