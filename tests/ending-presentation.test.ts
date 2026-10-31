import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presentation,endingTexts} from '../src/endings';
import {buildScenario} from '../src/catalog';
import type {Play} from '../src/models';

test('Ending recap uses prepared translations and actual judgments without extra AI calls or invented romance',()=>{
 const scenario={...buildScenario('girlfriend','calm','ko'),endings:[{id:'happy',kind:'happy' as const,title:'다음 만남의 약속',text:'서로 편안하게 인사를 나누고 다음 대화를 약속했어요.'}]};
 const subtitles=Object.fromEntries(endingTexts(scenario).map(text=>[text,'English: '+text]));
 const play={scenario,status:'succeeded',endingId:'happy',subtitleLanguage:'en',subtitles,emotion:'happy',history:[{id:'turn',npcReply:'다음에 또 만나요.',npcReplySubtitle:{language:'en',text:'See you again.'},evaluation:{mark:'O'},render:null}]} as unknown as Play;
 const card=presentation(play);assert.ok(card.recap!.comment.includes('좋은 인상'));assert.equal(card.recap!.translation!.language,'en');assert.equal(card.recap!.translation!.story,subtitles[scenario.endings[0].text]);assert.equal(card.dialogue!.subtitle!.text,'See you again.');assert.ok(!card.recap!.story.includes('연인'));
 play.history[0].evaluation!.mark='△';const improved=presentation(play);assert.ok(!improved.recap!.comment.includes('답변만 쏙쏙'));assert.ok(improved.recap!.translation);
 play.subtitles={};assert.equal(presentation(play).recap!.translation,null);
 Object.assign(play.history[0],{npcReplySubtitle:undefined});assert.equal(presentation(play).dialogue!.subtitle,null);
});
