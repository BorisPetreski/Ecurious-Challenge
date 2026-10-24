-- Fictional local-only directory booking options; no hosted API or hardware.
begin;
insert into auth.users(id) values
  ('81111111-1111-4111-8111-111111111111'),('82222222-2222-4222-8222-222222222222');
do $$
declare a jsonb; b jsonb; c jsonb; d jsonb; snap jsonb; first_end timestamptz;
  future_at timestamptz:=pg_catalog.date_trunc('second',pg_catalog.clock_timestamp())+interval '1 hour';
  slot text:=pg_catalog.repeat('a',64); owner_a text:='81111111-1111-4111-8111-111111111111';
  owner_b text:='82222222-2222-4222-8222-222222222222';
begin
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  begin perform public.list_directory_holds(array[910001]::bigint[]); raise exception 'expected anonymous denial';
    exception when insufficient_privilege then null; end;
  if pg_catalog.has_table_privilege('authenticated','public.directory_plug_extensions','select')
    or pg_catalog.has_table_privilege('anon','public.directory_plug_extensions','select')
    or not (select relrowsecurity from pg_catalog.pg_class where oid='public.directory_plug_extensions'::regclass)
    or pg_catalog.has_function_privilege('anon','public.reserve_directory_booking(bigint,text,text,timestamptz,uuid)','execute')
    or pg_catalog.has_function_privilege('authenticated','public._directory_booking_json(uuid)','execute') then raise exception 'private access boundary failed'; end if;
  perform pg_catalog.set_config('request.jwt.claim.sub',owner_a,true);
  a:=public.reserve_directory_booking(910001,slot,'now',null,'83333333-3333-4333-8333-333333333331');
  if a->>'bookingMode'<>'now' or (a->>'reservationFeeCents')::integer<>0 or a->>'paymentStatus'<>'not_required'
    or (a->>'expiresAt')::timestamptz-(a->>'startsAt')::timestamptz<>interval '10 minutes'
    or a->>'protectionStartsAt'<>a->>'startsAt' then raise exception 'Now policy failed'; end if;
  b:=public.reserve_directory_booking(910001,slot,'now',null,'83333333-3333-4333-8333-333333333331');
  if a<>b then raise exception 'Now retry changed result'; end if;
  begin perform public.reserve_directory_booking(910002,slot,'now',null,'83333333-3333-4333-8333-333333333331'); raise exception 'expected request conflict';
    exception when raise_exception then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise; end if; end;
  perform pg_catalog.set_config('request.jwt.claim.sub',owner_b,true);
  begin perform public.reserve_directory_booking(910001,slot,'now',null,'83333333-3333-4333-8333-333333333332'); raise exception 'expected slot conflict';
    exception when raise_exception then if sqlerrm<>'PLUG_RESERVED' then raise; end if; end;
  perform pg_catalog.set_config('request.jwt.claim.sub',owner_a,true);
  c:=public.reserve_directory_booking(910001,slot,'scheduled',future_at,'83333333-3333-4333-8333-333333333333');
  if (c->>'reservationFeeCents')::integer<>100 or c->>'paymentStatus'<>'mock_paid'
    or (c->>'expiresAt')::timestamptz-future_at<>interval '10 minutes'
    or future_at-(c->>'protectionStartsAt')::timestamptz<>interval '10 minutes' then raise exception 'calendar policy failed'; end if;
  b:=public.reserve_directory_booking(910001,slot,'scheduled',future_at,'83333333-3333-4333-8333-333333333333');
  if b<>c then raise exception 'calendar retry changed result'; end if;
  begin perform public.reserve_directory_booking(910001,slot,'scheduled',future_at+interval '1 minute','83333333-3333-4333-8333-333333333333'); raise exception 'expected calendar request conflict';
    exception when raise_exception then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise; end if; end;
  d:=public.reserve_directory_booking(910001,slot,'scheduled',future_at+interval '20 minutes','83333333-3333-4333-8333-333333333334');
  begin perform public.reserve_directory_booking(910001,slot,'scheduled',future_at+interval '19 minutes','83333333-3333-4333-8333-333333333335'); raise exception 'expected lead-in conflict';
    exception when raise_exception then if sqlerrm<>'PLUG_RESERVED' then raise; end if; end;
  snap:=public.list_directory_holds(array[]::bigint[]);
  if pg_catalog.jsonb_array_length(snap->'holds')<>1 or pg_catalog.jsonb_array_length(snap->'myBookings')<>3 then raise exception 'owned future recovery or current projection failed'; end if;
  perform pg_catalog.set_config('request.jwt.claim.sub',owner_b,true);
  snap:=public.list_directory_holds(array[910001]::bigint[]);
  if pg_catalog.jsonb_array_length(snap->'holds')<>1 or pg_catalog.jsonb_array_length(snap->'myBookings')<>0
    or (snap->'holds'->0->>'isMine')::boolean or snap->'holds'->0->'myReservationId'<>'null'::jsonb then raise exception 'other user projection failed'; end if;
  begin perform public.cancel_directory_hold((c->>'id')::uuid); raise exception 'expected cancel ownership denial';
    exception when raise_exception then if sqlerrm<>'RESERVATION_NOT_FOUND' then raise; end if; end;
  begin perform public.extend_directory_booking((a->>'id')::uuid,'84444444-4444-4444-8444-444444444441'); raise exception 'expected extension ownership denial';
    exception when raise_exception then if sqlerrm<>'RESERVATION_NOT_FOUND' then raise; end if; end;
  perform pg_catalog.set_config('request.jwt.claim.sub',owner_a,true);
  first_end:=(a->>'expiresAt')::timestamptz;
  b:=public.extend_directory_booking((a->>'id')::uuid,'84444444-4444-4444-8444-444444444441');
  if (b->>'expiresAt')::timestamptz<>first_end+interval '10 minutes' or (b->>'reservationFeeCents')::integer<>100
    or (b->>'extensionMinutes')::integer<>10 or b->>'paymentStatus'<>'mock_paid' then raise exception 'extension policy failed'; end if;
  a:=public.extend_directory_booking((a->>'id')::uuid,'84444444-4444-4444-8444-444444444441');
  if a<>b then raise exception 'extension retry changed fee or deadline'; end if;
  begin perform public.extend_directory_booking((c->>'id')::uuid,'84444444-4444-4444-8444-444444444441'); raise exception 'expected extension request conflict';
    exception when raise_exception then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise; end if; end;
  begin perform public.extend_directory_booking((c->>'id')::uuid,'84444444-4444-4444-8444-444444444442'); raise exception 'expected extension overlap';
    exception when raise_exception then if sqlerrm<>'PLUG_RESERVED' then raise; end if; end;
  b:=public.cancel_directory_hold((d->>'id')::uuid);
  if b->>'status'<>'cancelled' then raise exception 'future cancellation failed'; end if;
  if public.cancel_directory_hold((d->>'id')::uuid)<>b then raise exception 'cancel retry changed result'; end if;
  b:=public.extend_directory_booking((c->>'id')::uuid,'84444444-4444-4444-8444-444444444442');
  if (b->>'reservationFeeCents')::integer<>200 then raise exception 'scheduled extension mock fee failed'; end if;
  begin perform public.reserve_directory_booking(910003,slot,'now',future_at,'83333333-3333-4333-8333-333333333336'); raise exception 'expected invalid Now timestamp';
    exception when raise_exception then if sqlerrm<>'INVALID_SCHEDULE' then raise; end if; end;
  begin perform public.reserve_directory_booking(910003,slot,'scheduled',null,'83333333-3333-4333-8333-333333333336'); raise exception 'expected missing schedule';
    exception when raise_exception then if sqlerrm<>'INVALID_SCHEDULE' then raise; end if; end;
  begin perform public.reserve_directory_plug(910003,slot,15,'83333333-3333-4333-8333-333333333336'); raise exception 'expected legacy-duration refusal';
    exception when raise_exception then if sqlerrm<>'INVALID_HOLD' then raise; end if; end;
  b:=public.reserve_directory_plug(910003,slot,10,'83333333-3333-4333-8333-333333333336');
  if b->>'bookingMode'<>'now' or (b->>'reservationFeeCents')::integer<>0 then raise exception 'legacy ten-minute wrapper failed'; end if;
end;
$$;
rollback;
