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
export function endingTexts(s:Scenario){return [...(s.endings||[]).flatMap(e=>[e.title,e.text]),...Object.values(copy)];}
export function presentation(play:Play){
 const passed=play.result?.passed??play.status==='succeeded',last=play.history.at(-1);
 const stored=play.result?.ending;
 if(stored?.recap&&stored.dialogue)return Ending.parse({...stored,dialogue:{...stored.dialogue,audioUrl:null}});
 const authored=play.scenario.endings?.find(e=>e.id===(play.status==='failed'?'breakdown':play.endingId||'happy'));
 const ending=Ending.parse(stored||authored||{id:passed?'happy':'breakdown',kind:passed?'happy':'bad',title:passed?copy.defaultHappy:copy.defaultBad,text:play.scenario.goal});
 const allAppropriate=play.history.length>0&&play.history.every(t=>t.evaluation?.mark==='O');
 const perfect=play.scenario.characterId==='girlfriend'?copy.girlfriend:play.scenario.characterId==='professor'?copy.professor:copy.perfect;
 const comment=ending.kind==='happy'?(allAppropriate?perfect:copy.happy):passed?copy.deferred:copy.failed;
 const recap={title:ending.title,story:ending.text,comment,prompt:ending.kind==='happy'?copy.continue:copy.retry};
 const translations=play.subtitles||{},translated=Object.values(recap).every(text=>!!translations[text]);
 return Ending.parse({...ending,emotion:ending.emotion||play.emotion,render:ending.render||last?.render||null,
  dialogue:last?{turnId:last.id,text:last.npcReply,subtitle:last.npcReplySubtitle||null,audioUrl:null}:null,
  recap:{...recap,translation:translated?{language:play.subtitleLanguage||'en',title:translations[recap.title],story:translations[recap.story],comment:translations[recap.comment],prompt:translations[recap.prompt]}:null},
 });
}
