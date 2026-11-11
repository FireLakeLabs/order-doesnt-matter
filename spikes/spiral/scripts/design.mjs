import {launchBrowser} from './browser.mjs';
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1440,height:1000}});
await page.goto(process.env.SPIRAL_URL);
await page.waitForFunction(()=>window.spiral?.ready);
const programs=await page.evaluate(()=>window.spiral.programs);
for(const p of programs) {
  await page.selectOption('#program',p.id);
  await page.waitForFunction(()=>window.spiral.ready);
  console.log(p.id,await page.locator('#status').textContent());
  if(['full-piece','arrange-64','density-64','chords','signals','long-overlap'].includes(p.id))for(const view of ['ring','fly','side']) {
    await page.click(`[data-view="${view}"]`);await page.waitForTimeout(140);
    await page.screenshot({path:`shots/pass-${process.env.PASS??'1'}-${p.id}-${view}.png`});
  }
}
await browser.close();
