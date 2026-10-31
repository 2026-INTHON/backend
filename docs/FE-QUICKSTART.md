# FE 연결 가이드

Base URL: `https://inthon-demo-20261031-dh.koreacentral.cloudapp.azure.com/api/v1`

Swagger는 `/docs`, JSON 명세는 `/openapi.json`입니다. iPhone/갤럭시 Expo Go에서 같은 HTTPS 주소를 사용하므로 같은 Wi-Fi나 로컬 PC 주소가 필요하지 않습니다.

비언어 단서·2단계 힌트·모국어 답변·O△X·재도전 비교·관점 전환·성취도·서브 챕터는 [학습 지원 API 연결 가이드](LEARNING-SUPPORT.md)를 참고하세요.

## 공통 규칙

- 성공: `{ data, meta: { requestId, apiVersion: "v1" } }`
- 실패: `{ error: { code, message, retryable, requestId, details? } }`
- 로그인 이후 `Authorization: Bearer <accessToken>`. `/auth/guest`와 카탈로그는 공개입니다.
- POST로 JSON `{}`를 요구하는 API에도 빈 객체를 보내세요.
- `401`: refresh 시도 → 실패하면 로그인. `409`: 상태 다시 조회. `422`: 입력/음성 확인. `429/502/503`: `retryable`에 따라 재시도.
- 응답의 `session.lives`, `status`, `result`를 기준으로 화면을 갱신합니다. FE가 체력이나 재화를 따로 차감/지급하지 않습니다.
- 답변마다 새 `clientTurnId`(UUID 권장)를 만들고 네트워크 재시도에는 같은 ID와 같은 본문을 사용합니다. 다른 답변에는 새 ID가 필요합니다.

## 1 → 7 데모 순서

| 화면 | 호출 |
|---|---|
| 웰컴 시작 | `POST /auth/guest {}` → 토큰 저장 |
| 팩 선택 | `GET /packs`, `PATCH /settings {"pack":"ko"}` |
| 캐릭터/성격 | `GET /characters` — 각 캐릭터 안에 personalities 3개 |
| 장면 브리핑 | `GET /scenes?pack=ko&characterId=professor&personalityId=strict` |
| 장면 시작 | `POST /sessions {"sceneId":"ko-professor-strict","aiMode":"mock"}` |
| 캐릭터 음성 | `POST /sessions/{id}/speech {}` → `audioUrl` 재생 |
| 속마음 | `POST /sessions/{id}/hint {step:1}` 단서 → `{step:2}` 속마음 |
| 답변 | `POST /sessions/{id}/turns` (아래 예시) |
| 피드백 팝업 | 응답 `turn.feedback`, `oopsMoment`, `session` 사용 |
| 완료/실패 | 응답 `result` 또는 `GET /sessions/{id}/result` |

Mock의 선택지 `a`는 모호한 답, `b`는 좋은 답, `c`는 실수입니다. 자유 입력은 단순 규칙으로 판정하므로 실제 AI 품질 평가에는 `live` 모드를 쓰세요. 배포된 Live 모드는 OpenAI fallback을 사용하고 Lablup 설정 시 우선 Lablup을 호출합니다. Live에도 서버/제공자 오류로 체력이 줄지는 않습니다.

```ts
const BASE = 'https://inthon-demo-20261031-dh.koreacentral.cloudapp.azure.com/api/v1';
const login = await fetch(`${BASE}/auth/guest`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
}).then(r => r.json());
const token = login.data.accessToken;
// accessToken + refreshToken은 SecureStore 등 앱 비공개 저장소에 저장
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const started = await fetch(`${BASE}/sessions`, {
  method: 'POST', headers,
  body: JSON.stringify({ sceneId: 'ko-professor-strict', aiMode: 'mock' }),
}).then(r => r.json());
const sessionId = started.data.id;
const turn = await fetch(`${BASE}/sessions/${sessionId}/turns`, {
  method: 'POST', headers,
  body: JSON.stringify({ clientTurnId: 'demo-turn-1', inputType: 'choice', choiceId: 'b' }),
}).then(r => r.json());
```

텍스트는 `{clientTurnId,inputType:"text",text:"..."}`입니다. 결과의 `goodUtterances`, `improvableUtterances`, `rewardCoins`를 그대로 표시합니다. `POST /sessions/{id}/retry {}`는 새 세션을 반환합니다. 다음 장면은 `result.nextSceneId`로 `/sessions`를 호출합니다.

## 음성 입력

1. Expo에서 녹음한 `m4a` 등을 `multipart/form-data`의 `file`, `pack=ko`로 `POST /speech/transcriptions`에 업로드합니다. **Content-Type을 수동으로 설정하지 말고 boundary를 fetch에 맡기세요.** 지원: wav/mp3/m4a/mp4/webm/ogg, 5MB·0.3~60초.
2. 응답 `{transcriptId,text,editable:true,audioMetrics,expiresAt}`를 인식 완료 화면에 표시합니다. 이 단계에서는 채점하지 않습니다.
3. 사용자가 확인/수정 후 `{clientTurnId,inputType:"voice",transcriptId,text:"확인 또는 수정한 문장"}`을 `/sessions/{id}/turns`로 보냅니다. draft는 30분 유효합니다.
4. `turn.feedback.tone`은 **문장 표현의 공손함**입니다. `speed`는 분당 글자 수(한국어)/단어 수(영어), `hesitation`은 낮은 음량 구간·추임새 추정치입니다. 실제 감정이나 발음 정확도를 뜻하지 않습니다. 수정된 텍스트를 제출해도 음성 측정치는 원래 녹음과 인식 문장을 기준으로 합니다.
5. 텍스트/선택지 입력에는 녹음이 없으므로 `speed`, `hesitation`은 `null`입니다. 해당 막대를 숨기거나 '음성 답변에서 제공'으로 표시하세요.

TTS URL은 10분 유효합니다. 만료되면 `/speech`를 다시 호출합니다. 음성이 실패하면 자막으로 계속 진행할 수 있습니다. 한국어 감정은 표정 에셋과 속도로 표현하며 Azure 음성의 감정 스타일을 보장하지 않습니다.

## 나머지 화면

| 화면 | API |
|---|---|
| 홈/이어하기 | `GET /home`, `POST /sessions/{id}/resume {}` |
| 단축바 | `GET /sessions/{id}/history`, `POST /sessions/{id}/pause {}`, `POST /sessions/{id}/abandon {}` |
| 오답 도감 | `GET /mistakes`, `GET /mistakes/{id}` |
| 부분 재연습 | `POST /mistakes/{id}/practice {clientTurnId,text,aiMode:"mock"}` |
| 내 기록 | `GET /records`, `POST /records/celebrations/{YYYY-MM-DD}/ack {}` |
| 설정 | `GET/PATCH /settings` — pack/voiceSpeed/subtitles/notifications |
| 재화 | `GET /wallet`, `GET /wallet/transactions` |
| 상점/성격/요금제 | `GET /shop`, `/personality-customizations`, `/plans` — previewOnly=true |
| 이미지 | `GET /assets/personas` — assetKey별 OpenAI 생성 이미지의 imageUrl. 미생성/오프라인 항목만 null |

알림 설정은 선호 저장까지만 합니다. Push 발송, 스토어 결제, 아이템 구매, 커스텀 성격 저장은 이번 MVP 범위가 아닙니다. 재화는 가상 값이며 실제 금액과 연결되지 않습니다.

캐릭터 이미지는 `assetKey`(예: `characters/girlfriend/happy`)에 맞는 `imageUrl`을 `expo-image`의 source로 사용하세요. [Expo Image](https://docs.expo.dev/versions/latest/sdk/image/)는 Expo Go에 포함되고 iOS·Android에서 WebP와 디스크 캐시를 지원합니다. 투명 배경 WebP이며 콘텐츠 해시 URL이라 영구 캐시할 수 있습니다. 조회·화면 전환·재접속은 이미지 생성 API를 호출하지 않으므로 생성 비용이 추가되지 않습니다. 카탈로그 조회 시 생성 중이거나 AI 서버가 오프라인이면 null을 받을 수 있으므로 placeholder를 표시하세요. 운영자의 AI 서비스 전용 생성 API 토큰은 FE에 넣지 않습니다.

## 회원 전환

`GET /auth/config`의 `google.enabled`가 false면 Google 버튼은 준비 중으로 표시하거나 숨기세요. Mock 테스트는 게스트 Bearer로 `POST /auth/demo-upgrade {"displayName":"테스터"}`입니다. 토큰을 교체하면 user.id와 기록은 그대로이고 이전 토큰은 폐기됩니다. Google 가입 성공으로 표시하지 마세요.

실제 연동은 Supabase 프로젝트 Google provider에 Google Cloud OAuth client ID/secret과 허용 redirect를 등록한 뒤 `MALO_GOOGLE_ENABLED=true`로 바꿉니다. Expo Go는 사용자 정의 앱 scheme OAuth에 제약이 있으므로 **게스트 학습은 Expo Go로 테스트**, 실제 Google OAuth는 개발 빌드 또는 웹 callback을 포함한 별도 연결 검증이 필요합니다. FE에서 Supabase PKCE 로그인을 끝내면 다음을 호출합니다.

```json
POST /auth/google/exchange
Authorization: Bearer <기존 게스트의 앱 토큰>
{"supabaseAccessToken":"<실제 Google 로그인으로 발급된 Supabase access token>"}
```

서버가 Google identity를 검증한 후 게스트 기록을 새/기존 회원에게 원자적으로 병합합니다. 응답의 새 앱 토큰으로 교체하세요. Supabase server secret, AI service token, OpenAI/Azure key를 FE나 `EXPO_PUBLIC_*`에 넣지 마세요.

설정 참고: [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Expo OAuth 및 Expo Go 제약](https://docs.expo.dev/guides/authentication/).
