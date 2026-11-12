-- Deterministic ordering when notices are inserted within the same second.
begin;
create or replace function public.class_portal(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.class_invites%rowtype; v_reg jsonb; v_notices jsonb;
begin
 select * into v_inv from public.class_invites
 where access_code=lower(btrim(coalesce(p_code,''))) and is_active and
 (expires_at is null or expires_at>now());
 if not found then raise exception 'Codice classe non valido o scaduto'; end if;
 select jsonb_build_object('status',status,'roster',roster,'captain',captain_name,
     'decision_note',decision_note) into v_reg
 from public.class_registrations where invite_id=v_inv.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'body',n.body,
     'created_at',n.created_at,'read_at',r.read_at) order by n.created_at desc,n.id desc),'[]'::jsonb)
 into v_notices from public.class_notice_recipients r
 join public.class_notices n on n.id=r.notice_id where r.invite_id=v_inv.id;
 return jsonb_build_object('class_name',v_inv.class_name,'sport_id',v_inv.sport_id,
 'registration',v_reg,'notices',v_notices);
end $$;

commit;
