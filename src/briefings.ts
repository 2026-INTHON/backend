import copy from './data/briefings.json';
import type {Scenario} from './catalog';
const briefs:Record<string,{situation:string;goal:string}>=copy;
// Public introduction is distinct from the full authoring context used by the AI.
export function conciseBrief(s:Scenario,id=''){
 const key=id.replace(/-(strict|playful|calm)$/,'');
 const known=briefs[id]||briefs[key];
 if(known)return known;
 const first=(text:string)=>text.split(/(?<=[.!?。])\s*|\n+/).map(s=>s.trim()).find(s=>s&&!/시뮬레이션|실제.*전송|checkpoint|체크포인트|발화.*(?:번|후)/i.test(s))||text.split(/(?<=[.!?。])\s*/)[0];
 return {situation:first(s.situation),goal:first(s.goal)};
}
