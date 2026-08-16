-- New terminal status for a participant voluntarily canceling their own held
-- (참여 보류) application. Kept distinct from '자동 취소' (system payment-deadline
-- auto-cancel) so admin/participant messaging isn't conflated.
--
-- Adding an enum value must be committed before it can be referenced by name
-- in the same session, so this is a standalone migration; the RPC that uses
-- it lives in the next migration file.
alter type public.application_status add value if not exists '신청 취소';
