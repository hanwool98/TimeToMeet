-- enforce_event_application_deadline() blocks ANY insert into applications
-- once an event's application_deadline has passed - including admin test
-- participant seeding (create_test_participants_for_session), which should
-- work regardless of real-world deadlines, consistent with every other
-- test-event date exemption already in place (event mode, check-in, tablet
-- connect). A test event's deadline is meaningless for testing purposes, so
-- skip enforcement when the event is a test event.
create or replace function public.enforce_event_application_deadline()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  deadline_value timestamptz;
  event_is_test boolean;
begin
  select e.application_deadline, e.is_test_event
    into deadline_value, event_is_test
  from public.events e
  where e.id = new.event_id;

  if not coalesce(event_is_test, false) and deadline_value is not null and now() >= deadline_value then
    raise exception 'Application deadline has passed.';
  end if;

  return new;
end;
$$;
