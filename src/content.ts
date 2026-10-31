import FE from './data/fe-examples.json';
import { characters as legacyCharacters, listScenes as legacyScenes, findScenario as legacyScenario, type Scenario, sceneSummary } from './catalog';
import * as C from './contracts';
import { rows, put } from './content-db';
import type { Profile } from './models';
import { ApiError } from './errors';
import { characterPersona, personaPrompt } from './personas';

export type CatalogCharacter = C.z.infer<typeof C.Character>;
export type CatalogChapter = C.z.infer<typeof C.Chapter> & {pack:'ko'|'en';source:'curriculum'|'examples'|'personal';generationStatus:'ready'|'generating'|'failed'};
type Content<T>={id:string;kind:string;document:T};
export const charMap:Record<string,string>={seoyun:'girlfriend',junho:'friend',boss:'manager',prof:'professor'};
export const personaMap:Record<string,string>={tease:'playful',picky:'strict',calm:'calm'};
export const curriculum = [
  {id:'gf-1',characterId:'girlfriend',no:1,title:'첫 만남에서 대화하기',place:'cafe',topics:[['자기소개','이름·나이·출신·관심사를 소개하기'],['호칭 정하기','씨·님·이름 부르기와 존댓말을 조율하기'],['자연스럽게 질문하기','취미나 일상 질문으로 대화 이어가기'],['친밀감 표현','상대 반응에 맞는 칭찬과 호감 표현']]},
  {id:'gf-2',characterId:'girlfriend',no:2,title:'카카오톡으로 약속 잡기',place:'cafe',topics:[['대화 시작','자연스러운 첫 메시지와 스몰토킹'],['약속 제안','~할래요·~어때요로 제안하기'],['애매한 답변 이해','시간 되면요·한번 봐요의 맥락과 불확실성을 확인하기'],['약속 확정','시간·장소 조율과 확인']]},
  {id:'gf-3',characterId:'girlfriend',no:3,title:'함께 점심 메뉴 고르고 식사하기',place:'cafe',topics:[['주문하기','메뉴 주문·요청 표현과 식사 예절'],['대화 이어가기','맞장구·리액션·후속 질문'],['칭찬과 농담','센스 있다·웃기시네요 등의 뉘앙스 해석'],['말투 변화','존댓말·반말 전환 제안과 상대 의사 존중']]},
  {id:'gf-n',characterId:'girlfriend',no:4,title:'썸에서 연인으로',place:'street',topics:[['호감 표현 이해','너랑 있으면 편해·다음에도 같이 가자·보고 싶었어: 우정과 연애 감정을 단정하지 않고 말투·표정·억양으로 맥락 파악'],['관계 확인','우리 무슨 사이야·우리는 어떤 관계라고 생각해: 직접·완곡 질문과 상대 부담 배려'],['감정 표현','너한테 호감 있어·너를 더 알아가고 싶어·좋아해: 강도 차이와 자연스러운 고백'],['답변 이해와 대응','나도 좋아·조금 더 생각해 볼게·좋은 사람인 건 맞는데: 수용·유보·거절을 존중하고 재촉하지 않기']]},
  {id:'prof-1',characterId:'professor',no:1,title:'교수님과 첫 만남에서 대화하기',place:'office',topics:[['자기소개','이름·목적·전공·학년과 격식 있는 자기소개'],['호칭과 존댓말','교수님·선생님의 적절성과 높임 표현'],['자연스럽게 질문하기','수업·전공에 관해 정중하게 질문하고 이어가기'],['대화 마무리','감사·작별 인사와 반응에 맞는 종료']]},
  {id:'prof-2',characterId:'professor',no:2,title:'교수님께 이메일로 문의하기',place:'office',topics:[['이메일 시작','제목·자기소개·인사와 한국 대학 이메일 예절'],['문의 전달','수업 내용·과제를 명확하고 정중하게 질문하기'],['완곡한 안내 이해','확인해 보세요·공지사항을 참고하면 좋겠네요의 간접 안내·지시 해석'],['답변 회신','답변을 이해하고 감사·확인 표현으로 회신하기']]},
  {id:'prof-3',characterId:'professor',no:3,title:'과제 제출과 피드백 받기',place:'office',topics:[['과제 질문','요구사항·제출 형식·평가 기준을 정중하게 문의'],['기한 연장 요청','사유를 설명하고 정중히 양해 구하기: 연장 불가 정책도 존중'],['간접 수정 요구 이해','이 부분은 다시 검토하면 좋겠네요·조금 아쉽네요의 완곡한 피드백 해석'],['피드백 반영','요구를 확인하고 구체적인 수정 계획 전달']]},
  {id:'prof-n',characterId:'professor',no:4,title:'교수님께 연구 참여 또는 추천서 요청하기',place:'office',topics:[['연구 참여 문의','연구실·프로젝트에 대한 관심과 참여 가능성 문의'],['역량 소개','수강 경험·기술·관심 분야를 간결하고 명확하게 설명'],['간접 거절·유보 이해','현재는 자리가 많지 않아요·나중에 다시 이야기해 봅시다: 의미를 단정하지 않고 확인'],['추천서 요청과 감사','추천서 부탁·필요한 정보 전달·감사·후속 연락']]},
] as const;

export async function seedCatalog() {
  const save=async(id:string,kind:string,document:unknown)=>put('malo_catalog',{id,kind,document,updated_at:new Date().toISOString()},true);
  for(const c of FE.characters) {
    const id=charMap[c.id], old=legacyCharacters.find(v=>v.id===id)!;
    const existing=(await rows<Content<Record<string,unknown>>>('malo_catalog',{id,kind:'character'}))[0]?.document||{};
    const personas=FE.personas[c.id as keyof typeof FE.personas].map(p=>({id:personaMap[p.id],clientKey:p.id,name:p.name,description:p.long,short:p.short,level:p.level,assetKey:`personalities/${personaMap[p.id]}`}));
    await save(id,'character',{...old,name:c.name,role:c.role,call:c.call,free:c.free,clientKey:c.id,imageUrl:`/api/v1/catalog-assets/char-${c.id}.png`,cardUrl:`/api/v1/catalog-assets/card-${c.id}.png`,personalities:personas,...existing});
  }
  for(const place of ['cafe','office','street','commonroom','study'])await save('bg-'+place,'background',{place,imageUrl:`/api/v1/catalog-assets/bg-${place}.png`,source:['commonroom','study'].includes(place)?'chatgpt_pre_generated':'fe-pr7'});
  for(const pack of ['ko','en'] as const)for(const s of legacyScenes(pack))await save(s.id,'scene',{...legacyScenario(s.id),source:'examples',estimatedMinutes:3});
  for(const s of FE.scenes)for(const p of ['tease','picky','calm'] as const) {
    const nodes=s.turns.map((t,i)=>{
      const alt=(('byPersona' in t?t.byPersona:undefined) as Record<string,{line:string;action:string;cues:{k:string;v:string}[]}>|undefined)?.[p];
      const line={line:t.line,action:t.action,cues:t.cues,...alt};
      return {id:`${s.id}-${i+1}`,npcText:line.line,action:line.action,cues:line.cues.filter(c=>c.k!=='행동'),goal:s.goal,goodExample:t.better,hiddenThought:t.thought,tip:t.tip,
        clue:[{k:'주목 표현',v:t.clue.focus},{k:'행동',v:t.clue.act},{k:'상황 단서',v:t.clue.ctx}],views:t.views,
        choices:[{id:'a',text:'조금 더 설명해 주세요.'},{id:'b',text:t.better},{id:'c',text:'알아서 하세요.'}],nextNodeId:i<s.turns.length-1?`${s.id}-${i+2}`:null};
    });
    await save(`${s.id}-${personaMap[p]}`,'scene',{title:s.title,situation:s.situation,goal:s.goal,pack:'ko',characterId:charMap[s.char],personalityId:personaMap[p],nodes,source:'examples',clientKey:s.id,backgroundUrl:`/api/v1/catalog-assets/bg-${s.place}.png`,estimatedMinutes:1});
  }
  // Original demo chapter titles are preserved; painted grades/completion are deliberately not user history.
  for(const ch of FE.chapters)await save(`fe-example-${ch.no}`,'chapter',{id:`fe-example-${ch.no}`,no:ch.no,displayLabel:`예시 ${ch.no}`,characterId:'girlfriend',title:ch.title,desc:ch.desc,pack:'ko',source:'examples',generationStatus:'ready',locked:false,
    subs:ch.subs.map(sub=>({id:sub.id,title:sub.title,sceneId:('scene' in sub&&sub.scene)?`${sub.scene}-playful`:'',personalityId:'playful',state:('scene' in sub&&sub.scene)?'open':'locked',score:null,availability:('scene' in sub&&sub.scene)?'ready':'unavailable'}))});
  for(const pack of ['ko','en'] as const)for(const c of legacyCharacters)await save(`${pack}-${c.id}`,'chapter',{id:`${pack}-${c.id}`,no:0,displayLabel:'짧은 예시',characterId:c.id,title:`${c.name}와 대화하기`,desc:c.description,pack,source:'examples',generationStatus:'ready',locked:false,subs:legacyScenes(pack,c.id).map(s=>({id:s.id,sceneId:s.id,title:s.title,personalityId:s.personalityId,state:'open',score:null,availability:'ready'}))});
  for(const ch of curriculum) {
    const existing=(await rows<Content<CatalogChapter>>('malo_catalog',{id:ch.id}))[0];
    if(existing?.document.generationStatus==='ready'||(existing?.document as unknown as {chapter?:CatalogChapter})?.chapter?.generationStatus==='ready')continue;
    await save(ch.id,'chapter',{id:ch.id,no:ch.no,displayLabel:ch.id.endsWith('-n')?'CH N':`CH ${ch.no}`,characterId:ch.characterId,title:ch.title,desc:'한국어를 배우는 외국인 유학생을 위한 상황 학습',pack:'ko',source:'curriculum',generationStatus:'generating',locked:true,
      subs:ch.topics.map(([title],i)=>({id:`${ch.id}-${i+1}`,title,sceneId:`${ch.id}-${i+1}`,personalityId:'calm',state:'locked',score:null,availability:'generating'}))});
  }
}
let boot:Promise<void>|undefined;
async function ensure(){ if((await rows('malo_catalog',{kind:'character'})).length)return; boot??=seedCatalog().finally(()=>{boot=undefined;});await boot; }
export async function characters(){await ensure();return (await rows<Content<CatalogCharacter>>('malo_catalog',{kind:'character'})).map(({document:c})=>({...c,personalities:c.personalities.map(p=>{
  const selected=characterPersona(c.id,p.id);
  return selected?{...p,name:selected.name,short:selected.short,description:selected.description,profile:selected.profile,profileRevision:selected.revision}:p;
})}));}
export async function scene(id:string,owner?:string):Promise<Scenario|null>{
  await ensure();const publicRow=(await rows<Content<Scenario>>('malo_catalog',{id,kind:'scene'}))[0];if(publicRow)return publicRow.document;
  for(const c of await rows<Content<{chapter:CatalogChapter;scenarios?:Record<string,Scenario>}>>('malo_catalog',{kind:'chapter'}))if(c.document.scenarios?.[id])return c.document.scenarios[id];
  if(owner)for(const c of await rows<{document:{scenarios:Record<string,Scenario>}}>('malo_user_chapters',{owner_id:owner}))if(c.document.scenarios[id])return c.document.scenarios[id];
  return null;
}
export async function scenes(pack:'ko'|'en',characterId?:string,personalityId?:string){await ensure();const base=(await rows<Content<Scenario>>('malo_catalog',{kind:'scene'})).map(r=>sceneSummary(r.document,r.id));for(const c of await rows<Content<{scenarios?:Record<string,Scenario>}>>('malo_catalog',{kind:'chapter'}))for(const [id,s] of Object.entries(c.document.scenarios||{}))base.push(sceneSummary(s,id));return base.filter(s=>s.pack===pack&&(!characterId||s.characterId===characterId)&&(!personalityId||s.personalityId===personalityId));}
export async function chapters(p:Profile,pack:'ko'|'en',characterId?:string){
  await ensure();const all=(await rows<Content<CatalogChapter|{chapter:CatalogChapter}>>('malo_catalog',{kind:'chapter'})).map(r=>'chapter' in r.document?r.document.chapter:r.document);
  const own=await rows<{document:{chapter:CatalogChapter}}>('malo_user_chapters',{owner_id:p.id});all.push(...own.map(r=>r.document.chapter));
  return all.filter(c=>c.pack===pack&&(!characterId||c.characterId===characterId)).sort((a,b)=>a.characterId.localeCompare(b.characterId)||a.no-b.no).map(ch=>{
   // Legacy chapters contain one story in three personalities, not three episodes.
   const legacy=ch.source==='examples'&&ch.id===`${ch.pack}-${ch.characterId}`;
   const subs=legacy?[ch.subs.find(s=>s.sceneId?.endsWith('-calm'))||ch.subs[0]].filter(Boolean):ch.subs;
   return {...ch,subs:subs.map(s=>{
    const plays=p.state.plays.filter(play=>legacy?ch.subs.some(v=>v.sceneId===play.sceneId):play.sceneId===s.sceneId);const done=plays.filter(play=>play.status==='succeeded');
    return {...s,state:s.availability!=='ready'?'locked':done.length?'done':plays.some(play=>['active','paused'].includes(play.status))?'now':'open',score:done.length?Math.max(...done.map(play=>play.result?.score||0)):null};
  })};});
}
export async function persona(characterId:string,personalityId:string){const c=(await characters()).find(c=>c.id===characterId);const p=c?.personalities.find(p=>p.id===personalityId);if(!c||!p)throw new ApiError('PERSONA_NOT_FOUND','캐릭터와 성격을 확인해 주세요.',422);return {...personaPrompt(characterId,personalityId),id:c.id,name:c.name,role:c.role,personality:p};}
