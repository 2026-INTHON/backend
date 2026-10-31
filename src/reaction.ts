type Reaction='happy'|'neutral'|'angry'|'sad'|'confused';
type Input={outcome:'correct'|'misunderstanding'|'clarify';confidence:number;native:boolean;emotion:Reaction;reaction?:Reaction|null;goalAchieved?:boolean|null;reason:string;reasonSubtitle?:string};
export function assess(grade:Input){
 let reaction:Reaction=grade.reaction||(grade.outcome==='correct'?'happy':grade.outcome==='misunderstanding'?(grade.emotion==='sad'?'sad':'angry'):'neutral');
 let goalAchieved=reaction==='happy'||(reaction==='neutral'&&(grade.goalAchieved??grade.outcome==='correct'));
 let reason=grade.reason,reasonSubtitle=grade.reasonSubtitle||'';
 if(grade.native){reaction='neutral';goalAchieved=false;reason='모국어로 의도를 전해도 괜찮아요. 제시한 한국어 표현으로 다시 말해 보세요.';reasonSubtitle='';}
 if(['angry','sad'].includes(reaction)&&grade.confidence<.75){reaction='neutral';goalAchieved=false;reason='의도가 분명하지 않아 판단을 유보했어요. 조금 더 구체적으로 말해 주세요.';reasonSubtitle='';}
 const progression=goalAchieved&&['happy','neutral'].includes(reaction)?'advance' as const:'retry' as const;
 const outcome=progression==='advance'?'correct' as const:['angry','sad'].includes(reaction)?'misunderstanding' as const:'clarify' as const;
 const labels={happy:'적절한 대답',neutral:'무표정 · SOSO',angry:'화남',sad:'눈물 · 서운함',confused:'혼란 · 주제와 다름'};
 return {reaction,label:labels[reaction],reason,reasonSubtitle,goalAchieved,progression,outcome,mark:reaction==='happy'?'O' as const:['angry','sad'].includes(reaction)?'X' as const:'△' as const,policyVersion:'reaction-v1-draft' as const,provisional:true as const};
}
