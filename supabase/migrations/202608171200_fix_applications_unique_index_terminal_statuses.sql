-- applications_event_user_unique only excluded '반려' from the one-active-
-- application-per-event constraint, mirroring the same incomplete terminal-
-- status list submit-application's duplicate check used to have. This meant
-- that even after the Edge Function's own check was fixed, a real re-
-- application still failed at INSERT time with a unique-constraint violation
-- for any user whose prior application was '자동 취소', '환불 완료', or
-- '신청 취소' (only '반려' was actually re-appliable). Keep this in sync
-- with the same terminal-status set used in submit-application and
-- get_expired_guest_cleanup_targets.
drop index if exists public.applications_event_user_unique;

create unique index applications_event_user_unique
  on public.applications (event_id, user_id)
  where (status not in ('반려', '자동 취소', '환불 완료', '신청 취소'));
