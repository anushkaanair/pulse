import { chromium } from '@playwright/test';

(async () => {
  try {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    
    console.log("Navigating to Demo Watchlist...");
    await page.goto('https://pulse-groww.vercel.app/w/demo-watchlist');
    await page.waitForTimeout(4000); // extra wait for data to load
    
    console.log("Taking sidebar screenshot...");
    // Grab the entire right column which contains Summary, Investments, and Market
    const rightCol = page.locator('.lg\\:col-span-4').first();
    if (await rightCol.count() > 0) {
      await rightCol.screenshot({ path: '/Users/anushkanair/Desktop/pulseSS/05_sidebar_features.png' });
    }
    
    console.log("Taking Tracked Stocks screenshot...");
    // Grab the section containing the tracked stocks list
    const stocksHeader = page.locator('h2:has-text("All tracked stocks")').first();
    if (await stocksHeader.count() > 0) {
      const container = stocksHeader.locator('xpath=./../..');
      await container.screenshot({ path: '/Users/anushkanair/Desktop/pulseSS/06_tracked_stocks_list.png' });
    }

    console.log("Done!");
    await browser.close();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
})();
