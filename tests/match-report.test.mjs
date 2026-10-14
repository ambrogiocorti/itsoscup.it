import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { getMatchReportColumns, renderMatchReport, renderMatchReportDocument, MATCH_REPORT_CSS } from '../js/match-report.js';
import { matchReportFixture } from './fixtures/match-reports.mjs';

test('sport sheets use goals/cards for soccer, fouls for basketball and cards for volleyball', () => {
  assert.deepEqual(getMatchReportColumns('calcio').map((column) => column.label), ['Pres.', 'Reti', 'Gialli', 'Rossi']);
  assert.deepEqual(getMatchReportColumns('basket').map((column) => column.label), ['Pres.', 'Punti', 'Falli']);
  assert.deepEqual(getMatchReportColumns('pallavolo').map((column) => column.label), ['Pres.', 'Punti', 'Gialli', 'Rossi']);
  assert.deepEqual(getMatchReportColumns('pallavolo', { allow_yellow_cards: false, allow_red_cards: false }).map((column) => column.label), ['Pres.', 'Punti']);
  assert.ok(getMatchReportColumns('calcio', { allow_red_cards: false }, [{ red_cards: 1 }]).some((column) => column.key === 'red_cards'));
});

test('captains are bold, attendance is X, MVP is a black star beside the name and chronology immediately precedes captain signatures', () => {
  const html = renderMatchReport(matchReportFixture());
  assert.match(html, /<strong class="report-captain">Alessandro De Santis della Torre<\/strong>/);
  assert.match(html, /Matteo Della Francesca <span class="match-report-mvp"[^>]+>&#9733;<\/span>/);
  assert.match(html, /class="report-stat report-presence">X<\/td>/);
  assert.doesNotMatch(html, /<th[^>]*>(?:Cap\.|Capitano|MVP)<\/th>|>Sì<|>No</);
  assert.match(html, /<h2>Cronologia partita<\/h2>[\s\S]*?<\/section>\s*<section class="match-report-signatures">/);
});

test('large chronologies have a labelled print summary and every original note remains in the digital report', () => {
  const fixture = matchReportFixture('basket', { eventCount: 130 });
  fixture.eventLog[75].notes = 'NOTA COMPLETA DA CONSERVARE';
  const html = renderMatchReport(fixture);
  assert.match(html, /Sintesi di tutte le 130 registrazioni/);
  assert.match(html, /Registro digitale integrale · 130 eventi/);
  assert.match(html, /NOTA COMPLETA DA CONSERVARE/);
  assert.equal(fixture.eventLog.length, 130);
});

test('a historical player and nonstandard sanctions cannot disappear when the current roster changes', () => {
  const fixture = matchReportFixture('basket');
  fixture.players = fixture.players.filter((row) => row.id !== 3);
  fixture.stats[2].yellow_cards = 1;
  const html = renderMatchReport(fixture);
  assert.match(html, /Matteo Della Francesca/);
  assert.match(html, /Altre sanzioni presenti nel registro storico: Matteo Della Francesca: 1 gialli/);
});

test('the signed captain stays authoritative after a later captain change, and substitutions retain the incoming player', () => {
  const fixture = matchReportFixture();
  fixture.players[0].is_captain = false;
  fixture.players[1].is_captain = true;
  fixture.eventLog = [{ event_type: 'substitution', player_id: 2, incoming_player_id: 3, minute: 4, team_id: 1, home_score: 0, away_score: 0 }];
  const html = renderMatchReport(fixture);
  assert.match(html, /<strong class="report-captain">Alessandro De Santis della Torre<\/strong>/);
  assert.doesNotMatch(html, /<strong class="report-captain">Giulia Rossi<\/strong>/);
  assert.match(html, /Entra Matteo Della Francesca/);
});

test('untrusted names, notes and signature URLs cannot introduce markup or external image fetches', () => {
  const fixture = matchReportFixture();
  fixture.players[0].full_name = '<script>alert(1)</script>';
  fixture.stats[0].player_name = fixture.players[0].full_name;
  fixture.notes = '<img src="https://example.test/track">';
  fixture.signatures[0].signature_data_url = 'https://example.test/track';
  const html = renderMatchReportDocument(fixture, { title: '<script>' });
  assert.doesNotMatch(html, /<script>|<img src="https:/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=&quot;https:\/\/example.test\/track&quot;&gt;/);
});

test('emergency paper keeps the same two-page format with blank score/stat cells and signature lines', () => {
  const html = renderMatchReport(matchReportFixture('calcio', { mode: 'paper' }));
  assert.match(html, /Referto cartaceo di emergenza/);
  assert.match(html, /___ - ___/);
  assert.doesNotMatch(html, /class="report-stat report-presence">X/);
  assert.equal((html.match(/data-report-page=/g) || []).length, 2);
});

test('standalone CSS delivered to the packaged desktop matches the shared print stylesheet', () => {
  assert.equal(readFileSync(new URL('../css/match-report.css', import.meta.url), 'utf8'), MATCH_REPORT_CSS.trimStart());
});
