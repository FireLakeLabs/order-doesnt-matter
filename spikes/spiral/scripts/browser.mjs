import { chromium } from 'playwright';
import { existsSync,readdirSync } from 'node:fs';
import os from 'node:os';
export async function launchBrowser() {
  // Prefer the pinned Playwright browser. A caller may explicitly name an installed Chromium.
  let executablePath=process.env.CHROMIUM_PATH;
  if(!executablePath&&!existsSync(chromium.executablePath())) {
    const cache=`${os.homedir()}/.cache/ms-playwright`;
    const installed=existsSync(cache)?readdirSync(cache).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse():[];
    executablePath=installed.map(n=>`${cache}/${n}/chrome-linux64/chrome`).find(p=>existsSync(p));
  }
  return chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
}
