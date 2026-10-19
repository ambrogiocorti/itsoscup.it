-- Applied via Supabase migration itsoscup_enable_pallamano_052.
-- Safely extend the existing privileged RPC sport-type whitelist.
do $migration$
declare v_def text;
begin
 select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='save_sport_admin'
 and pg_get_function_identity_arguments(p.oid) like 'p_sport_id bigint, p_name text%';
 if v_def is null then raise exception 'save_sport_admin not found'; end if;
 if position('pallamano' in v_def)=0 then
  if position('''calcio'', ''basket'', ''pallavolo'', ''atletica''' in v_def)=0 then raise exception 'Sport whitelist changed'; end if;
  v_def:=replace(v_def,'''calcio'', ''basket'', ''pallavolo'', ''atletica''',
                        '''calcio'', ''basket'', ''pallavolo'', ''pallamano'', ''atletica''');
  execute v_def;
 end if;
end $migration$;