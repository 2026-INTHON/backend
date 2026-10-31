import {rows} from '../src/content-db';
import {rest} from '../src/store';
import {seedCatalog} from '../src/content';
import type {Job} from '../src/generation-contracts';
await seedCatalog();
const curated:Record<string,string>={'gf-1':'commonroom','gf-2':'study','prof-2':'office','prof-3':'office'};
for(const j of await rows<Job>('malo_generation_jobs',{kind:'catalog'})){
 if(j.status==='failed'&&j.error?.code==='DAILY_QUOTA_EXCEEDED'&&curated[j.request.catalogId||'']){
  j.checkpoint.backgroundUrl='/api/v1/catalog-assets/bg-'+curated[j.request.catalogId!]+'.png';
  await rest(`malo_generation_jobs?id=eq.${j.id}&kind=eq.catalog&status=eq.failed`,{method:'PATCH',body:JSON.stringify({checkpoint:j.checkpoint,status:'queued',stage:'publishing',error:null,attempts:0,updated_at:new Date().toISOString()})});
 }
}
// Initial generation started before the API asset route was introduced; normalize those stored URLs.
for(const r of await rows<{id:string;document:unknown}>('malo_catalog',{kind:'chapter'})){
 const serialized=JSON.stringify(r.document);
 if(serialized.includes('/assets/catalog/'))await rest('malo_catalog?id=eq.'+r.id,{method:'PATCH',body:JSON.stringify({document:JSON.parse(serialized.replaceAll('/assets/catalog/','/api/v1/catalog-assets/'))})});
}
console.log('Curated cached backgrounds attached; API image budget unchanged.');
