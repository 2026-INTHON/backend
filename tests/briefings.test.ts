import {test} from 'node:test';
import assert from 'node:assert/strict';
import copy from '../src/data/briefings.json';
import {conciseBrief} from '../src/briefings';
import {buildScenario} from '../src/catalog';

test('Every fixed Korean story has a short learner-facing introduction independent of authoring instructions',()=>{
 const scene=buildScenario('girlfriend','calm','ko');
 for(const [id,brief] of Object.entries(copy)){
  assert.ok(brief.situation.length<100,id);assert.ok(brief.goal.length<100,id);
  assert.doesNotMatch(brief.situation+brief.goal,/시뮬레이션|실제.*전송|체크포인트|checkpoint|발화/);
  assert.deepEqual(conciseBrief(scene,id),brief);
 }
 for(const persona of ['calm','strict','playful'])assert.deepEqual(conciseBrief(scene,'ko-girlfriend-'+persona),copy['ko-girlfriend']);
 const custom={...scene,situation:'친구와 카페에서 만나 여행 이야기를 나눕니다. 이 장면은 시뮬레이션입니다.',goal:'서로 원하는 여행지를 묻습니다. 8번의 발화 뒤 다음 장으로 갑니다.'};
 assert.deepEqual(conciseBrief(custom,'custom'),{situation:'친구와 카페에서 만나 여행 이야기를 나눕니다.',goal:'서로 원하는 여행지를 묻습니다.'});
});
