// lib/playwright.ts
// npm i playwright
import { chromium, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export type Snapshot = {
  html: string;
  layout: Array<{ path: string; bbox: { x: number; y: number; width: number; height: number } }>;
  screenshotPath: string;
};

function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && parts.length < 6) {
    let seg = cur.tagName.toLowerCase();
    const id = (cur as HTMLElement).id;
    if (id) {
      parts.unshift(`#${CSS.escape(id)}`);
      break;
    }
    const cls = (cur as HTMLElement).className || '';
    const classes = String(cls).split(/\s+/).filter(Boolean).slice(0, 2);
    if (classes.length) seg += '.' + classes.map(CSS.escape).join('.');
    else if (cur.parentElement) {
      const siblings = Array.from(cur.parentElement.children).filter(ch => ch.tagName === cur!.tagName);
      if (siblings.length > 1) seg += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
    }
    parts.unshift(seg);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

async function collectLayout(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ path: string; bbox: { x: number; y: number; width: number; height: number } }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node: any;
    while ((node = walker.nextNode())) {
      const el = node as Element;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        out.push({
          path: (window as any).CSS && (window as any).CSS.escape ? `${el.tagName.toLowerCase()}` : el.tagName.toLowerCase(),
          bbox: { x: r.x, y: r.y, width: r.width, height: r.height },
        });
      }
    }
    return out;
  });
}

export async function capturePage(url: string, { outDir }: { outDir: string }): Promise<Snapshot> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  await page.goto(url, { waitUntil: 'networkidle' });

  const html = await page.content();
  const layout = await collectLayout(page);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const fileBase = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const screenshotPath = path.join(outDir, `${fileBase}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await browser.close();
  return { html, layout, screenshotPath };
}
