# 캐릭터 페르소나 편집

캐릭터별 단일 원본: `girlfriend.json`(서윤), `professor.json`(윤 교수), `friend.json`(준호), `manager.json`(한 부장).
내용은 팀이 수정할 수 있는 **가상 인물 설정 초안**이다. `profile`은 공통 신상, `personalities.calm/playful/strict.profile`은 선택 유형별 취향·성격·말투다. 유형별 값이 공통 값을 덮어쓴다.

- `age`, `role`, `occupation`, `introduction`, `relationship`: 공통 인물과 관계. 장면의 실제 친밀도가 관계 설명보다 우선한다.
- `traits`, `likes`, `dislikes`, `hobbies`, `values`, `speakingStyle`, `sampleLines`: 카드와 AI에서 함께 쓰는 공개 정보.
- `dialogueRules`: 캐릭터 공통 + 선택 유형의 대사 지침. 공개 카드 API에는 노출하지 않는다.
- `revision`: 내용을 수정할 때 갱신. 기존 캐릭터·유형 ID와 이미지·음성 매핑은 유지한다.

`GET /api/v1/characters`의 `personalities[].profile`은 병합된 공개 프로필을 반환한다. 파일은 배포된 코드의 원본이며 DB에 사본을 중복 저장하지 않는다. DB의 이미지와 기존 카탈로그는 그대로 유지한다.
실시간 `POST /v1/turns/evaluate`의 `persona`와 신규 챕터 생성 `persona`도 같은 파일에서 해결한다. 실시간 경로는 DB 추가 조회 없이 읽는다. 새로운 BE를 배포하기 **전에** optional `persona`를 지원하는 AI를 먼저 배포한다.

취향 불일치와 정중한 거절은 오답이 아니다. O/△/X/? 학습 기준·안전 규칙은 별도 AI 정책에 그대로 유지된다.
기존 DB 고정 대본은 자동으로 다시 쓰지 않는다. 수정용 대본의 sceneId/nodeId/route를 유지해 별도 반영해야 한다. 이 변경은 새 실시간 답변과 새로 생성하는 챕터부터 적용된다.
