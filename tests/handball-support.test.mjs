import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TEAM_SPORTS,SPORT_LABELS} from '../js/app-config.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('handball is an approved team sport with tournament creation option',()=>{
 assert.ok(TEAM_SPORTS.includes('pallamano'));
 assert.equal(SPORT_LABELS.pallamano,'Pallamano');
 assert.match(read('admin/index.html'), /<option value="pallamano">Pallamano<\/option>/);
});
test('handball live exposes two periods and timeouts, including finalization',()=>{
 const live=read('js/main-live.js');
 assert.match(live,/function isHandballMatch/);
 assert.match(live,/isBasket \|\| isHandballMatch\(\)/);
 assert.match(live,/isHandballMatch\(\) \? 2/);
 assert.match(live,/\['calcio', 'basket', 'pallavolo', 'pallamano'\]/);
});
test('dashboard hero links to the actual admin routes',()=>{
 const html=read('admin/index.html');
 assert.match(html,/href="\/admin\?view=matches"/);
 assert.match(html,/href="\/admin\?view=operations"/);
});

test('handball exclusions and 7-meter events are captured in live chronology and reports',()=>{
 const ui=read('live.html'),live=read('js/main-live.js'),report=read('js/match-report.js');
 assert.match(ui,/value="two_minute"/);assert.match(ui,/value="seven_meter"/);
 assert.match(live,/option.hidden=!isHandballMatch/);
 assert.match(live,/isHandballMatch\(\) \|\| Boolean\(state.config/);
 assert.match(report,/two_minutes/);
 assert.match(report,/Esclusione 2 minuti/);
});
