# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 따라야 하는 프로젝트 설명 및 작업 지침이다.

---

# 1. 프로젝트 개요

**TimeToMeet(타임투밋)**은 오프라인 로테이션 소개팅 행사의 모집부터 실제 행사 운영까지 관리하기 위한 **모바일 우선 웹앱**이다.

단순한 소개팅 신청 페이지가 아니라 다음 전체 과정을 하나의 서비스에서 처리하는 것이 목표다.

**행사 탐색 → 참가 신청 → 프로필 심사 → 결제 → 참가 확정 → QR 티켓 → 체크인 → 오프라인 행사 진행**

기술 구성:

* React SPA
* TypeScript
* Vite
* Tailwind CSS
* React Router
* Supabase

  * PostgreSQL
  * RLS
  * RPC
  * Edge Functions
  * Storage
  * Realtime
* Vercel 배포

서비스와 UI의 기본 언어는 **한국어**다.

---

# 2. TimeToMeet 서비스의 핵심 구조

TimeToMeet은 크게 다음 두 영역으로 구성된다.

## 참가자 영역

참가자가 행사를 찾고 신청하고 실제 행사에 참여하기 위한 기능이다.

주요 흐름:

1. 행사 목록 / 캘린더
2. 행사 상세
3. 로그인 또는 비회원으로 계속하기
4. 참가 프로필 작성
5. 참가 신청 제출
6. 운영자 프로필 심사
7. 승인된 참가자에게 결제 안내
8. 결제
9. 참가 확정
10. QR 티켓 발급
11. 행사장 체크인
12. 행사 참여

## 관리자/운영자 영역

운영자가 행사 모집부터 현장 진행까지 관리한다.

주요 기능:

* 행사 생성 / 수정 / 삭제
* 참가 신청 관리
* 프로필 심사
* 승인 / 대기 / 거절
* 결제 및 환불 상태 관리
* 참가자 관리
* QR 체크인
* 행사모드
* 테이블 및 태블릿 관리
* 실제 로테이션 진행

관리자 화면은 참가자용 하단 네비게이션을 사용하지 않는다.

---

# 3. 참가 신청 상태 흐름

참가 신청의 상태 흐름은 서비스의 핵심 비즈니스 로직이므로 임의로 단순화하거나 변경하지 않는다.

기본 흐름:

`참가 신청`
→ `심사`
→ `승인 / 대기 / 거절`

승인된 경우:

`승인`
→ `결제대기`
→ `결제중`
→ `결제완료`
→ `참가확정`

결제 기한 내 결제가 이루어지지 않으면 자동 취소될 수 있다.

향후 카드 및 간편결제가 추가될 수 있지만 현재 초기 운영에서는 **계좌이체 중심의 결제 흐름**을 사용한다.

---

# 4. 비회원 로그인

현재 테스트 및 초기 운영에서 비회원 참가 기능이 중요하다.

비회원은:

* 전화번호
* 사용자가 직접 설정한 6자리 PIN

을 이용한다.

비회원 계정도 서버에서 발급된 session token을 이용해 인증한다.

단순히 전화번호만 알고 있다고 다른 사람의 신청 정보에 접근할 수 있어서는 안 된다.

비회원의 신청서, draft, 업로드 파일 등 개인정보에 접근하는 모든 서버 기능은 반드시 **session token과 데이터 소유권을 검증**해야 한다.

---

# 5. 프로필 및 참가 신청

참가자는 행사 신청 과정에서 프로필을 작성한다.

프로필에는 향후 다음과 같은 데이터가 포함될 수 있다.

* 기본 개인정보
* 닉네임
* 사진
* 음성
* 직업 관련 정보
* 신분 확인 자료
* 재직 확인 자료
* 행사 신청 관련 답변

운영자는 제출된 프로필을 확인한 뒤:

* 참가 승인
* 참가 대기
* 참가 거절

중 하나를 선택할 수 있다.

대기 또는 거절 시 사유를 저장할 수 있다.

샘플 이미지, 샘플 음성, mock 신청 데이터가 실제 운영 데이터 대신 표시되어서는 안 된다.

---

# 6. 결제 및 초대장

참가 승인을 받은 사용자는 결제 단계로 이동한다.

현재 초기 운영에서는 계좌이체를 기본으로 한다.

결제대기 상태에서는 참가자에게 초대장/결제 안내 UI가 표시된다.

사용자가 결제 안내를 확인하면 운영자 화면에서 `결제중` 상태로 구분할 수 있다.

실제 입금 확인 후 참가가 확정된다.

결제 관련 데이터는 Supabase를 기준으로 관리하며 `localStorage`나 mock 데이터로 대체하지 않는다.

---

# 7. 참가 확정 및 QR 티켓

참가가 확정되면 사용자에게 행사 티켓이 제공된다.

티켓은 비행기 티켓 스타일의 UI를 기본 디자인 방향으로 사용한다.

티켓에는 다음과 같은 정보가 포함될 수 있다.

* 행사명
* 날짜
* 시간
* 참가자 정보
* QR 코드
* D-Day

티켓을 열면:

* QR 코드 확대
* 정확한 행사 장소
* 지도 연결
* 참가자 미리보기
* 행사 입장 기능

등을 제공한다.

QR 코드는 단순 장식 이미지가 아니라 실제 체크인 인증과 연결되어야 한다.

---

# 8. 행사모드

TimeToMeet의 중요한 기능 중 하나는 **실제 오프라인 로테이션 소개팅을 앱으로 운영하는 행사모드**다.

행사는 일반적으로 남녀 참가자가 여러 테이블에서 일정 시간마다 상대를 바꾸는 방식으로 진행된다.

운영 환경에서는:

* 운영자 스마트폰
* 테이블별 태블릿

을 사용할 수 있다.

테이블 번호와 태블릿 번호는 동일하게 사용하는 것을 기본으로 한다.

예:

* 태블릿 1 → 테이블 1
* 태블릿 2 → 테이블 2
* ...
* 태블릿 10 → 테이블 10

운영자는 참가자 리스트에서 남성/여성 참가자를 각 테이블에 배정할 수 있다.

행사 진행 중 운영자 화면에서는 향후 다음 기능을 사용할 수 있다.

* 행사 시작
* 현재 라운드
* 타이머
* 다음 라운드
* 참가자 이동
* 공지

행사모드는 일반 참가자 화면과 별도의 운영 UI로 취급한다.

---

# 9. 기본 명령어

```bash
npm install
npm run dev
npm run build
npm run preview
```

`npm run build`는:

```bash
tsc -b && vite build
```

를 실행한다.

변경사항을 배포 가능한 상태라고 판단하기 전에 가능하면 항상 빌드를 확인한다.

현재 `package.json`에는 별도의 테스트 스위트와 lint script가 구성되어 있지 않다.

---

# 10. Supabase

요청받은 기능을 구현하거나 오류를 해결하는 데 필요한 경우 Claude Code는 다음을 포함한 Supabase 관련 작업을 직접 수행할 수 있다.

* migration 작성 및 적용
* `supabase db push`
* Edge Function 생성 및 수정
* `supabase functions deploy`
* 필요한 RPC / RLS / DB schema 수정
* 필요한 Supabase 설정 확인 및 적용

단, 다음 원칙을 따른다.

* 현재 요청과 관계없는 Supabase 구성은 임의로 변경하지 않는다.
* 기존 데이터가 삭제되거나 손상될 가능성이 있는 destructive operation은 실행 전에 사용자에게 알리고 확인을 받는다.
* 기존 migration을 임의로 수정하기보다 새로운 migration을 추가하는 방식을 우선한다.
* production 데이터 삭제, 대량 변경, table 삭제, column 삭제 등 복구하기 어려운 작업은 사용자 확인 없이 실행하지 않는다.
* 새로운 Edge Function, table, RPC, RLS policy 등을 만들기 전에 동일한 목적의 기존 구현이 있는지 먼저 확인한다.
* Edge Function을 배포하기 전에 해당 함수의 `supabase/functions/<function-name>/index.ts`가 실제로 존재하는지 확인한다.
* Supabase 작업 후 무엇을 변경하고 적용했는지 결과를 사용자에게 명확하게 보고한다.

---

# 11. Edge Functions

Edge Function은 다음 위치에 존재한다.

```text
supabase/functions/<function-name>/index.ts
```

개별 배포:

```bash
supabase functions deploy <function-name>
```

README나 프론트엔드 코드에서 Edge Function 이름이 등장한다고 해서 실제 함수가 존재한다고 가정하지 않는다.

반드시:

```text
supabase/functions/
```

에서 해당 폴더와 `index.ts`가 실제로 존재하는지 확인한다.

과거 README 및 프론트엔드 코드에서는 다음 함수들을 참조했지만 실제 로컬 저장소에는 존재하지 않는 문제가 있었다.

* `application-session-data`
* `admin-application-files`
* `my-profile-photo`
* `my-session-phone`

이로 인해 다음과 같은 배포 오류가 발생한 적이 있다.

```text
Entrypoint path does not exist
```

따라서 Edge Function 관련 작업에서는 **문서보다 실제 저장소 상태를 우선 확인한다.**

---

# 12. 환경변수

프론트엔드 환경변수:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

`.env.local`에서 관리하며 `.env.example`을 참고한다.

프론트엔드에서는 publishable key만 사용한다.

다음 값들은 Edge Function secret이며 절대로 프론트엔드에 노출하지 않는다.

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_LOGIN_CODE_HASH
GUEST_CLEANUP_SECRET
```

관리자 로그인 코드는 plaintext로 저장하지 않는다.

SHA-256 hash 형태로 저장한다.

예:

```bash
shasum -a 256
```

생성된 hash를:

```text
ADMIN_LOGIN_CODE_HASH
```

로 설정한다.

---

# 13. 인증 구조

이 프로젝트는 현재 Supabase Auth를 직접 사용하는 구조가 아니라 **custom session-token 기반 인증 구조**를 사용한다.

관리자와 일반 앱 사용자는 서로 다른 session store를 사용한다.

## 관리자 세션

파일:

```text
src/services/adminAuth.ts
```

저장 위치:

```text
sessionStorage
```

key:

```text
time2meet.adminSession
```

`admin-login` Edge Function에서 세션을 발급한다.

`is_admin_session` RPC를 통해 유효성을 확인한다.

## 앱 세션

파일:

```text
src/services/appAuth.ts
```

저장 위치:

```text
localStorage
```

key:

```text
time2meet.appSession
```

role:

```text
member
guest
admin
```

세션은 다음 RPC 등을 통해 발급된다.

```text
create_guest_session
login_guest_session
login_member_session
```

이 RPC들은:

```typescript
supabase.rpc(...)
```

방식으로 직접 호출한다.

현재 로그인 과정 자체에는 Edge Function을 사용하지 않는다.

세션 변경 시:

```text
time2meet:app-session-changed
```

window event를 발생시켜 컴포넌트 간 상태를 동기화한다.

---

# 14. Edge Function 인증

Edge Function에서 앱 사용자를 인증할 때 Supabase Auth의 로그인 상태를 전제로 하지 않는다.

현재 구조에서는 클라이언트가 발급받은:

```text
sessionToken
```

을 Edge Function request body에 명시적으로 전달한다.

예시는:

```text
src/services/supabaseApplications.ts
```

를 참고한다.

Edge Function에서는 session token의 유효성과 요청 데이터의 소유권을 서버 측에서 반드시 검증한다.

클라이언트가 전달한 user ID, application ID 등의 값을 그대로 신뢰해서는 안 된다.

---

# 15. 데이터 로딩

주요 shared hook:

```text
src/hooks/useOperationalData.ts
```

이 hook은 주요 페이지에서:

* events
* participants
* applications

등의 운영 데이터를 가져온다.

데이터는 병렬로 조회되며 기본적으로 약 30초 간격으로 다시 조회한다.

Supabase Realtime 변경도:

```text
subscribeToSupabaseChanges
```

를 통해 감지한다.

`admin`, `eventId` 옵션에 따라 추가 데이터를 가져올 수 있다.

---

# 16. 운영 데이터 원칙

TimeToMeet에서 다음 정보는 **Supabase가 단일 source of truth**다.

* 행사
* 참가 신청
* 심사 상태
* 참가 인원
* 결제 상태
* 참가 확정 상태
* 운영 관련 데이터

이 데이터를 임의로:

* mock 데이터
* hardcoded 데이터
* localStorage

등으로 대체하지 않는다.

`localStorage`는 선택된 날짜 같은 단순 UI 상태나 명시적으로 허용된 로컬 상태에만 사용할 수 있다.

Supabase 조회 실패를 숨기기 위해 mock 데이터를 표시하지 않는다.

---

# 17. Edge Function과 RPC 사용 원칙

다음처럼 service-role 권한이나 서버 secret 검증이 필요한 작업은 Edge Function을 우선 사용한다.

예:

* 관리자 로그인
* 참가 신청 제출
* 행사 삭제
* guest account cleanup
* 다른 privileged operation

세션 발급이나 비교적 단순한 DB 작업은 현재 구조에 맞는 RPC를 사용할 수 있다.

새로운 privileged operation을 구현할 때는 기존:

```text
supabase/functions/
```

패턴을 우선 참고한다.

보안을 약화시키기 위해 privileged DB 작업을 프론트엔드 RPC 호출로 옮기지 않는다.

---

# 18. Guest 데이터 lifecycle

`cleanup-expired-guest-accounts`는 Edge Function이다.

단순 DB cron만으로 개인정보를 삭제하지 않는다.

삭제 과정에서는 먼저 Storage 파일을 삭제하고 이후 DB의 개인정보를 비식별화한다.

이는 Storage에 개인정보 파일이 orphan 상태로 남는 것을 방지하기 위함이다.

이 함수는:

```text
x-cleanup-secret
```

header를 요구한다.

값은:

```text
GUEST_CLEANUP_SECRET
```

과 일치해야 한다.

Production에서는 외부 scheduler 또는 Supabase Cron 등을 통해 호출될 수 있다.

---

# 19. 스타일링

Tailwind CSS를 사용한다.

프로젝트에는 `meet` custom color palette가 존재한다.

새로운 임의 색상을 추가하기 전에 기존:

```text
meet.*
```

token을 우선 사용한다.

기본 font stack은 Pretendard를 우선한다.

기존 TimeToMeet의 디자인 톤을 유지하고, 요청받지 않은 전체 UI 재설계를 하지 않는다.

모바일 환경을 우선으로 디자인한다.

---

# 20. 작업 규칙

Claude Code는 아래 규칙을 반드시 따른다.

### 작업 범위

* 사용자가 요청한 문제를 해결하는 데 필요한 **최소한의 범위만 수정한다.**
* 요청하지 않은 기능을 임의로 추가하지 않는다.
* 관계없는 파일을 리팩터링하지 않는다.
* 기존에 정상적으로 동작하는 기능을 불필요하게 변경하지 않는다.

### Supabase

사용자가 명시적으로 요청하지 않는 한 다음 작업을 실행하지 않는다.

```text
supabase db push
supabase functions deploy
```

또한 운영 Supabase 데이터나 production 환경을 임의로 변경하지 않는다.

필요한 경우 실행해야 할 명령어를 사용자에게 알려주고 사용자가 직접 실행할 수 있도록 한다.

### Git

사용자가 명시적으로 요청하지 않는 한:

```text
git commit
git push
git reset
```

또는 git history를 변경하는 작업을 실행하지 않는다.

### 새로운 서버 구성요소

새로운:

* Edge Function
* migration
* table
* RPC
* environment variable
* secret

을 만들기 전에 같은 목적을 수행하는 기존 구현이 있는지 먼저 확인한다.

새로운 migration이나 아키텍처 변경이 필요하지만 사용자가 해당 범위까지 요청하지 않았다면 먼저 필요한 이유를 설명한다.

### 보안

다음 값을 프론트엔드에 노출하지 않는다.

* `SUPABASE_SERVICE_ROLE_KEY`
* 관리자 secret
* cleanup secret
* session token
* 기타 privileged credential

클라이언트 입력만으로 사용자 권한이나 데이터 소유권을 판단하지 않는다.

### Mock 데이터

운영 데이터가 없거나 Supabase 조회에 실패했다고 해서 mock 데이터를 fallback으로 사용하지 않는다.

오류가 있다면 오류의 원인을 해결한다.

### 오류 수정

오류가 발생하면 먼저:

1. 오류의 root cause를 확인한다.
2. 영향을 받는 파일을 확인한다.
3. 기존 구현과 데이터 흐름을 확인한다.
4. 필요한 최소 범위를 수정한다.

원인을 파악하지 않은 상태에서 여러 파일을 광범위하게 변경하지 않는다.

### 검증

코드를 변경한 후 가능하면:

```bash
npm run build
```

를 실행한다.

빌드 오류가 있다면 사용자에게 정확히 보고한다.

빌드 성공은 배포 허가를 의미하지 않는다.

자동으로 production에 배포하지 않는다.

---

# 21. 가장 중요한 원칙

TimeToMeet은 실제 참가자의 개인정보, 신청 상태, 결제 상태 및 오프라인 행사 운영 데이터를 다루는 서비스다.

따라서 **"화면이 일단 동작하는 것"보다 실제 데이터의 정확성, 인증, 권한 검증, 운영 안정성을 우선한다.**

기존 기능을 수정할 때는 항상:

**UI → service → Edge Function/RPC → Database**

전체 데이터 흐름을 고려한다.

문제가 발생했을 때 임시 mock이나 hardcoding으로 우회하지 말고 실제 원인을 해결한다.

사용자가 요청하지 않은 범위까지 임의로 확장하지 않는다.
