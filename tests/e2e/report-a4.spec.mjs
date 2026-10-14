import { test, expect } from '@playwright/test';
import { renderMatchReportDocument } from '../../js/match-report.js';
import { matchReportFixture } from '../fixtures/match-reports.mjs';

for (const sport of ['calcio', 'basket', 'pallavolo']) {
  test(`Referto A4: due pagine con rose complete e cronologia estesa (${sport})`, async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const fixture = matchReportFixture(sport, { playersPerTeam: 20, eventCount: 130 });
      const html = renderMatchReportDocument(fixture);
      await page.setContent(html, { waitUntil: 'load' });
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
      // Chromium writes its page dictionaries uncompressed even when content streams are compressed.
      const count = (pdf.toString('latin1').match(/\\/Type\\s*\\/Page\\b/g) || []).length;
      expect(count, `Referto ${sport}: ${count} pagine A4, massimo 2 consentite`).toBeGreaterThan(0);
      expect(count, `Referto ${sport}: ${count} pagine A4, massimo 2 consentite`).toBeLessThanOrEqual(2);
      expect(html).toContain('Cronologia partita');
    } finally {
      await page.close();
    }
  });
}
