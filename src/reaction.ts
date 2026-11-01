type Emotion='happy'|'neutral'|'angry'|'sad'|'confused';
type Mark='O'|'△'|'X'|'?';
type Input={outcome:'correct'|'misunderstanding'|'clarify';confidence:number;native:boolean;emotion:Emotion;evaluationMark?:Mark|null;reaction?:Emotion|null;goalAchieved?:boolean|null;reason:string;reasonSubtitle?:string;subtitleLanguage?:string};
const clarification:Record<string,string>={en:'Your intention is unclear. Please check the recognized text and explain a little more.',ja:'意図を判断できません。認識された文章を確認し、もう少し具体的に伝えてください。',zh:'暂时无法判断你的意思。请检查识别出的文字，并说得更具体一些。',vi:'Chưa rõ ý bạn. Hãy kiểm tra văn bản được nhận dạng và nói cụ thể hơn.',es:'Tu intención no está clara. Revisa el texto reconocido y explica un poco más.',id:'Maksudmu belum jelas. Periksa teks yang dikenali dan jelaskan lebih rinci.',ko:'의도가 분명하지 않아 판단을 유보했어요. 인식된 내용이 맞는지 확인하고 조금 더 구체적으로 말해 주세요.'};
const legacyMark=(reaction:Emotion):Mark=>reaction==='happy'?'O':reaction==='neutral'?'△':reaction==='confused'?'?':'X';
const labels={'O':'매우 적절한 답변','△':'맥락에 맞지만 표현·뉘앙스 보완','X':'부적절한 표현·의도 불일치','?':'맥락 이탈·이해하기 어려움'};
const categories={'O':'excellent','△':'acceptable','X':'inappropriate','?':'off_topic'} as const;
export function assess(grade:Input){
 let mark:Mark=grade.evaluationMark||(grade.reaction?legacyMark(grade.reaction):grade.outcome==='correct'?'O':grade.outcome==='misunderstanding'?'X':'△');
 let goalAchieved=mark==='O'||(mark==='△'&&(grade.goalAchieved??grade.outcome==='correct'));
 let reason=grade.reason,reasonSubtitle=grade.reasonSubtitle||'';
 // Only an explicit current-rubric X can charge for clear conflict in another language.
 // Legacy outcome alone may have mistaken language-help needs for misunderstanding.
 if(grade.native){if(mark!=='?'&&grade.evaluationMark!=='X')mark='△';goalAchieved=false;}
 if(mark==='X'&&grade.confidence<.75){mark='?';goalAchieved=false;reason=clarification.ko;reasonSubtitle=clarification[grade.subtitleLanguage||'en']||clarification.en;}
 const progression=goalAchieved&&(mark==='O'||mark==='△')?'advance' as const:'retry' as const;
 const outcome=progression==='advance'?'correct' as const:mark==='X'?'misunderstanding' as const:'clarify' as const;
 return {mark,category:categories[mark],label:labels[mark],reason,reasonSubtitle,goalAchieved,progression,outcome,policyVersion:'judgment-v3-draft' as const,provisional:true as const};
}
// Adapt historical display codes without changing their recorded score, reason or policy.
export function upgradeEvaluation(value:unknown){
 if(!value||typeof value!=='object')return value;
 const record=value as Record<string,unknown>;
 if(record.mark||!['happy','neutral','angry','sad','confused'].includes(String(record.reaction)))return value;
 const mark=legacyMark(record.reaction as Emotion);
 return {...record,mark,category:categories[mark],label:labels[mark]};
}
