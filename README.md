# Malo Backend

캐릭터와 짧은 상황극을 하며 말하기를 연습하는 Malo의 API 서버입니다. **프론트엔드 화면은 포함하지 않습니다.** React Native + Expo에서 HTTPS API를 호출합니다.

- **[배포 Swagger](https://inthon-demo-20261031-dh.koreacentral.cloudapp.azure.com/docs)** · [OpenAPI JSON](https://inthon-demo-20261031-dh.koreacentral.cloudapp.azure.com/openapi.json) · [FE 연결 가이드](docs/FE-QUICKSTART.md)
- Node.js 24.14+ / Next.js API Routes / Hono / Zod OpenAPI
- 배포: Azure Ubuntu VM + Docker Compose + Caddy HTTPS
- 저장: 배포는 Supabase Free PostgreSQL, 로컬은 추가 가입 없이 SQLite

## 구현 범위

| 구간 | API 동작 |
|---|---|
| 시작 | 영속 게스트 생성, 한국어/영어팩, 캐릭터 4명 × 성격 3가지 |
| 학습 | 브리핑, 텍스트/선택지/음성 인식 후 확인, 속마음 힌트, 대화 내역, 일시정지/재개/나가기 |
| 채점 | 기본 Mock, `aiMode: "live"`로 실제 AI 평가. 명확한 실수만 체력 -1 |
| 결과 | 성공/실패, 점수, 잘한 말·아쉬운 말, 재화 1회 지급, 재도전 |
| 복습 | 오답 자동 저장, 상세, 해당 부분만 재연습 |
| 홈/기록 | 이어하기, 설정, 톤 추이, 자주 하는 실수, 출석 팝업 |
| 캐릭터 이미지 | OpenAI GPT Image 2.5 Flare로 생성한 표정별 이미지 URL, 공유 WebP 캐시 |
| 로그인 | 게스트, 모의 회원 전환, 실제 Supabase Google OAuth 토큰 검증·기록 이관 코드 |
| 화면용 | 상점/성격 커스텀/구독 혜택 조회. 실제 결제·구매는 제공하지 않음 |

Google 로그인은 **Google OAuth 클라이언트를 Supabase에 등록한 뒤** 활성화합니다. `/auth/config`가 준비 상태를 알려줍니다. `/auth/demo-upgrade`는 실제 Google 로그인으로 표시하면 안 됩니다. 현재 게스트의 기록을 유지하는 FE 테스트용이며 `isMock=true`입니다.

## 로컬 실행

```sh
npm ci
cp .env.example .env
# MALO_JWT_SECRET을 32자 이상의 임의 값으로 설정
npm run dev
```

`http://localhost:3000/docs`에서 실행합니다. Mock 학습은 AI 서비스·외부 API 키 없이 가능합니다. Live 평가, STT, TTS는 AI 서버 주소와 같은 `MALO_AI_SERVICE_TOKEN`을 설정해야 합니다. OpenAI/Azure의 비밀 키를 앱에 넣지 마세요. Backend에 보관된 OpenAI/Azure 키는 별도 백업이며 실제 AI 호출은 AI 서비스에서 수행합니다.

```sh
npm run typecheck
npm test
npm run spec
npm run build
```

`docs/openapi.json`은 코드의 요청/응답 스키마에서 생성합니다. Swagger의 Authorize에 게스트 생성 응답 `accessToken`을 입력하세요.

## 데이터와 인증

- Guest도 일반 회원과 같은 학습 상태를 저장합니다. 재실행 시 토큰을 Expo SecureStore 등에 보관하고 refresh합니다.
- 실제 Google 로그인은 FE의 Supabase OAuth PKCE → `/auth/google/exchange` 순서입니다. 게스트 Bearer와 검증된 Supabase Google access token이 모두 있어야 게스트 기록을 이관할 수 있습니다.
- 회원 신규 가입/기존 회원 로그인 모두 지원하며 병합은 원자적으로 처리합니다. 병합된 게스트의 토큰은 폐기합니다. 환영 재화는 중복 지급하지 않습니다.
- Access 1시간, Refresh 7일/1회 사용 회전. 로그아웃 시 해당 프로필의 기존 토큰 전체가 무효화됩니다.
- 프로필 JSON snapshot + version CAS는 해커톤의 단일 VM용 단순화입니다. 대규모 서비스 이전에는 대화/오답/토큰 테이블을 분리하세요. 게스트 ID를 잃으면 복구 로그인 수단이 없으므로 회원 전환을 권장합니다.
- Supabase `malo_profiles`는 RLS 활성화, anon/authenticated 권한 없음. 서버 키만 접근합니다. SQL은 [migration](supabase/migrations/20261031_malo_mock.sql)에 있습니다.

## 배포

`/srv/inthon` 아래에 `backend/`, `ai/` 두 소스와 각각의 비공개 `.env`를 배치하고 `deploy/compose.yaml`, `deploy/Caddyfile`을 서버 루트로 복사합니다.

```sh
cd /srv/inthon
sudo docker compose up -d --build
sudo docker compose ps
```

앱은 443만 사용합니다. Backend 3000/AI 8000은 Docker 내부에서만 열립니다. AI API 문서는 `/ai/docs`이며 실제 AI 호출에는 서비스 토큰이 필요합니다. FE에는 서비스 토큰을 배포하지 마세요.

GitHub Secrets는 자동으로 런타임에 주입되지 않습니다. 현재 VM의 `.env`도 따로 배치되어 있습니다. CI는 검사만 수행하며 자동 배포하지 않습니다.

서버는 **2026-11-01 17:00 KST 자동 종료** 예정입니다. 종료 뒤에도 디스크/공인 IP는 남습니다. OpenAI 키는 발급 시 설정한 약 7일 만료 전에 교체해야 합니다.
