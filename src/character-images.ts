import {z,Emotion,Gesture,CharacterRender} from './contracts';
import {personaAssets} from './ai';
import * as Content from './content';
export const Variant=z.object({assetKey:z.string(),characterId:z.string(),emotion:Emotion,gesture:Gesture,imageUrl:z.string().nullable()});
type ImageVariant=z.infer<typeof Variant>;
let cache:{until:number;items:ImageVariant[]}|undefined;
export async function variants(base:string){
 if(cache&&cache.until>Date.now())return cache.items.map(i=>({...i,imageUrl:i.imageUrl?base+i.imageUrl:null}));
 let items:ImageVariant[];
 try{
  const response=await fetch(`${process.env.MALO_AI_URL}/v1/character-variants`,{headers:{'X-AI-Service-Token':process.env.MALO_AI_SERVICE_TOKEN||''},signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw new Error('manifest');
  const data=z.object({items:z.array(z.object({assetKey:z.string(),characterId:z.string(),emotion:Emotion,gesture:Gesture,assetId:z.string().regex(/^i_[a-f0-9]{40}$/).nullable()}))}).parse(await response.json());
  items=data.items.map(v=>({...v,imageUrl:v.assetId?'/api/v1/images/'+v.assetId:null}));
 }catch{items=(await personaAssets('')).map(v=>Variant.parse({...v,gesture:'idle'}));}
 cache={until:Date.now()+60000,items};
 return items.map(i=>({...i,imageUrl:i.imageUrl?base+i.imageUrl:null}));
}
export function choose(items:ImageVariant[],characterId:string,emotion:string,gesture:string){
 const own=items.filter(i=>i.characterId===characterId&&i.imageUrl);
 return own.find(i=>i.emotion===emotion&&i.gesture===gesture)||own.find(i=>i.emotion===emotion&&i.gesture==='idle')||own.find(i=>i.emotion==='neutral'&&i.gesture==='idle')||null;
}
export async function render(base:string,characterId:string,emotion:string,gesture:string):Promise<z.infer<typeof CharacterRender>>{
 const selected=choose(await variants(base),characterId,emotion,gesture);
 if(selected)return {...selected,requestedEmotion:emotion,requestedGesture:gesture};
 const character=(await Content.characters()).find(c=>c.id===characterId);
 return {assetKey:`characters/${characterId}/neutral`,characterId,emotion:'neutral',gesture:'idle',imageUrl:character?.imageUrl?base+character.imageUrl:null,requestedEmotion:emotion,requestedGesture:gesture};
}
