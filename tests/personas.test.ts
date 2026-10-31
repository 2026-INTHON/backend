import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
import {characterPersona,personaPrompt} from '../src/personas';
import {persona} from '../src/content';
import {evaluate} from '../src/ai';
import {findScenario} from '../src/catalog';

before(()=>{process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';});
test('Each public card matches its character file and the AI generation profile',async()=>{
  const res=await app.request('/api/v1/characters');assert.equal(res.status,200);
  const {data}=await res.json();
  for(const character of data) {
    const variants=[];
    for(const p of character.personalities) {
      const expected=characterPersona(character.id,p.id)!;
      assert.deepEqual(p.profile,expected.profile);
      assert.equal(p.name,expected.name);assert.equal(p.profileRevision,expected.revision);
      assert.equal('dialogueRules' in p,false);
      assert.deepEqual((await persona(character.id,p.id)).profile,p.profile);
      assert.ok(p.profile.hobbies.length>=3);assert.ok(p.profile.sampleLines.length>=2);
      variants.push(JSON.stringify(p.profile));
    }
    assert.equal(new Set(variants).size,3);
  }
  assert.equal(characterPersona('unknown','calm'),null);
  assert.equal(characterPersona('girlfriend','unknown'),null);
});
test('Live evaluation sends the selected character profile, not just a generic trait',async()=>{
  const original=globalThis.fetch,old=process.env.MALO_AI_URL;
  process.env.MALO_AI_URL='http://ai.test';let sent:any;
  globalThis.fetch=async(_,options)=>{sent=JSON.parse(options!.body as string);return Response.json({error:{code:'CAPTURE',message:'test',retryable:false}},{status:503});};
  try {
    const scenario=findScenario('ko-professor-playful')!;
    await assert.rejects(evaluate(scenario,scenario.nodes[0],'질문이 있습니다.','live'));
    assert.deepEqual(sent.persona,personaPrompt('professor','playful'));
    assert.equal(sent.persona.name,'친절');assert.ok(sent.persona.profile.occupation.includes('교수'));
  } finally {globalThis.fetch=original;if(old===undefined)delete process.env.MALO_AI_URL;else process.env.MALO_AI_URL=old;}
});

test('Compact card API exposes seven short fields per personality without prompt instructions',async()=>{
  for(const character of ['girlfriend','professor','friend','manager'])for(const personality of ['calm','playful','strict']){
    const response=await app.request(`/api/v1/characters/${character}/personalities/${personality}/profile?language=ko`);
    assert.equal(response.status,200);
    const {data}=await response.json(),profile=data.profile;
    assert.equal(data.language,'ko');assert.equal(data.personalityId,personality);
    assert.deepEqual(Object.keys(profile).sort(),['name','occupation','age','hobbies','favoriteFoods','dislikes','currentInterests'].sort());
    for(const value of Object.values(profile).flat() as string[])assert.ok(value.length>0&&value.length<=30);
    for(const food of profile.favoriteFoods)assert.ok(personaPrompt(character,personality)!.profile.likes.includes(food));
    assert.deepEqual(personaPrompt(character,personality)!.cardProfile.favoriteFoods,profile.favoriteFoods);
  }
  assert.equal((await app.request('/api/v1/characters/unknown/personalities/calm/profile')).status,422);
});
