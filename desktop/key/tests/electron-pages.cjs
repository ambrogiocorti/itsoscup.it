'use strict';
async function appPage(application, scheme) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const page = application.context().pages().find(p => p.url().startsWith(scheme + '://app/')); if (page) { await page.waitForLoadState('domcontentloaded'); return page; } await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Missing native application view: ' + scheme);
}
module.exports = { appPage };
