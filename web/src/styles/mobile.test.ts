// Guards against the two phone bugs that made the app unusable on iPhone: auto-zoom on input focus and sideways scrolling.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

describe('mobile safety rules', () => {
  const base = read('./base.css');
  const layout = read('./layout.css');

  it('keeps form controls at 16px on touch devices and small screens (iOS zooms below that)', () => {
    const block = base.slice(base.indexOf('@media (pointer: coarse)'));
    expect(block).toMatch(/input,\s*select,\s*textarea\s*\{\s*font-size:\s*16px/);
  });

  it('disables double-tap zoom and clips horizontal overflow', () => {
    expect(base).toMatch(/touch-action:\s*manipulation/);
    expect(base).toMatch(/overflow-x:\s*clip/);
  });

  it('never lets a page grid grow wider than its container', () => {
    for (const selector of ['.split', '.split > div', '.two-col', '.two-col > div']) {
      const start = layout.indexOf(`${selector} {`);
      expect(start, `${selector} rule exists`).toBeGreaterThan(-1);
      const rule = layout.slice(start, layout.indexOf('}', start));
      expect(rule, `${selector} has a bounded column`).toContain('grid-template-columns: minmax(0, 1fr)');
    }
  });

  it('declares a viewport that allows pinch zoom (accessibility) but sets the device width', async () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain('width=device-width');
    expect(html).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\D|$)/);
  });
});
