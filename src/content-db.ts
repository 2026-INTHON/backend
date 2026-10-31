import { dataMode, sqlite, rest } from './store';
import type { Job } from './generation-contracts';

type Row = Record<string,unknown>;
const encoded = new Set(['document','request','checkpoint','error','subscription']);
function decode<T>(row:Row):T { return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,encoded.has(k)&&typeof v==='string'?JSON.parse(v):v])) as T; }
// Table/column names below are internal constants; filter values are always bound/escaped.
const tables = new Set(['malo_catalog','malo_generation_jobs','malo_user_chapters','malo_push_subscriptions']);
function tableName(table:string) { if(!tables.has(table))throw new Error('Invalid table'); return table; }
export async function rows<T>(table:string, filters:Record<string,string>={}, order?:string):Promise<T[]> {
  tableName(table);
  if(dataMode()==='supabase') return (await rest(`${table}?${Object.entries(filters).map(([k,v])=>`${k}=eq.${encodeURIComponent(v)}`).join('&')}&select=*${order?`&order=${order}`:''}`)).map((r:Row)=>decode<T>(r));
  const keys=Object.keys(filters); if(keys.some(k=>!/^[a-z_]+$/.test(k))||order&&!/^[a-z_]+\.(asc|desc)$/.test(order))throw new Error('Invalid filter');
  return (sqlite().prepare(`SELECT * FROM ${table}${keys.length?' WHERE '+keys.map(k=>`${k}=?`).join(' AND '):''}${order?' ORDER BY '+order.replace('.', ' '):''}`).all(...Object.values(filters)) as Row[]).map(r=>decode<T>(r));
}
export async function put(table:string, row:Row, upsert=false) {
  tableName(table);
  if(dataMode()==='supabase') { await rest(table+'?on_conflict=id',{method:'POST',headers:upsert?{Prefer:'resolution=merge-duplicates,return=representation'}:{},body:JSON.stringify(row)}); return; }
  const keys=Object.keys(row); const values=keys.map(k=>encoded.has(k)&&row[k]!=null?JSON.stringify(row[k]):row[k]) as (string|number|null)[];
  sqlite().prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})${upsert?' ON CONFLICT(id) DO UPDATE SET '+keys.filter(k=>k!=='id').map(k=>`${k}=excluded.${k}`).join(','):''}`).run(...values);
}
export async function patchJob(id:string, worker:string, update:Row) {
  if(dataMode()==='supabase') { const r=await rest(`malo_generation_jobs?id=eq.${id}&worker_token=eq.${worker}`,{method:'PATCH',body:JSON.stringify(update)}); return !!r?.length; }
  const keys=Object.keys(update); const values=keys.map(k=>encoded.has(k)&&update[k]!=null?JSON.stringify(update[k]):update[k]) as (string|number|null)[];
  return !!sqlite().prepare(`UPDATE malo_generation_jobs SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=? AND worker_token=?`).run(...values,id,worker).changes;
}
export async function claimJob(worker:string):Promise<Job|null> {
  if(dataMode()==='supabase') return (await rest('rpc/malo_claim_generation_job',{method:'POST',body:JSON.stringify({worker})}))?.[0]??null;
  const db=sqlite(), now=new Date().toISOString();
  db.prepare("UPDATE malo_generation_jobs SET status='failed',stage='failed',error=? WHERE status='running' AND lease_until<? AND attempts>=2").run(JSON.stringify({code:'GENERATION_INTERRUPTED',message:'생성이 중단되었어요. 다시 생성해 주세요.',retryable:false}),now);
  const row=db.prepare("SELECT * FROM malo_generation_jobs WHERE (status='queued' OR (status='running' AND lease_until<?)) AND attempts<2 ORDER BY created_at LIMIT 1").get(now) as Row|undefined;
  if(!row)return null;
  db.prepare("UPDATE malo_generation_jobs SET status='running',worker_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?").run(worker,new Date(Date.now()+300000).toISOString(),now,row.id as string);
  return (await rows<Job>('malo_generation_jobs',{id:row.id as string}))[0];
}
export async function removeSubscription(id:string, owner:string) {
  if(dataMode()==='supabase')await rest(`malo_push_subscriptions?id=eq.${id}&owner_id=eq.${owner}`,{method:'DELETE'});
  else sqlite().prepare('DELETE FROM malo_push_subscriptions WHERE id=? AND owner_id=?').run(id,owner);
}
export async function publishChapter(jobId:string,worker:string,chapterId:string,document:unknown){
  if(dataMode()==='supabase'){await rest('rpc/malo_publish_chapter',{method:'POST',body:JSON.stringify({job:jobId,worker,chapter:chapterId,content:document})});return;}
  // No await between the job owner read and insert: profile migration cannot interleave.
  const db=sqlite();db.exec('BEGIN IMMEDIATE');
  try{const j=db.prepare('SELECT owner_id,kind,request FROM malo_generation_jobs WHERE id=? AND worker_token=? AND status=?').get(jobId,worker,'running') as {owner_id:string|null;kind:string;request:string}|undefined;
    if(!j)throw new Error('Lease lost');
    if(j.kind==='catalog')db.prepare('INSERT INTO malo_catalog VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,updated_at=excluded.updated_at').run(chapterId,'chapter',JSON.stringify(document),new Date().toISOString());
    else db.prepare('INSERT INTO malo_user_chapters VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,document=excluded.document').run(chapterId,j.owner_id,jobId,JSON.stringify(document),new Date().toISOString());
    db.prepare("UPDATE malo_generation_jobs SET status='ready',stage='ready',chapter_id=?,error=NULL,updated_at=? WHERE id=?").run(chapterId,new Date().toISOString(),jobId);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
