# 학습 단서·재도전 API

Base: `https://inthon-demo-20261031-dh.koreacentral.cloudapp.azure.com/api/v1`

기존 대사 → 답변 → O·△·X → 피드백 흐름을 유지한다. 성공 응답은 항상 `{data, meta}`이며, 아래 필드는 모두 `data` 안에 있다. 별도의 답변 전 추론 단계는 추가하지 않는다.

| 기능 | API와 필드 |
| --- | --- |
| 비언어 칩 | 세션 시작·조회·턴 응답의 `session.npc.cues: [{k,v}]`. k는 표정·억양·망설임·침묵. `npc.action`은 지문이다. |
| 답변 직후 캐릭터 반응 | `turn.npcReply`, `turn.action`, `turn.cues`. 다음 질문의 `session.npc`와 구분한다. |
| 1단계 힌트 | `POST /sessions/{id}/hint {"step":1}` → `clue: [{k,v}]` (주목 표현·행동·상황 단서). `hiddenThought`와 `tip`은 null이다. |
| 2단계 힌트 | 같은 API에 `{"step":2}` → `hiddenThought`, `tip`을 추가 공개한다. |
| 모국어 답변 | 기존 턴 API에 그대로 제출. `turn.native=true`, `outcome="clarify"`, `mark="△"`, `lifeDelta=0`. 노드는 유지하고 `feedback.betterExpression`을 안내한다. |
| O·△·X | `turn.mark`와 `turn.outcome`의 대응은 O=correct, △=clarify, X=misunderstanding. X만 체력 -1이다. 낮은 확신의 misunderstanding은 서버가 △로 바꾼다. |
| 정정하기 | 같은 세션에 새 답변·새 `clientTurnId`로 턴 API를 다시 호출한다. 네트워크 재전송은 기존 ID와 본문을 그대로 쓴다. |
| 처음 답과 비교 | `turn.nodeId`, `attempt`, `comparison: {firstAnswer,currentAnswer,improved}`. 첫 시도는 comparison=null, 재시도 후 O이면 improved=true다. |
| 관점 전환 | `turn.feedback.views: [{who,meaning,cue}]`. 피드백의 “다른 사람이 이 말을 하면?” 버튼을 누를 때만 펼친다. 별도 AI 호출은 없다. |
| 성취도 3개 | 결과 응답 `achievement: {reach,infer,self}`. 각 0~100 정수다. |
| 챕터·서브 챕터 | `GET /chapters?pack=ko&characterId=manager` → 캐릭터별 챕터, 현재 제공되는 성격별 장면을 서브 챕터로 묶는다. 각 `subs[].sceneId`로 세션을 시작한다. |

비언어 단서와 속마음은 가상 캐릭터 대본이다. 사용자의 표정·음성 감정을 측정한 결과가 아니다. 힌트는 저장된 대본을 조회하므로 추가 LLM 호출이 없다. 같은 노드·같은 단계의 힌트를 반복 조회해도 `hintsUsed`와 점수를 중복 차감하지 않는다. 일시정지·종료 세션이나 턴 처리 중에는 409를 반환한다. 예전 클라이언트의 빈 본문 `{}`는 기존 동작을 유지하기 위해 step=2다. 새 FE는 step을 명시한다.

## FE 연결 시 확인할 부분

현재 `frontend`의 `feat/learning-flow`를 기준으로 한다. 화면을 다시 만들 필요 없이 API 어댑터와 데이터 연결을 바꾸면 된다.

1. `src/lib/api.ts`의 `call<T>`는 성공 JSON 전체 대신 `json.data`를 반환해야 한다. 현재 코드는 공통 envelope를 그대로 반환해 `guest().accessToken`과 장면 목록을 제대로 읽지 못하고 데모 대본으로 넘어갈 수 있다. JSON POST에는 `{}` 또는 해당 본문을 보낸다.
2. `hint(id, step)`이 `JSON.stringify({step})`을 전송하게 바꾼다. `engine.hint`는 `clue`, `hiddenThought ?? ''`, `tip ?? ''`를 화면 데이터로 연결한다. `revealThought()`도 **2단계 API의 반환값으로 `setHint(...)`** 해야 한다. 1단계 응답에 속마음을 미리 넣어 두지 않는다.
3. 엔진의 `line`과 다음 `pendingLine`은 `{line: npc.text, action: npc.action, cues: npc.cues}` 전체를 유지한다. 답변 직후에는 turn의 반응 데이터를 사용한다.
4. `Out.views`는 `turn.feedback.views`, `Out.native`는 `turn.native`, `Out.mark`는 `turn.mark`를 사용한다. 재도전 성공의 `Out.first`는 `turn.comparison?.improved ? turn.comparison.firstAnswer : undefined`다. 성공 응답이 오면 서버 `session.lives/status`를 따른다.
5. 결과 화면의 세 지표는 `result.achievement`를 사용한다. FE에서 힌트를 열 때마다 별도로 차감한 값을 서버 결과와 섞지 않는다. 기존 저장 결과는 achievement=null일 수 있으며 이때 “평가 기록 없음”을 표시한다.
6. FE 성격 ID `picky/tease/calm`을 BE `strict/playful/calm`으로 매핑한다. 챕터는 API의 완료·이어하기 상태를 사용한다. MVP의 서브 챕터는 실제로 준비된 장면만 반환하고 모두 잠금 해제 상태다. 향후 유료 챕터나 다른 에피소드의 대본이 생기면 카탈로그를 추가한다.

카드 섞기 애니메이션과 첫 화면 크기 조정은 FE 화면 작업이며 API 추가는 필요 없다. 관점 전환은 버튼으로만 열고, 단서·힌트 때문에 답변 전에 새 화면을 추가하지 않는다.

## 모의/실제 AI와 성취도 기준

- `aiMode="mock"`: 가벼운 규칙 판정과 준비된 장면 예문을 준다. 모국어 문장을 정확히 번역했다고 표시하지 않는다.
- `aiMode="live"`: 기존 Lablup → OpenAI 대체 흐름의 **한 번의 평가 요청**에서 모국어 여부·학습 언어 표현·캐릭터 반응·관점 전환을 함께 생성한다. 뜻이 같은 다양한 답변을 허용하도록 프롬프트에 명시했다. 혼합 언어도 모델이 판단한다. 명백한 비학습 언어 답변은 BE에서 다시 보호한다.
- `reach`: 성공한 노드 수 / 전체 노드 수 × 100.
- `infer`: 100 - 노드별 1단계 공개 15점 - 2단계 공개 25점, 최소 30점. 기존 힌트 이력은 2단계로 계산한다.
- `self`: 100 - 모국어 도움을 받은 답변 25점 - 명확한 말실수 15점, 최소 30점.

세 숫자는 이 MVP의 연습 지표다. 기존 총점·보상 계산은 유지한다.

## 검증

- BE: `npm run typecheck`, `npm test`, `npm run spec`, `npm run build`
- AI: `.venv/Scripts/python.exe -m unittest discover -s tests -v`, `python scripts/export_openapi.py`
- 핵심 회귀: 1단계 속마음 비공개, 힌트 재조회 중복 차감 없음, 모국어/애매한 답 체력 유지, X→O 첫 답 비교, 중복 턴 재전송, 계정별 격리, 레거시 대본 호환, 챕터 완료 상태, 결과 지표.
