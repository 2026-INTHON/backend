import { z, Pack, Cue, Clue, Perspective } from './contracts';

export const Topic = z.object({ title: z.string().min(1).max(100), goal: z.string().min(1).max(500), situation: z.string().min(1).max(800) });
export const ChapterInput = z.object({ clientRequestId: z.string().uuid(), prompt: z.string().trim().min(2).max(4000),
  characterId: z.enum(['girlfriend','friend','manager','professor']), personalityId: z.enum(['strict','playful','calm']), pack: Pack.default('ko'), lessonCount: z.number().int().min(2).max(4).default(3) });
export const Ending = z.object({ id: z.enum(['happy','deferred','breakdown']), kind: z.enum(['happy','bad']), title: z.string().min(1), text: z.string().min(1) });
export const Node = z.object({ id: z.string(), npcText: z.string(), goal: z.string(), goodExample: z.string(), hiddenThought: z.string(), tip: z.string(),
  choices: z.array(z.object({id:z.string(),text:z.string()})).min(2).max(4), nextNodeId:z.string().nullable(), action:z.string(), cues:z.array(Cue).min(1), clue:z.array(Clue).min(1), views:z.array(Perspective).min(2) });
export const Lesson = z.object({title:z.string(),situation:z.string(),goal:z.string(),nodes:z.array(Node).length(8),
  routes:z.array(z.object({id:z.enum(['direct','considerate']),label:z.string(),overrides:z.array(z.object({nodeId:z.string(),npcText:z.string(),goodExample:z.string(),hiddenThought:z.string()})).length(3)})).length(2), endings:z.array(Ending).length(3)}).superRefine((v,c)=>{
    const ids=v.nodes.map(n=>n.id);
    if(new Set(ids).size!==8 || v.nodes.some((n,i)=>n.nextNodeId!==(ids[i+1]??null)) || new Set(v.routes.map(r=>r.id)).size!==2 || new Set(v.endings.map(e=>e.id)).size!==3 || v.routes.some(r=>r.overrides.some((o,i)=>o.nodeId!==ids[i+3]))) c.addIssue({code:'custom',message:'Invalid bounded story graph'});
  });
export const Outline = z.object({title:z.string(),summary:z.string(),continuity:z.string(),background:z.string().max(400),existingBackground:z.enum(['cafe','office','street','commonroom','study','new']),lessons:z.array(Topic).min(2).max(4)});
export const JobView = z.object({id:z.string().uuid(),label:z.string(),characterId:z.string(),personalityId:z.string(),status:z.enum(['queued','running','ready','failed']),stage:z.string(),chapterId:z.string().nullable(),error:z.object({code:z.string(),message:z.string(),retryable:z.boolean()}).nullable(),createdAt:z.string(),updatedAt:z.string()});
export type ChapterRequest = z.infer<typeof ChapterInput> & {persona:Record<string,unknown>;topics?:z.infer<typeof Topic>[];catalogId?:string};
export type Checkpoint = {outline?:z.infer<typeof Outline>;lessons?:z.infer<typeof Lesson>[];backgroundUrl?:string};
export type Job = z.infer<typeof JobView> & {owner_id:string|null;request_key:string;client_request_id:string;request_hash:string;kind:'personal'|'catalog';request:ChapterRequest;checkpoint:Checkpoint;chapter_id:string|null;worker_token:string|null;lease_until:string|null;attempts:number;notified_at:string|null;created_at:string;updated_at:string};
