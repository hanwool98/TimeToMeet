-- The previous migration's create_event_pause_request(text,text,integer,text)
-- was registered as a NEW overload rather than replacing the old
-- create_event_pause_request(text,text,integer) - Postgres doesn't unify
-- signatures that differ only by a trailing defaulted parameter. Having
-- both live makes PostgREST's function resolution ambiguous for any 3-arg
-- call. Drop the old one explicitly.
drop function if exists public.create_event_pause_request(text, text, integer);
