-- 행사가 영구 삭제될 때 applications가 함께 사라지면 그 안에 있던 결제/
-- 입금 관련 기록(참가비 금액, 결제수단, 입금자명, 결제완료 시각 등)도 전부
-- 사라진다. 타임투밋은 실제 참가비가 오가는 서비스라 분쟁/문의 대응이나
-- 법령상 거래기록 보존을 위해 이 정보만은 행사 운영 데이터(참가자 프로필,
-- 사진, 진행 데이터 등)와 분리해 별도로 보존한다.
--
-- 이벤트/신청 원본과의 FK를 일부러 걸지 않는다 - 둘 다 곧 사라질 대상이라
-- FK를 걸면 오히려 이 테이블까지 cascade로 같이 지워지는 사고가 날 수
-- 있다(이 테이블이 존재하는 이유 자체가 "원본이 지워져도 남아있어야
-- 한다"는 것).
-- 컬럼은 결제/환불 증빙에 필요한 최소한으로만 구성한다 - 참가자 프로필
-- 사진/자기소개/키워드/직업/연락처 등 결제 확인과 무관한 개인정보는
-- 여기 포함하지 않고, applications 원본 row를 통째로(JSON 등으로) 복제하지
-- 않는다. refund_policy_confirmed(가입 시점 환불 규정 "동의 여부" 체크박스)
-- 처럼 실제 환불 집행과 무관한 필드도 넣지 않는다 - 환불 여부/시각은
-- status('환불 완료')와 status_updated_at으로 충분히 표현된다(이 앱에는
-- 별도의 "환불 실행 시각" 컬럼이 애초에 없고, 상태 전이 시각만 존재한다).
create table public.event_deleted_payment_records (
  id uuid primary key default gen_random_uuid(),
  -- 행사 식별 최소 정보 - 행사 원본이 지워진 뒤에도 어떤 행사의 거래였는지
  -- 알아볼 수 있어야 하므로(참가자 개인정보 아님).
  event_id text not null,
  event_title text not null,
  event_date date not null,
  -- 거래 식별 정보
  application_id uuid not null unique,
  application_no text not null,
  -- 결제/환불 상태 및 시각 - status가 '환불 완료'면 환불된 거래라는 뜻이고,
  -- status_updated_at이 그 상태로 바뀐(=환불이 반영된) 시각이다.
  status public.application_status not null,
  status_updated_at timestamptz not null,
  -- 금액/결제 수단/결제 완료 시각
  payment_amount integer not null,
  payment_method text,
  payment_completed_at timestamptz,
  -- 계좌이체 대사에 필요한 경우에만: 입금자명
  depositor_name text,
  created_at timestamptz not null default now()
);

create index event_deleted_payment_records_event_id_idx on public.event_deleted_payment_records (event_id);
create index event_deleted_payment_records_created_at_idx on public.event_deleted_payment_records (created_at);

comment on table public.event_deleted_payment_records is '영구 삭제되는 행사의 결제/입금 기록 보존용 스냅샷. 5년 보존 후 purge-expired-deleted-events cron이 자동 삭제한다.';

alter table public.event_deleted_payment_records enable row level security;

-- event_participant_snapshots와 동일한 관례: RLS를 켜고 명시적으로 전부
-- 거부하는 정책을 둔다(service_role은 RLS 자체를 우회하므로 cron/백엔드
-- 작업에는 영향이 없다). 클라이언트(anon/authenticated)는 이 표를 절대
-- 직접 조회할 수 없고, 필요하면 관리자가 Supabase SQL로 직접 조회한다.
create policy "No direct deleted payment record access" on public.event_deleted_payment_records
  for all to public using (false);
