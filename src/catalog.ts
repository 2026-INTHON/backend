import type { SceneValue } from './contracts';

export type SceneNode = { id: string; npcText: string; goal: string; goodExample: string; hiddenThought: string; tip: string; choices: { id: string; text: string }[]; nextNodeId: string | null };
export type Scenario = { title: string; situation: string; goal: string; pack: 'ko' | 'en'; characterId: string; personalityId: string; nodes: SceneNode[] };
export const packs = [{ id: 'ko', name: '한국어팩', description: '상황과 관계에 맞는 말투를 연습해요.' }, { id: 'en', name: '영어팩', description: '짧은 상황극으로 영어 회화 감각을 길러요.' }];
const personalities = [
  { id: 'strict', name: '까탈', description: '작은 표현도 놓치지 않아요. 구체적이고 배려하는 말이 필요해요.' },
  { id: 'playful', name: '장난', description: '농담을 즐겨요. 가볍게 받아치면서도 진심을 전해보세요.' },
  { id: 'calm', name: '차분', description: '천천히 이야기를 들어줘요. 생각을 차근차근 풀어보세요.' },
];
export const characters = [
  { id: 'girlfriend', name: '서윤', role: '여자친구', description: '가까운 사이에서 마음을 표현하는 연습', emoji: '💛' },
  { id: 'friend', name: '민준', role: '친구', description: '약속과 부탁을 편하게 조율하는 연습', emoji: '🧢' },
  { id: 'manager', name: '한 부장', role: '부장님', description: '회사에서 명확하고 정중하게 말하는 연습', emoji: '☕' },
  { id: 'professor', name: '김 교수', role: '교수님', description: '요청의 이유와 계획을 설명하는 연습', emoji: '📚' },
].map(character => ({ ...character, assetKey: `characters/${character.id}/neutral`, personalities: personalities.map(p => ({ ...p, assetKey: `personalities/${p.id}` })) }));

type Lines = [string, string, string, string, string, string, string];
const scripts: Record<string, { title: string; situation: string; goal: string; ko: Lines[]; en: Lines[] }> = {
  professor: { title: '과제 기한 조정하기', situation: '과제 제출 기한을 하루 연장하고 싶어 교수님과 상담합니다.', goal: '사유와 구체적인 새 기한을 정중하게 제안하기',
    ko: [
      ['과제 제출이 늦어진다면서요. 언제까지 가능하죠?', '사유와 새 기한 제안', '교수님, 죄송합니다. 자료 정리가 늦어져서 내일 오후 5시까지 제출해도 될까요?', '몰라요. 제가 알아서 할게요.', '네.', '늦어진다는 사실보다 언제 받을 수 있는지가 궁금하다.', '사과에 구체적인 시간과 계획을 덧붙여보세요.'],
      ['내일 5시면 검토 시간이 부족한데요. 초안을 먼저 볼 수 있을까요?', '중간 확인 계획 제안', '오늘 저녁 8시까지 초안을 먼저 보내드리고, 내일 오후 5시에 최종본을 제출하겠습니다.', '그냥 기다리세요.', '아마도요.', '검토할 시간을 확보하고 싶다.', '초안과 최종본의 시간을 나누어 말해보세요.'],
      ['좋습니다. 약속한 일정은 지켜주세요.', '합의 내용 확인과 감사', '감사합니다, 교수님. 오늘 8시 초안, 내일 오후 5시 최종본으로 진행하겠습니다.', '알아서 한다니까요.', '음.', '약속을 제대로 이해했는지 확인하고 싶다.', '정해진 일정을 한 번 더 확인해보세요.'],
    ], en: [
      ['You said your assignment will be late. When can you submit it?', 'Propose a clear new deadline', 'I am sorry, Professor. Could I submit it by 5 p.m. tomorrow?', 'Whatever. I will do it when I want.', 'Yes.', 'I need a specific deadline, not just an apology.', 'Give a specific time and make a polite request.'],
      ['Could you send me a draft before then?', 'Offer an intermediate plan', 'I can send a draft by 8 p.m. today and the final version by 5 p.m. tomorrow.', 'Just wait for it.', 'Maybe.', 'I want time to review the work.', 'Separate the draft deadline from the final deadline.'],
      ['That works. Please stick to the schedule.', 'Confirm and thank', 'Thank you. I will send the draft tonight and the final version tomorrow at 5 p.m.', 'I said I would handle it.', 'OK.', 'I want to know we agree on the plan.', 'Confirm the plan in your own words.'],
    ] },
  manager: { title: '마감 일정 협상하기', situation: '예상보다 오래 걸리는 업무의 마감 일정을 부장님과 조율합니다.', goal: '문제와 해결 계획을 함께 설명하기',
    ko: [
      ['지금 업무가 어디까지 진행됐죠?', '현재 상황을 구체적으로 설명', '자료 수집은 마쳤고 정리 작업이 남았습니다. 예상보다 검토가 오래 걸리고 있습니다.', '몰라요. 제가 알아서 하죠.', '그냥요.', '막연한 설명보다 실제 진행 상태를 알고 싶다.', '완료한 일과 남은 일을 나누어 설명해보세요.'],
      ['그래서, 언제 끝낼 수 있나요?', '구체적인 기한과 대안 제안', '내일 오후 5시까지 마무리하겠습니다. 오늘 6시에 중간 결과를 먼저 공유드려도 될까요?', '그냥 기다리세요.', '아마 곧요.', '약속할 수 있는 마감 시간이 필요하다.', '시간을 특정하고 중간 결과를 제안해보세요.'],
      ['좋아요. 일정이 바뀌면 미리 공유해주세요.', '합의 내용 재확인', '네, 오늘 중간 결과를 공유하고 내일 5시까지 마무리하겠습니다. 변동이 있으면 바로 말씀드리겠습니다.', '알아서 한다니까요.', '네.', '진행 상황을 예측할 수 있으면 좋겠다.', '약속한 일정과 공유 방법을 확인해보세요.'],
    ], en: [
      ['How is the project coming along?', 'Explain current progress', 'I have collected the data, and I am still working on the final analysis.', 'Whatever. I will handle it.', 'Fine.', 'I need a clear progress update.', 'Mention what is done and what remains.'],
      ['So, when can you finish it?', 'Propose a deadline and checkpoint', 'I can finish by 5 p.m. tomorrow. Could I send an update at 6 p.m. today?', 'Just wait.', 'Soon.', 'I need a deadline I can plan around.', 'Offer a specific deadline and an update.'],
      ['All right. Keep me posted if anything changes.', 'Confirm the agreement', 'Thank you. I will send an update today and let you know immediately if the schedule changes.', 'I said I would handle it.', 'OK.', 'I want reliable updates.', 'Confirm both the deadline and the communication plan.'],
    ] },
  friend: { title: '주말 약속 정하기', situation: '친구가 제안한 시간에 다른 일정이 있어 대안을 제안합니다.', goal: '거절과 대안을 함께 말하기',
    ko: [
      ['이번 토요일 오후에 시간 있어?', '상대 제안에 반응하고 상황 설명', '토요일 오후에는 일정이 있어. 대신 점심에 만나는 건 어때?', '싫어요. 알아서 해.', '응.', '만나고 싶은 건지, 약속 자체가 싫은 건지 궁금하다.', '못 만나는 이유와 가능한 시간을 함께 말해보세요.'],
      ['점심이면 어디서 볼까?', '구체적인 장소 제안', '학교 앞 카페에서 12시에 만나자. 너도 괜찮아?', '니가 알아서 해.', '아무 데나.', '결정하기 쉬운 구체적인 제안이 필요하다.', '장소와 시간을 정하고 상대 의견을 물어보세요.'],
      ['좋아, 그럼 토요일에 보자!', '약속 확인', '좋아! 토요일 12시에 학교 앞 카페에서 보자. 늦으면 미리 연락할게.', '귀찮아.', '네.', '같은 약속을 기억하고 있으면 좋겠다.', '시간과 장소를 다시 확인해보세요.'],
    ], en: [
      ['Are you free this Saturday afternoon?', 'Decline and offer an alternative', 'I have plans in the afternoon. How about lunch instead?', 'Whatever. Leave me alone.', 'Yes.', 'I want to know whether you still want to meet.', 'Suggest another time instead of stopping at no.'],
      ['Lunch sounds good. Where should we meet?', 'Suggest a place and time', 'How about the cafe near campus at noon? Does that work for you?', 'You decide everything.', 'Anywhere.', 'A specific option would help.', 'Offer a place and time, then check.'],
      ['Great. See you on Saturday!', 'Confirm the plan', 'See you at noon at the cafe near campus. I will text you if I am running late.', 'Whatever.', 'OK.', 'I want us to remember the same plan.', 'Confirm the details naturally.'],
    ] },
  girlfriend: { title: '늦은 연락에 마음 전하기', situation: '바쁜 하루 동안 연락이 뜸했던 이유를 설명하고 다음 약속을 조율합니다.', goal: '상대의 마음을 인정하고 구체적인 행동 제안하기',
    ko: [
      ['오늘 많이 바빴어? 연락이 없어서 좀 기다렸어.', '상대 마음을 인정하고 설명', '기다리게 해서 미안해. 회의가 길어졌는데 미리 알려줬어야 했어.', '니가 알아서 기다려.', '응.', '바쁜 이유보다 내 마음을 알아주는지가 중요하다.', '상대가 느낀 점을 먼저 인정해보세요.'],
      ['바쁜 건 이해하는데, 다음에는 어떻게 하면 좋을까?', '실천할 수 있는 행동 제안', '다음에는 바빠지기 전에 짧게라도 알려줄게. 오늘 저녁 9시에 통화할까?', '그냥 참아.', '글쎄.', '막연한 약속보다 작은 행동을 원한다.', '미리 연락하기나 구체적인 통화 시간을 제안해보세요.'],
      ['좋아, 그럼 9시에 전화하자.', '약속과 배려 재확인', '고마워. 9시에 내가 전화할게. 기다려줘서 고맙고 다음에는 미리 알려줄게.', '귀찮아.', '네.', '이번 약속이 지켜질 거라는 안심이 필요하다.', '누가 언제 연락할지 확인해보세요.'],
    ], en: [
      ['Were you busy today? I was waiting to hear from you.', 'Acknowledge and explain', 'I am sorry I kept you waiting. My meeting ran late, and I should have let you know.', 'Whatever. Stop bothering me.', 'Yes.', 'I want my feelings to be acknowledged.', 'Acknowledge the wait before explaining.'],
      ['I understand. What can we do differently next time?', 'Offer a concrete action', 'I will send a quick message before I get busy. Could we talk at 9 tonight?', 'Just deal with it.', 'Maybe.', 'A small clear action would reassure me.', 'Offer a specific action and time.'],
      ['Okay, let us talk at 9.', 'Confirm and show care', 'Thank you. I will call you at 9, and next time I will let you know in advance.', 'Whatever.', 'OK.', 'I want reassurance that we agree.', 'Confirm the call and appreciate their understanding.'],
    ] },
};

export function buildScenario(characterId: string, personalityId: string, pack: 'ko' | 'en'): Scenario {
  const source = scripts[characterId];
  if (!source || !personalities.some(p => p.id === personalityId)) throw new Error('CATALOG_NOT_FOUND');
  const lines = source[pack];
  const nodes = lines.map(([npcText, goal, goodExample, bad, unclear, hiddenThought, tip], index) => ({
    id: `${characterId}-${pack}-${index + 1}`, npcText, goal, goodExample, hiddenThought, tip,
    choices: [{ id: 'a', text: unclear }, { id: 'b', text: goodExample }, { id: 'c', text: bad }],
    nextNodeId: index + 1 < lines.length ? `${characterId}-${pack}-${index + 2}` : null,
  }));
  const prefix = pack === 'en' ? { strict: 'Let us be specific. ', playful: 'Hey, no pressure. ', calm: 'Take your time. ' } : { strict: '구체적으로 이야기해 봐요. ', playful: '너무 긴장하지 말고요. ', calm: '천천히 이야기해 봐요. ' };
  nodes[0].npcText = prefix[personalityId as keyof typeof prefix] + nodes[0].npcText;
  return { title: source.title, situation: source.situation, goal: source.goal, pack, characterId, personalityId, nodes };
}

export function sceneId(characterId: string, personalityId: string, pack: string) { return `${pack}-${characterId}-${personalityId}`; }
export function sceneSummary(scenario: Scenario, id = sceneId(scenario.characterId, scenario.personalityId, scenario.pack)): SceneValue {
  const { nodes, ...rest } = scenario;
  return { ...rest, id, nodeCount: nodes.length, estimatedMinutes: 3 };
}
export function listScenes(pack: 'ko' | 'en' = 'ko', characterId?: string, personalityId?: string) {
  return characters.filter(c => !characterId || c.id === characterId).flatMap(c => c.personalities.filter(p => !personalityId || p.id === personalityId).map(p => sceneSummary(buildScenario(c.id, p.id, pack))));
}
export function findScenario(id: string): Scenario | null {
  const match = /^(ko|en)-(girlfriend|friend|manager|professor)-(strict|playful|calm)$/.exec(id);
  return match ? buildScenario(match[2], match[3], match[1] as 'ko' | 'en') : null;
}
