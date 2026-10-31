import type {AffectValue} from './contracts';
type Grade={repairAction:string;offenseSeverity:'mild'|'serious'|'severe';emotion:string};
// Emotional recovery is independent of both forgiveness and learning progression.
export function recoverAffect(previous:AffectValue|null,grade:Grade,mark:string,personality:string,repairPending:boolean):AffectValue|null{
 if(grade.repairAction==='request_apology'||(repairPending&&mark==='X')){
  const base={mild:1,serious:3,severe:5}[grade.offenseSeverity];
  const strain=Math.min(6,Math.max(1,base+(personality==='strict'?1:personality==='playful'?-1:0),previous?previous.strain+1:0));
  return {strain,emotion:grade.emotion==='sad'?'sad':'angry',stage:'hurt'};
 }
 if(!previous)return null;
 if(grade.repairAction==='resolved')return {...previous,strain:Math.max(0,previous.strain-1),stage:previous.strain>2?'guarded':'softening'};
 if(repairPending)return previous;
 const strain=['O','△'].includes(mark)?Math.max(0,previous.strain-1):previous.strain;
 return strain?{...previous,strain,stage:strain>2?'guarded':'softening'}:null;
}
export function affectEmotion(affect:AffectValue){return affect.stage==='hurt'||affect.strain>=3?affect.emotion:'neutral';}
