import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {findScenario} from '../src/catalog';
import {app} from '../src/app';
import {put} from '../src/content-db';
const {revise} = createRequire(import.meta.url)('../scripts/curate-dialogue.cjs');

test('Editorial migration revises nested routes and hints, is idempotent, and preserves unrelated content',()=>{
  const original = {id:'gf-1-1', nodes:[{id:'n2', npcText:'알렉스 씨, 어느 나라에서 오셨어요? 편하시면 말씀해 주세요.', nextNodeId:null,
    cues:[{k:'억양',v:'‘편하시면’에 부드러운 억양을 둔다.'}]}], routes:[{overrides:[{npcText:'혹시 요즘 좋아하는 활동이 있어요? 편하시면 알려 주세요.'}]}],
    refusal:'저는 그 얘기를 하고 싶지 않아요.', consent:'우리 말 편하게 할까요?', untouched:'다른 문장: 편하시면 말씀해 주세요.'};
  const result=revise(original);
  assert.equal(result.nodes[0].npcText,'어디에서 오셨어요?');
  assert.equal(result.nodes[0].cues[0].v,'질문 끝을 부드럽게 올린다.');
  assert.equal(result.routes[0].overrides[0].npcText,'쉬는 날에는 뭐 하세요?');
  for(const key of ['id','refusal','consent','untouched'])assert.equal(result[key],original[key as keyof typeof original]);
  assert.equal(result.nodes[0].nextNodeId,null);
  assert.deepEqual(revise(result),result);
  assert.match(original.nodes[0].npcText,/편하시면/);
});

test('Seeded conversations open in character without personality coaching prefixes',()=>{
  for(const character of ['girlfriend','professor','friend','manager'])for(const personality of ['calm','playful','strict']){
    const scene=findScenario(`ko-${character}-${personality}`)!;
    assert.doesNotMatch(scene.nodes[0].npcText,/구체적으로 이야기해|너무 긴장하지|천천히 이야기해/);
    assert.equal(scene.personalityId,personality);
  }
});

test('Retry loads the edited catalog while preserving personality and the original conversation',async()=>{
  process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';
  async function api(path:string,body?:unknown,token?:string){
    const response=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal(response.status,200);return (await response.json()).data;
  }
  const token=(await api('/auth/guest',{})).accessToken;
  const original=findScenario('ko-girlfriend-calm')!;
  await put('malo_catalog',{id:'editorial-retry',kind:'scene',document:original,updated_at:new Date().toISOString()},true);
  const first=await api('/sessions',{sceneId:'editorial-retry',personalityId:'strict',aiMode:'mock'},token);
  const edited={...original,nodes:original.nodes.map((n,i)=>i===0?{...n,npcText:'어디에서 오셨어요?'}:n)};
  await put('malo_catalog',{id:'editorial-retry',kind:'scene',document:edited,updated_at:new Date().toISOString()},true);
  const retry=await api(`/sessions/${first.id}/retry`,{},token);
  assert.equal(retry.npc.text,'어디에서 오셨어요?');
  assert.equal(retry.personalityId,'strict');
  assert.equal((await api(`/sessions/${first.id}`,undefined,token)).npc.text,first.npc.text);
});
