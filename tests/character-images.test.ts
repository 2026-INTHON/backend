import {test} from 'node:test';
import assert from 'node:assert/strict';
import {choose} from '../src/character-images';
import {variants} from '../src/character-images';
import * as Content from '../src/content';
import {put} from '../src/content-db';
test('Image selection keeps identity and prefers expression over an unavailable gesture',()=>{
 const items=[{assetKey:'g-neutral',characterId:'girlfriend',emotion:'neutral' as const,gesture:'idle' as const,imageUrl:'/neutral.webp'},
 {assetKey:'g-happy',characterId:'girlfriend',emotion:'happy' as const,gesture:'idle' as const,imageUrl:'/happy.webp'},
 {assetKey:'g-happy-nod',characterId:'girlfriend',emotion:'happy' as const,gesture:'nod' as const,imageUrl:'/nod.webp'},
 {assetKey:'p-angry',characterId:'professor',emotion:'angry' as const,gesture:'idle' as const,imageUrl:'/professor.webp'}];
 assert.equal(choose(items,'girlfriend','happy','nod')?.assetKey,'g-happy-nod');
 assert.equal(choose(items,'girlfriend','happy','open_hand')?.assetKey,'g-happy');
 assert.equal(choose(items,'girlfriend','angry','idle')?.assetKey,'g-neutral');
 assert.equal(choose(items,'friend','angry','idle'),null);
});

test('DB defaults and context choices win without crossing identity, and reseeding preserves uploaded variants',async()=>{
 process.env.MALO_DATA_MODE='sqlite';process.env.MALO_DB_PATH=':memory:';process.env.MALO_AI_URL='';
 await Content.seedCatalog();const character=(await Content.characters()).find(c=>c.id==='girlfriend')!;
 const base={characterId:'girlfriend',emotion:'neutral' as const,gesture:'idle' as const,imageUrl:'https://storage.test/avatar.webp'};
 const uploaded=[{...base,assetKey:'watch',defaultForEmotion:false},{...base,assetKey:'attentive',defaultForEmotion:true}];
 assert.equal(choose(uploaded,'girlfriend','neutral','idle')!.assetKey,'attentive');
 assert.equal(choose(uploaded,'girlfriend','neutral','idle','watch')!.assetKey,'watch');
 assert.equal(choose(uploaded,'professor','neutral','idle','watch'),null);
 assert.equal(choose([{...base,emotion:'confused',gesture:'thinking',assetKey:'think'}],'girlfriend','confused','idle')!.assetKey,'think');
 await put('malo_catalog',{id:'girlfriend',kind:'character',document:{...character,imageVariants:uploaded,imageVariantBatchId:'user-batch'},updated_at:new Date().toISOString()},true);
 await Content.seedCatalog();const saved=(await Content.characters()).find(c=>c.id==='girlfriend') as unknown as {imageVariants:unknown[]};
 assert.deepEqual(saved.imageVariants,uploaded);
 const manifest=await variants('https://api.test');const own=manifest.filter(v=>v.characterId==='girlfriend');
 assert.equal(own.length,2);assert.equal(own[0].imageUrl,'https://storage.test/avatar.webp');assert.equal(own[0].source,'supabase_catalog');
});
