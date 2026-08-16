# TimeToMeet

모바일 우선 로테이션 소개팅 운영 웹앱입니다.

## 로컬 실행

1. `.env.example`을 참고해 `.env.local`을 만듭니다.
2. Supabase URL과 publishable key를 설정합니다.
3. 의존성을 설치하고 개발 서버를 실행합니다.

```bash
npm install
npm run dev
```

배포 전에는 반드시 빌드도 확인합니다.

```bash
npm run build
```

## Supabase migration

`supabase/migrations` 안의 SQL을 파일명 순서대로 적용합니다. 이미 000~080이 적용된 운영 프로젝트라면 이번 패치에서는 `202608150090_prelaunch_hardening.sql`만 추가 적용하면 됩니다.

Supabase CLI를 연결해 둔 경우:

```bash
supabase db push
```

SQL Editor를 사용하는 경우에는 아직 적용하지 않은 migration만 순서대로 실행합니다.

> 루트와 `supabase/`에 남아 있는 `add-*.sql`, `fix-*.sql`, `update-*.sql`, `supabase-schema.sql`은 과거 패치/참고 파일입니다. 신규 적용 기준은 `supabase/migrations`입니다.

## Edge Function 배포

현재 앱에서 사용하는 Edge Function은 아래와 같습니다.

```bash
supabase functions deploy admin-login
supabase functions deploy admin-delete-event
supabase functions deploy admin-application-files
supabase functions deploy application-session-data
supabase functions deploy cleanup-expired-guest-accounts
supabase functions deploy my-profile-photo
supabase functions deploy my-session-phone
supabase functions deploy submit-application
```

이번 패치에서 코드가 바뀐 Function은 다음 네 개입니다.

```bash
supabase functions deploy admin-login
supabase functions deploy admin-delete-event
supabase functions deploy cleanup-expired-guest-accounts
supabase functions deploy submit-application
```

## 환경변수

프론트엔드에는 publishable key만 사용합니다. 서비스 역할 키, 관리자 로그인 해시, cleanup secret은 Supabase Edge Function secret으로만 설정합니다.

프론트 환경변수:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Edge Function secret:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_LOGIN_CODE_HASH`
- `GUEST_CLEANUP_SECRET`

관리자 코드는 원문을 secret에 넣지 않습니다. macOS에서 원하는 관리자 코드를 SHA-256으로 만든 뒤 결과 64자리 문자열을 secret으로 등록합니다.

```bash
printf '%s' '여기에_관리자코드' | shasum -a 256
supabase secrets set ADMIN_LOGIN_CODE_HASH=위에서_나온_64자리_해시
```

기존 `ADMIN_ACCESS_CODE`를 사용 중이었다면 새 Function 배포 전에 `ADMIN_LOGIN_CODE_HASH`를 먼저 설정해야 관리자 로그인이 끊기지 않습니다.

cleanup secret은 충분히 긴 임의 문자열로 설정합니다.

```bash
supabase secrets set GUEST_CLEANUP_SECRET='충분히_긴_임의문자열'
```

## 게스트 개인정보 cleanup

기존 DB-only `cleanup-expired-guest-accounts` cron은 새 migration에서 중지됩니다. DB 경로만 지우고 Storage 파일이 남는 상황을 방지하기 위해 이제 `cleanup-expired-guest-accounts` Edge Function이 Storage 파일 삭제 후 DB 개인정보를 비식별 처리합니다.

운영에서는 이 Edge Function을 정기적으로 호출하도록 Supabase Cron/외부 스케줄러를 연결해야 합니다. 호출할 때 `x-cleanup-secret` 헤더에 `GUEST_CLEANUP_SECRET`과 동일한 값을 전달합니다.

## 이번 패치에서 추가된 운영 보호

- 행사 신청 마감시간을 DB에 저장하고 서버/DB 양쪽에서 마감 후 신청 차단
- 상세 행사 장소를 DB에 저장하고 참가 확정 사용자 티켓에만 노출
- 남/여 모집 인원을 각각 정확히 저장
- 관리자 로그인 코드를 원문이 아닌 SHA-256 hash로 검증
- 세션 발급/게스트 로그인 내부 helper RPC 외부 실행 권한 회수
- 개인정보 cleanup 시 Storage 실제 파일 삭제 후 DB 비식별 처리
- 행사 삭제 시 신청 Storage 파일도 함께 삭제
- 신청 파일 MIME + 실제 파일 시그니처 검증
- 비회원 로그인 전화번호와 신청서 전화번호 일치 검증
- `participant_profiles`와 마이페이지 관련 RPC를 정식 migration에 포함
- Vercel SPA 새로고침 rewrite 추가

## 운영 데이터 원칙

행사, 참가 신청, 심사 상태, 인원수, 결제 상태는 Supabase를 단일 기준으로 사용합니다. 날짜 선택 같은 단순 UI 상태를 제외하고 운영 데이터는 `localStorage`나 mock 데이터로 대체하지 않습니다.
