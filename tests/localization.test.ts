import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
import {translations} from '../src/translations';
before(()=>{process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';process.env.MALO_AI_URL='http://ai.test';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';});
async function request(path:string,token:string,body?:unknown){const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()};}

test('Chapter translation preserves IDs; retries and hints follow the newly selected language',async()=>{
 const auth=await request('/auth/guest','',{}),token=auth.data.accessToken,real=globalThis.fetch;
 const languages:string[]=[];
 globalThis.fetch=async(url,init)=>{
  const b=JSON.parse(init!.body as string);
  if(String(url).endsWith('/subtitles')){languages.push(b.language);return Response.json({texts:b.texts.map((s:string)=>`${b.language}: ${s}`)});}
  if(String(url).endsWith('/synthesize'))return Response.json({assetId:'a_'+'a'.repeat(40),voice:'test',cached:true});
  throw new Error('Unexpected AI request');
 };
 try{
  const ko=await request('/chapters?pack=ko&characterId=girlfriend&language=ko',token);
  assert.equal(languages.length,0);
  for(const language of ['en','ja','zh']){
   const localized=await request(`/chapters?pack=ko&characterId=girlfriend&language=${language}`,token);
   assert.equal(localized.status,200);assert.deepEqual(localized.data.map((c:{id:string})=>c.id),ko.data.map((c:{id:string})=>c.id));
   assert.equal(localized.data[0].translation.language,language);assert.ok(localized.data[0].subs[0].translation.title.startsWith(language+':'));
  }
  const play=await request('/sessions',token,{sceneId:'ko-girlfriend-calm',subtitleLanguage:'ja',aiMode:'live'});
  assert.equal(play.status,200);assert.equal(play.data.npc.subtitle.language,'ja');assert.equal(play.data.briefing.translation.language,'ja');
  const retry=await request(`/sessions/${play.data.id}/retry`,token,{subtitleLanguage:'zh'});
  assert.equal(retry.status,200);assert.notEqual(retry.data.id,play.data.id);assert.equal(retry.data.npc.subtitle.language,'zh');assert.equal(retry.data.briefing.translation.language,'zh');
  const hint=await request(`/sessions/${retry.data.id}/hint`,token,{step:2});
  assert.equal(hint.status,200);assert.ok(hint.data.hiddenThought.startsWith('zh:'));assert.ok(hint.data.clue[0].v.startsWith('zh:'));
  assert.equal((await request('/chapters?language=invalid',token)).status,422);
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Korean must not call AI');};
  assert.deepEqual(await translations(['안녕','안녕'],'ko'),{'안녕':'안녕'});assert.equal(calls,0);
 }finally{globalThis.fetch=real;}
});

test('Large translation sets are bounded and malformed translations fail without wrong-language fallback',async()=>{
 const real=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_,init)=>{calls++;const b=JSON.parse(init!.body as string);assert.ok(b.texts.length<=40);return Response.json({texts:b.texts.map((text:string)=>'JA '+text)});};
 try{
  const data=await translations(Array.from({length:85},(_,i)=>`문장 ${i}`),'ja');assert.equal(Object.keys(data).length,85);assert.equal(calls,3);
  globalThis.fetch=async()=>Response.json({texts:[]});
  await assert.rejects(translations(['번역 실패'],'zh'),{code:'SUBTITLE_INVALID'});
 }finally{globalThis.fetch=real;}
});
