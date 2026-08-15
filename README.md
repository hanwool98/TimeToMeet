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

## Supabase 적용 순서

1. `supabase/migrations` 안의 SQL을 파일명 순서대로 Supabase SQL Editor에서 실행합니다.
2. Edge Function을 배포합니다.

```bash
supabase functions deploy admin-login
supabase functions deploy application-session-data
supabase functions deploy submit-application
supabase functions deploy admin-application-files
supabase functions deploy cleanup-expired-guest-accounts
```

## 환경변수

프론트엔드에는 publishable key만 사용합니다. 서비스 역할 키와 관리자 코드, 정리 작업 secret은 Supabase Edge Function secret으로만 설정해야 합니다.

필수 프론트 환경변수:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

필수 Edge Function secret:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_LOGIN_CODE_HASH`
- `GUEST_CLEANUP_SECRET`

## 운영 데이터 원칙

행사, 참가 신청, 심사 상태, 인원수, 결제 상태는 Supabase를 단일 기준으로 사용합니다. 날짜 선택 같은 단순 UI 상태를 제외하고 운영 데이터는 `localStorage`나 mock 데이터로 대체하지 않습니다.
