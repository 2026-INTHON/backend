import {initialSpeechLevel} from './dialogue';
import {Ending} from './contracts';
import type {Play} from './models';
import type {Scenario} from './catalog';

const copy={
 perfect:'상황에 맞는 표현만 쏙쏙! 적절한 답변으로 대화를 기분 좋게 마무리했어요.',
 girlfriend:'좋은 인상을 남긴 당신! 상황에 맞는 답변만 쏙쏙 골라 한결 가까워지는 대화를 만들었어요.',
 professor:'교수님과의 대화, 깔끔하게 마무리! 상황과 관계에 맞는 표현을 잘 골라 말했어요.',
 happy:'상대의 말과 상황을 살피며 더 나은 표현으로 대화를 이어왔어요. 이번에 익힌 감각을 다음 대화에서도 활용해 보세요!',
 failed:'대화는 아쉽게 끝났지만 다시 말할 기회는 있어요. 상대가 원했던 뜻과 내 표현이 어떻게 전달됐는지 되짚어 보세요.',
 deferred:'바라던 결말에 이르지는 못했어요. 그래도 정중하게 전한 의사와 배려는 학습의 성과예요. 대화의 결과와 표현의 적절함은 나누어 살펴보세요.',
 continue:'계속 학습을 이어가 볼까요?',
 retry:'단서를 다시 살펴보고 다른 표현으로 재도전해 볼까요?',
 defaultHappy:'대화를 마쳤어요',defaultBad:'다시 도전해 봐요',
};
const failureStories={
 contempt:{title:'차갑게 멈춰 선 대화',story:'상황에 맞지 않는 대답이 반복되면서 대화의 분위기가 차갑게 얼어붙었어요. 상대는 거리를 두며 대화를 멈췄습니다.'},
 angry:{title:'분노로 끊긴 대화',story:'상황에 맞지 않는 대답이 반복되어 상대는 화가 났어요. 감정이 격해지면서 대화는 여기서 끝났습니다.'},
 sad:{title:'서운함이 남은 대화',story:'서로의 뜻이 제대로 닿지 못한 채 대화의 분위기가 가라앉았어요. 상대는 상처받은 마음을 드러내며 대화를 멈췄습니다.'},
 safety:{title:'안전을 위해 멈춘 대화',story:'상대는 안전을 우려해 대화를 중단하고 도움을 요청하기로 했어요. 다음 연습에서는 상대의 경계와 안전을 존중하는 표현을 살펴보세요.'},
};
const closing={
 contemptPolite:'이상한 분이네요. 더는 이야기하고 싶지 않아요.',
 angryPolite:'지금 뭐라고 하셨어요? 장난하세요? 저 이제 그만할게요.',
 sadPolite:'어떻게 그런 말을 하실 수 있어요? 정말 너무해요… 저 이제 그만할게요.',
 contempt:'뭐야, 이 사람. 이상한 사람 아니야? 더는 이야기하고 싶지 않아.',
 angry:'뭐, 너 뭐라고 했어? 장난해? 나 이제 그만할래.',
 angryFormal:'지금 뭐라고 했나요? 장난이라면 그만하세요. 이런 태도로는 면담을 이어갈 수 없어요.',
 sad:'어떻게 그런 말을 할 수가 있어? 정말 너무해… 나 이제 그만할래.',
 sadFormal:'어떻게 그런 말을 할 수 있나요? 정말 실망스럽군요. 오늘 대화는 여기까지 하겠습니다.',
};
const mentionsPolice=(text:string)=>/경찰|신고|\bpolice\b/i.test(text);
export function endingTexts(s:Scenario){return [...(s.endings||[]).flatMap(e=>[e.title,e.text]),...Object.values(copy),...Object.values(failureStories).flatMap(v=>[v.title,v.story]),...Object.values(closing)];}
export function failureDialogue(play:Play,emotion:string,reaction?:string){
 const formal=['professor','manager'].includes(play.scenario.characterId);
 if(!formal&&(play.speechLevel||initialSpeechLevel(play.scenario.nodes[0].npcText))==='polite')return emotion==='sad'?closing.sadPolite:reaction==='contempt'?closing.contemptPolite:closing.angryPolite;
 if(emotion==='sad')return formal?closing.sadFormal:closing.sad;
 if(reaction==='contempt'&&!formal)return closing.contempt;
 return formal?closing.angryFormal:closing.angry;
}
export function preserveSafetyDialogue(text:string){return mentionsPolice(text);}
export function presentation(play:Play){
 const passed=play.result?.passed??play.status==='succeeded',last=play.history.at(-1);
 const stored=play.result?.ending;
 const authored=play.scenario.endings?.find(e=>e.id===(play.status==='failed'?'breakdown':play.endingId||'happy'));
 const ending=Ending.parse(stored||authored||{id:passed?'happy':'breakdown',kind:passed?'happy':'bad',title:passed?copy.defaultHappy:copy.defaultBad,text:play.scenario.goal});
 const allAppropriate=play.history.length>0&&play.history.every(t=>t.evaluation?.mark==='O');
 const perfect=play.scenario.characterId==='girlfriend'?copy.girlfriend:play.scenario.characterId==='professor'?copy.professor:copy.perfect;
 const comment=ending.kind==='happy'?(allAppropriate?perfect:copy.happy):passed?copy.deferred:copy.failed;
 const failure=play.status==='failed'?(mentionsPolice(last?.npcReply||'')?failureStories.safety:last?.render?.reaction==='contempt'?failureStories.contempt:play.emotion==='sad'?failureStories.sad:failureStories.angry):null;
 const recap={title:failure?.title||ending.title,story:failure?.story||ending.text,comment,prompt:ending.kind==='happy'?copy.continue:copy.retry};
 const translations=play.subtitles||{},translated=Object.values(recap).every(text=>!!translations[text]);
 return Ending.parse({...ending,title:recap.title,text:recap.story,emotion:ending.emotion||play.emotion,render:ending.render||last?.render||null,
  dialogue:last?{turnId:last.id,text:last.npcReply,subtitle:last.npcReplySubtitle||null,audioUrl:null}:null,
  recap:{...recap,translation:translated?{language:play.subtitleLanguage||'en',title:translations[recap.title],story:translations[recap.story],comment:translations[recap.comment],prompt:translations[recap.prompt]}:null},
 });
}
