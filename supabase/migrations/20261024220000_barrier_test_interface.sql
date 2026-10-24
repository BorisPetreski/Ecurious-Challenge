-- A barrier-only test interface must not invent a charging connector/rating.
-- Enrollment and all existing hardware interlocks remain separate and off.
begin;
alter table public.bay_connectors drop constraint connector_verified_power;
alter table public.bay_connectors add constraint connector_verified_power check (
  (connector_type='BARRIER_TEST' and power_kw=0)
  or (connector_type<>'BARRIER_TEST' and power_kw>0)
  or (connector_type='UNKNOWN' and not enabled and power_kw=0)
);
comment on table public.bay_connectors is
  'Operator-registered interfaces on one physical one-vehicle bay. Charging connectors require positive rated power. BARRIER_TEST is a non-charging barrier-only interface with exactly 0kW, never evidence of charger type, charging or delivered power. Disabled UNKNOWN/0kW rows preserve historical unknown plug selections. Different interfaces on one bay share its allocation; hardware enrollment/interlocks/assignment and durable confirmation guards remain required.';
notify pgrst,'reload schema';
commit;
