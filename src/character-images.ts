import {z,Emotion,Gesture,CharacterRender} from './contracts';
import {personaAssets} from './ai';
import * as Content from './content';
export const Variant=z.object({assetKey:z.string(),characterId:z.string(),emotion:Emotion,gesture:Gesture,imageUrl:z.string().nullable(),label:z.string().optional(),reaction:z.string().optional(),pose:z.string().optional(),useWhen:z.string().optional(),tags:z.array(z.string()).optional(),defaultForEmotion:z.boolean().optional(),endingPreferred:z.boolean().optional(),source:z.string().optional()});
type ImageVariant=z.infer<typeof Variant>;
let cache:{until:number;items:ImageVariant[]}|undefined;
const absolute=(base:string,url:string|null)=>url?(url.startsWith('https://')||url.startsWith('http://')?url:base+url):null;
export async function variants(base:string){
 if(cache&&cache.until>Date.now())return cache.items.map(i=>({...i,imageUrl:absolute(base,i.imageUrl)}));
 const custom:ImageVariant[]=[];
 try{
  for(const character of await Content.characters()){
   const entries=(character as unknown as {imageVariants?:unknown[]}).imageVariants||[];
   for(const item of entries){const parsed=Variant.safeParse(item);if(parsed.success&&parsed.data.characterId===character.id&&parsed.data.imageUrl?.startsWith('https://'))custom.push({...parsed.data,source:'supabase_catalog'});}
  }
 }catch{if(cache)return cache.items.map(i=>({...i,imageUrl:absolute(base,i.imageUrl)}));}
 let legacy:ImageVariant[];
 try{
  const response=await fetch(`${process.env.MALO_AI_URL}/v1/character-variants`,{headers:{'X-AI-Service-Token':process.env.MALO_AI_SERVICE_TOKEN||''},signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw new Error('manifest');
  const data=z.object({items:z.array(z.object({assetKey:z.string(),characterId:z.string(),emotion:Emotion,gesture:Gesture,assetId:z.string().regex(/^i_[a-f0-9]{40}$/).nullable()}))}).parse(await response.json());
  legacy=data.items.map(v=>({...v,imageUrl:v.assetId?'/api/v1/images/'+v.assetId:null}));
 }catch{legacy=(await personaAssets('')).map(v=>Variant.parse({...v,gesture:'idle'}));}
 // A custom character uses its own image set, never a mixture of old and new identities.
 const replaced=new Set(custom.map(i=>i.characterId));
 const items=[...custom,...legacy.filter(i=>!replaced.has(i.characterId))];
 cache={until:Date.now()+60000,items};
 return items.map(i=>({...i,imageUrl:absolute(base,i.imageUrl)}));
}
export function endingEmotion(emotion:z.infer<typeof Emotion>,badEnding:boolean,failed:boolean){
 return badEnding&&!['angry','sad'].includes(emotion)?failed?'angry' as const:'sad' as const:emotion;
}
export function choose(items:ImageVariant[],characterId:string,emotion:string,gesture:string,preferred?:string|null,badEnding=false){
 const own=items.filter(i=>i.characterId===characterId&&i.imageUrl),matching=own.filter(i=>i.emotion===emotion);
 const ending=matching.filter(i=>i.endingPreferred),same=badEnding&&ending.length?ending:matching;
 const best=(list:ImageVariant[])=>list.find(i=>i.defaultForEmotion)||list[0];
 return same.find(i=>i.assetKey===preferred)||best(same.filter(i=>i.gesture===gesture))||best(same)||best(own.filter(i=>i.emotion==='neutral'))||null;
}
export async function render(base:string,characterId:string,emotion:string,gesture:string,preferred?:string|null,badEnding=false):Promise<z.infer<typeof CharacterRender>>{
 const selected=choose(await variants(base),characterId,emotion,gesture,preferred,badEnding);
 if(selected)return {...selected,requestedEmotion:emotion,requestedGesture:gesture};
 const character=(await Content.characters()).find(c=>c.id===characterId);
 return {assetKey:`characters/${characterId}/neutral`,characterId,emotion:'neutral',gesture:'idle',imageUrl:absolute(base,character?.imageUrl||null),requestedEmotion:emotion,requestedGesture:gesture};
}
