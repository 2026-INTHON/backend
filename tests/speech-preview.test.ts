import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
before(()=>{process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';process.env.MALO_AI_URL='http://ai.test';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';});
async function request(path:string,body?:unknown,token?:string){const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()};}
test('Demo dialogue speech requires auth, keeps character acting and creates no learning records',async()=>{
 const body={text:'이번 주말에 하고 싶은 거 있어?',characterId:'girlfriend',personalityId:'strict',emotion:'sad',pack:'ko'};
 assert.equal((await request('/speech/preview',body)).status,401);
 const token=(await request('/auth/guest',{})).data.accessToken,real=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{assert.ok(String(url).endsWith('/synthesize'));const input=JSON.parse(init!.body as string);assert.equal(input.text,body.text);assert.equal(input.personalityId,'strict');assert.equal(input.emotion,'sad');return Response.json({assetId:'a_'+'b'.repeat(40),voice:'sage',cached:true});};
 try{
  const response=await request('/speech/preview',body,token);assert.equal(response.status,200);assert.equal(response.data.voice,'sage');assert.equal(response.data.cached,true);assert.equal(response.data.expiresIn,600);assert.ok(response.data.audioUrl.includes('/api/v1/audio/a_'));
  assert.equal((await request('/speech/preview',{...body,text:'x'.repeat(501)},token)).status,422);
  assert.equal((await request('/speech/preview',{...body,personalityId:'unknown'},token)).status,422);
  const records=(await request('/records',undefined,token)).data;assert.equal(records.totalTurns,0);assert.equal(records.completedScenes,0);
 }finally{globalThis.fetch=real;}
});
test('New sessions default to live, and production rejects explicit mock grading',async()=>{
 const token=(await request('/auth/guest',{})).data.accessToken;
 const started=await request('/sessions',{sceneId:'ko-girlfriend-calm'},token);assert.equal(started.status,200);assert.equal(started.data.aiMode,'live');
 const previous=process.env.NODE_ENV;
 try{Reflect.set(process.env,'NODE_ENV','production');const rejected=await request('/sessions',{sceneId:'ko-girlfriend-calm',aiMode:'mock'},token);assert.equal(rejected.status,422);assert.equal(rejected.error.code,'LIVE_AI_REQUIRED');}
 finally{if(previous===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Reflect.set(process.env,'NODE_ENV',previous);}
});
