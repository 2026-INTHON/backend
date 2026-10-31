import webpush from 'web-push';
import {createHash} from 'node:crypto';
import {rows,put,removeSubscription,patchJob} from './content-db';
import {ApiError} from './errors';
import type {Job} from './generation-contracts';

export const pushConfig=()=>({enabled:!!(process.env.MALO_VAPID_PUBLIC_KEY&&process.env.MALO_VAPID_PRIVATE_KEY),publicKey:process.env.MALO_VAPID_PUBLIC_KEY||null});
export async function subscribe(owner:string,subscription:webpush.PushSubscription){
  const url=new URL(subscription.endpoint);
  if(url.protocol!=='https:'||url.port||url.username||url.password||!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname)&&!url.hostname.endsWith('.notify.windows.com'))throw new ApiError('PUSH_ENDPOINT_INVALID','지원하는 브라우저 알림 주소가 아니에요.',422);
  const id=createHash('sha256').update(subscription.endpoint).digest('hex');
  const existing=(await rows<{owner_id:string}>('malo_push_subscriptions',{id}))[0];if(existing&&existing.owner_id!==owner)throw new ApiError('PUSH_OWNER_CONFLICT','이 브라우저의 기존 알림 구독을 해제한 뒤 다시 연결해 주세요.',409);
  await put('malo_push_subscriptions',{id,owner_id:owner,subscription,updated_at:new Date().toISOString()},true);return {id};
}
export const unsubscribe=removeSubscription;
export async function notifyCompleted(id:string){
  const j=(await rows<Job>('malo_generation_jobs',{id}))[0];if(!j||j.status!=='ready'||j.notified_at||!j.owner_id||!pushConfig().enabled)return;
  webpush.setVapidDetails(process.env.MALO_VAPID_SUBJECT||'https://inthon-demo-20261031-dh.koreacentral.cloudapp.azure.com',process.env.MALO_VAPID_PUBLIC_KEY!,process.env.MALO_VAPID_PRIVATE_KEY!);
  const subs=await rows<{id:string;subscription:webpush.PushSubscription}>('malo_push_subscriptions',{owner_id:j.owner_id});
  let failed=false;
  for(const s of subs)try{await webpush.sendNotification(s.subscription,JSON.stringify({title:'Malo',body:j.kind==='report'?'학습 보고서가 준비됐어요.':'새 학습이 준비됐어요.',url:j.kind==='report'?'/result?sessionId='+encodeURIComponent((j.request as unknown as {sessionId:string}).sessionId):'/episodes?chapterId='+j.chapter_id,tag:j.id}),{TTL:86400,timeout:10000});}catch(e){const code=(e as {statusCode?:number}).statusCode;if(code===404||code===410)await removeSubscription(s.id,j.owner_id);else failed=true;}
  if(!failed)await patchJob(j.id,j.worker_token!,{notified_at:new Date().toISOString()});
}
export async function retryNotifications(){const ready=await rows<Job>('malo_generation_jobs',{status:'ready'});for(const j of ready.filter(j=>!j.notified_at&&j.owner_id).slice(0,20))await notifyCompleted(j.id).catch(()=>{});}
