import { chromium } from '@playwright/test';

(async () => {
  try {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    
    console.log("Navigating to Pulse...");
    await page.goto('https://pulse-groww.vercel.app/');
    await page.waitForTimeout(2000);
    
    console.log("Taking landing page screenshot...");
    await page.screenshot({ path: '/Users/anushkanair/Desktop/pulseSS/01_landing.png', fullPage: true });
    
    console.log("Navigating to Demo Watchlist...");
    await page.goto('https://pulse-groww.vercel.app/w/demo-watchlist');
    await page.waitForTimeout(3000);
    
    console.log("Taking full watchlist screenshot...");
    await page.screenshot({ path: '/Users/anushkanair/Desktop/pulseSS/02_watchlist_full.png', fullPage: true });
    
    // Feature 1: Market Rail
    console.log("Taking Market Rail screenshot...");
    const rail = await page.locator('.h-9.items-center').first();
    if (await rail.count() > 0) {
      await rail.screenshot({ path: '/Users/anushkanair/Desktop/pulseSS/03_market_rail.png' });
    }
    
    // Feature 2: Attention Deck
    console.log("Taking Attention Deck screenshot...");
    const deck = await page.locator('.touch-pan-y').first();
    if (await deck.count() > 0) {
      await deck.screenshot({ path: '/Users/anushkanair/Desktop/pulseSS/04_attention_deck.png' });
      
      // Expand the first card to get an expanded screenshot
      const firstCard = await page.locator('.touch-pan-y article').first();
      await firstCard.click();
      await page.waitForTimeout(1000);
      await deck.screenshot({ path: '/Users/anushkanair/Desktop/pulseSS/04b_attention_deck_expanded.png' });
    }
    
    // Feature 3: Investments Card
    console.log("Taking Investments screenshot...");
    const investments = await page.locator('h3:has-text("Your investments")').first();
    if (await investments.count() > 0) {
      const card = investments.locator('xpath=./../..');
      await card.screenshot({ path: '/Users/anushkanair/Desktop/pulseSS/05_investments_card.png' });
    }
    
    // Feature 4: Summary Card
    console.log("Taking Summary screenshot...");
    const summary = await page.locator('h3:has-text("Watchlist Summary")').first();
    if (await summary.count() > 0) {
      const card = summary.locator('xpath=./../..');
      await card.screenshot({ path: '/Users/anushkanair/Desktop/pulseSS/06_summary_card.png' });
    }

    // Feature 5: Tracked Stocks List
    console.log("Taking Tracked Stocks screenshot...");
    const stocksList = await page.locator('h2:has-text("All tracked stocks")').first();
    if (await stocksList.count() > 0) {
      const listContainer = stocksList.locator('xpath=./../..');
      await listContainer.screenshot({ path: '/Users/anushkanair/Desktop/pulseSS/07_tracked_stocks_list.png' });
    }

    console.log("Done!");
    await browser.close();
  } catch (error) {
    console.error("Error capturing screenshots:", error);
    process.exit(1);
  }
})();
