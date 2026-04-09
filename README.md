# Tornei Scuola - Refactor Ibrido Completo

Piattaforma web per gestione tornei scolastici con:

- dashboard pubblica risultati live (`index.html`)
- dashboard amministrativa multi-ruolo (`admin.html`)
- pagina dedicata live match con lock multi-admin (`live.html`)
- moduli JavaScript Vanilla + Supabase
- migrazione SQL completa (schema, RLS, view, RPC)

## Struttura

- `index.html`
- `admin.html`
- `live.html`
- `css/style.css`
- `js/app-config.js`
- `js/db.js`
- `js/auth.js`
- `js/matches.js`
- `js/teams.js`
- `js/live.js`
- `js/events.js`
- `js/reports.js`
- `js/main-index.js`
- `js/main-admin.js`
- `js/main-live.js`
- `sql/001_refactor_hybrid.sql`
- `sql/001_refactor_hybrid_rollback.sql`
- `sql/002_seed_demo_tornei.sql`
- `sql/003_mvp_config_per_torneo.sql`
- `sql/004_fix_legacy_foreign_keys.sql`
- `sql/005_fix_finalize_match_ambiguous.sql`

## Setup rapido

1. Apri Supabase SQL Editor.
2. Esegui `sql/001_refactor_hybrid.sql`.
3. Verifica in Supabase che RLS sia attivo e che le RPC siano create.
4. Apri `index.html` in ambiente web statico (es. Live Server VS Code).

Per popolare dati demo (più tornei, squadre, giocatori, match ed eventi atletica):

5. Esegui `sql/002_seed_demo_tornei.sql` nello stesso SQL Editor.

Per i progetti già migrati, per spostare la gestione MVP da match live a impostazione torneo:

6. Esegui `sql/003_mvp_config_per_torneo.sql`.

Se il database è stato creato prima del refactor e compaiono errori di FK/relazioni in Supabase:

7. Esegui `sql/004_fix_legacy_foreign_keys.sql`.

Se in chiusura live compare errore su `match_id is ambiguous`:

8. Esegui `sql/005_fix_finalize_match_ambiguous.sql`.

## Ruoli admin supportati

- `super_admin`
- `match_manager`
- `report_viewer`

## Funzioni RPC live match

- `acquire_match_lock(match_id, ttl_seconds)`
- `refresh_match_lock(match_id, ttl_seconds)`
- `release_match_lock(match_id)`
- `save_live_snapshot(match_id, payload, expected_version)`
- `finalize_match(match_id, payload, stats_payload, expected_version)`

## Note operative

- Se le RPC non sono ancora presenti nel DB, il frontend usa fallback compatibile.
- Per piena concorrenza multi-admin e sicurezza, applicare sempre la migrazione SQL.
- La chiave Supabase è centralizzata in `js/app-config.js`.


