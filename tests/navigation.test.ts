import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app';
import {mutate} from '../src/store';
before(()=>{process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';process.env.MALO_JWT_SECRET='test-only-secret-that-is-longer-than-32-characters';});
async function request(path:string,body?:unknown,token?:string){
 const r=await app.request('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,headers:r.headers,...await r.json()};
}
test('Legacy personalities are one episode, preserve progress, and start with the chosen script',async()=>{
 const auth=(await request('/auth/guest',{})).data,token=auth.accessToken;
 const chapters=(await request('/chapters?pack=ko&characterId=girlfriend',undefined,token)).data;
 assert.equal(chapters.find((c:any)=>c.id==='ko-girlfriend').subs.length,1);
 assert.equal(chapters.find((c:any)=>c.id==='gf-1').subs.length,4);
 const play=(await request('/sessions',{sceneId:'ko-girlfriend-calm',personalityId:'strict'},token)).data;
 assert.equal(play.sceneId,'ko-girlfriend-strict');assert.equal(play.personalityId,'strict');
 await mutate(auth.user.id,p=>{p.state.plays.find(s=>s.id===play.id)!.status='succeeded';});
 const updated=(await request('/chapters?pack=ko&characterId=girlfriend',undefined,token)).data;
 assert.equal(updated.find((c:any)=>c.id==='ko-girlfriend').subs[0].state,'done');
});
test('Repeated reads cannot consume session-start capacity; 429 includes a bounded retry time',async()=>{
 const token=(await request('/auth/guest',{})).data.accessToken;
 for(let i=0;i<180;i++)assert.equal((await request('/me',undefined,token)).status,200);
 const limited=await request('/me',undefined,token);
 assert.equal(limited.status,429);assert.equal(limited.error.code,'RATE_LIMITED');
 const seconds=Number(limited.headers.get('Retry-After'));assert.ok(seconds>=1&&seconds<=60);
 assert.equal((await request('/sessions',{sceneId:'ko-girlfriend-calm'},token)).status,200);
});
