-- Test harness fixture ONLY: run after the first migration and before the
-- hierarchy migration in an isolated disposable database, never a live project.
-- The directory ID and coordinates below are fictional test inputs, not copied
-- GoingElectric records. The private expected snapshot verifies a lossless upgrade.

begin;
insert into auth.users(id) values ('90000000-0000-4000-8000-000000000002');
insert into public.bookable_bays
  (id, goingelectric_id, label, latitude, longitude, integration_mode, enabled)
values
  ('90000000-0000-4000-8000-000000000001', 900000000,
   'Fictional legacy upgrade bay', 52.500123, 13.400456, 'demo', false);
with t as (select pg_catalog.clock_timestamp() as observed_at)
insert into public.booking_reservations
  (id, bay_id, owner_id, starts_at, expires_at, status, idempotency_key, created_at)
select
  '90000000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002',
  t.observed_at, t.observed_at + interval '10 minutes', 'held',
  '90000000-0000-4000-8000-000000000004', t.observed_at
from t;

create table public._bayready_upgrade_expected as
select r.*, b.goingelectric_id as expected_directory_id,
  b.latitude as expected_latitude, b.longitude as expected_longitude,
  b.label as expected_bay_label
from public.booking_reservations r
join public.bookable_bays b on b.id = r.bay_id
where r.id = '90000000-0000-4000-8000-000000000003';
alter table public._bayready_upgrade_expected enable row level security;
revoke all on table public._bayready_upgrade_expected from public, anon, authenticated;
commit;
