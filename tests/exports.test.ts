import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
import {workOne} from '../src/generation';
import {mergeProfiles} from '../src/store';
before(()=>{process.env.MALO_DB_PATH=':memory:';process.env.MALO_DATA_MODE='sqlite';process.env.MALO_AI_URL='http://ai.test';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';});
async function api(path:string,body?:unknown,token?:string){const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()};}
test('Replay export is durable, contains every answer/reaction and score, deduplicates and restricts private files',async()=>{
 const a=(await api('/auth/guest',{})).data,b=(await api('/auth/guest',{})).data,real=globalThis.fetch;
 const s=(await api('/sessions',{sceneId:'ko-professor-calm',aiMode:'mock'},a.accessToken)).data,path='/sessions/'+s.id;
 assert.equal((await api(path+'/exports',{format:'video'},a.accessToken)).status,409);
 for(let i=0;i<3;i++)await api(path+'/turns',{clientTurnId:'x'+i,inputType:'choice',choiceId:'c'},a.accessToken);
 const started=(await api(path+'/exports',{format:'video',language:'ko'},a.accessToken)).data;
 assert.ok(started.id);assert.equal(started.status,'queued');
 assert.equal((await api(path+'/exports',{format:'video',language:'ko'},a.accessToken)).data.id,started.id);
 assert.equal((await api(path+'/exports?language=ko',undefined,b.accessToken)).status,404);
 assert.equal((await api('/exports/'+started.id+'/download',{},a.accessToken)).status,409);
 let rendered:any,voices=0;
 globalThis.fetch=async(url,init)=>{
  const input=init?.body?JSON.parse(init.body as string):{};
  if(String(url).endsWith('/speech/synthesize')){voices++;return Response.json({assetId:'a_'+'1'.repeat(40)});}
  if(String(url).endsWith('/exports/render')){rendered=input;return Response.json({assetId:'e_'+'2'.repeat(40)+'.mp4',mimeType:'video/mp4',bytes:120,durationSeconds:30});}
  if(String(url).includes('/exports/files/'))return new Response('video',{headers:{'Content-Length':'5','Accept-Ranges':'bytes'}});
  throw new Error('Unexpected provider '+url);
 };
 try{
  await workOne(); // persisted audio step, then change owner and continue
  await mergeProfiles(a.user.id,b.user.id);
  for(let i=0;i<15;i++){await workOne();if(rendered)break;}
  assert.ok(rendered);assert.equal(rendered.frames.filter((f:any)=>f.speaker==='learner').length,3);
  assert.equal(rendered.frames.at(-1).speaker,'score');
  assert.equal(rendered.backgroundUrl,'/api/v1/catalog-assets/bg-street.png');
  assert.match(rendered.frames.at(-1).text,/힌트 없이 답하기/);
  assert.equal(rendered.frames.filter((f:any)=>f.speaker==='npc').length,voices);
  assert.ok(rendered.frames.filter((f:any)=>f.speaker==='npc').every((f:any)=>f.audioAssetId&&!f.speech));
  assert.ok(rendered.frames.filter((f:any)=>f.speaker==='learner').every((f:any)=>f.text));
  assert.equal((await api(path+'/exports?language=ko',undefined,b.accessToken)).data[0].status,'ready');
  assert.equal((await api('/exports/'+started.id+'/download',{},a.accessToken)).status,401);
  const c=(await api('/auth/guest',{})).data;
  assert.equal((await api('/exports/'+started.id+'/download',{},c.accessToken)).status,404);
  const download=(await api('/exports/'+started.id+'/download',{},b.accessToken)).data;
  const url=new URL(download.url),file=await app.request(url.pathname+url.search);
  assert.equal(file.status,200);assert.equal(await file.text(),'video');assert.match(file.headers.get('cache-control')!,/no-store/);
  assert.equal((await app.request(url.pathname)).status,401);
  assert.equal((await app.request(url.pathname.replace(started.id,crypto.randomUUID())+url.search)).status,401);
  assert.equal((await api(path+'/exports',{format:'video',language:'ko'},b.accessToken)).data.id,started.id);
 }finally{globalThis.fetch=real;}
});
