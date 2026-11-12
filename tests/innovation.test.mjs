import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEvent, analyticsCsv } from '../js/event-analytics.js';

test('empty tournament produces accurate zeros and ND for missing measures',()=>{
  const result=summarizeEvent([]);
  assert.equal(result.total,0);
  assert.equal(result.averageDelay,null);
  assert.equal(result.averageDuration,null);
  assert.equal(result.reschedules,0);
  assert.match(analyticsCsv(result),/Ritardo medio \(min\)";"ND"/);
});
test('delays are computed only on recorded start times; duration only on finished matches',()=>{
  const data=summarizeEvent([
    {is_finished:true,status:'finished',started_at:'2026-10-10T10:10:00Z',scheduled_start:'2026-10-10T10:00:00Z',finished_at:'2026-10-10T11:10:00Z'},
    {is_finished:true,status:'finished',started_at:'2026-10-10T12:00:00Z',scheduled_start:'2026-10-10T12:00:00Z',finished_at:'2026-10-10T12:40:00Z',reopened_at:'2026-10-10T12:50:00Z'},
    {is_finished:false,status:'scheduled',scheduled_start:'2026-10-10T13:00:00Z'},
    {is_finished:false,status:'cancelled'}
  ],[{id:1},{id:2}]);
  assert.equal(data.total,4);
  assert.equal(data.completed,2);
  assert.equal(data.pending,1);
  assert.equal(data.measuredStarts,2);
  assert.equal(data.lateStarts,1);
  assert.equal(data.averageDelay,5);
  assert.equal(data.averageDuration,50);
  assert.equal(data.reschedules,2);
  assert.equal(data.corrections,1);
});
test('negative or invalid durations do not alter the mean',()=>{
  const data=summarizeEvent([{is_finished:true,started_at:'2026-10-10T10:00:00Z',finished_at:'2026-10-10T09:00:00Z'}]);
  assert.equal(data.measuredDurations,0);
  assert.equal(data.averageDuration,null);
});
test('CSV is spreadsheet-safe for numbers and contains BOM',()=>{
  const data=summarizeEvent([{is_finished:false,status:'scheduled'}]);
  assert.ok(analyticsCsv(data).startsWith('\uFEFF'));
  assert.match(analyticsCsv(data),/Partite";"1"/);
});
