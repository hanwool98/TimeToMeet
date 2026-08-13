create table if not exists public.event_application_counters (
  event_id text primary key references public.events(id) on delete cascade,
  last_sequence integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.applications
add column if not exists application_sequence integer;

do $$
begin
  alter table public.applications drop constraint if exists applications_application_no_key;
exception
  when undefined_table then null;
end $$;

drop index if exists public.applications_application_no_key;

create unique index if not exists applications_event_application_no_unique
on public.applications (event_id, application_no);

create unique index if not exists applications_event_application_sequence_unique
on public.applications (event_id, application_sequence)
where application_sequence is not null;

create or replace function public.format_event_application_no(target_event_id text, sequence_value integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'TTM-' || to_char(e.event_date, 'MMDD') || '-' || lpad(sequence_value::text, 3, '0')
  from public.events e
  where e.id = target_event_id;
$$;

create or replace function public.next_event_application_no(target_event_id text)
returns table (
  application_no text,
  application_sequence integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_sequence integer;
begin
  if not exists (select 1 from public.events where id = target_event_id) then
    raise exception 'Event not found.';
  end if;

  insert into public.event_application_counters (event_id, last_sequence)
  values (target_event_id, 1)
  on conflict (event_id) do update
  set
    last_sequence = public.event_application_counters.last_sequence + 1,
    updated_at = now()
  returning last_sequence into next_sequence;

  return query
  select public.format_event_application_no(target_event_id, next_sequence), next_sequence;
end;
$$;

create or replace function public.assign_event_application_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned record;
begin
  if new.application_sequence is null
    or new.application_no is null
    or new.application_no ~ '^TTM[_-][0-9]{3}$'
  then
    select *
    into assigned
    from public.next_event_application_no(new.event_id);

    new.application_no = assigned.application_no;
    new.application_sequence = assigned.application_sequence;
  end if;

  return new;
end;
$$;

alter table public.applications
alter column application_no drop default;

drop trigger if exists assign_event_application_no_before_insert on public.applications;
create trigger assign_event_application_no_before_insert
before insert on public.applications
for each row
execute function public.assign_event_application_no();

with numbered as (
  select
    a.id,
    row_number() over (partition by a.event_id order by a.submitted_at, a.id)::integer as sequence_value
  from public.applications a
),
updated as (
  update public.applications a
  set
    application_sequence = numbered.sequence_value,
    application_no = public.format_event_application_no(a.event_id, numbered.sequence_value)
  from numbered
  where a.id = numbered.id
  returning a.event_id, a.application_sequence
)
insert into public.event_application_counters (event_id, last_sequence, updated_at)
select event_id, max(application_sequence), now()
from public.applications
where application_sequence is not null
group by event_id
on conflict (event_id) do update
set
  last_sequence = excluded.last_sequence,
  updated_at = now();

notify pgrst, 'reload schema';
