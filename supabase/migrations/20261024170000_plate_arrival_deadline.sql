-- Keep private plate authorization consistent with the 15-minute no-show
-- policy even between scheduler ticks. Earlier migration checksums stay fixed.
begin;
do $$
declare v_definition text; v_old text; v_new text;
begin
  v_definition:=pg_catalog.pg_get_functiondef('public.authorize_hardware_plate_entry(uuid,text,timestamptz,text)'::regprocedure);
  v_old:='or v_protected_at is null or p_recognized_at<=v_protected_at';
  v_new:='or v_protected_at is null
    or v_now>=least(s.ends_at,v_protected_at+interval ''15 minutes'')
    or p_recognized_at>=least(s.ends_at,v_protected_at+interval ''15 minutes'')
    or p_recognized_at<=v_protected_at';
  if pg_catalog.strpos(v_definition,v_old)=0 then raise exception 'PLATE_DEADLINE_UPGRADE_REQUIRED'; end if;
  execute pg_catalog.replace(v_definition,v_old,v_new);
end;
$$;
comment on function public.authorize_hardware_plate_entry(uuid,text,timestamptz,text) is
  'Private service-role recognition consumer. Both current database time and recognized event must precede the earlier of slot end or protection confirmation plus 15 minutes. Accepted retries create no additional operation.';
commit;
