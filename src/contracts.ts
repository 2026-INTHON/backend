import { z } from '@hono/zod-openapi';

export { z };
export const SubtitleLanguage=z.enum(['en','ja','zh','vi','es','id','ko']);
export const Pack = z.enum(['ko', 'en']).openapi('Pack');
export const Emotion = z.enum(['neutral', 'happy', 'confused', 'sad', 'angry']).openapi('Emotion');
export const Gesture=z.enum(['idle','nod','tilt','thinking','open_hand','arms_crossed']);
export const CharacterRender=z.object({assetKey:z.string(),characterId:z.string(),emotion:Emotion,gesture:Gesture,imageUrl:z.string().nullable(),requestedEmotion:z.string(),requestedGesture:z.string(),reaction:z.string().optional(),label:z.string().optional(),pose:z.string().optional()}).openapi('CharacterImageRender');
export const Settings = z.object({ pack: Pack, voiceSpeed: z.number().min(0.5).max(1.5), subtitles: z.boolean(), notifications: z.boolean() }).openapi('Settings');
export const User = z.object({ id: z.string().uuid(), kind: z.enum(['guest', 'member']), displayName: z.string(), email: z.string().nullable(), isMock: z.boolean(), createdAt: z.string() }).openapi('User');
export const Auth = z.object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.number(), authProvider: z.enum(['demo', 'supabase']), user: User, migrated: z.boolean() }).openapi('AuthSession');
export const CharacterProfile = z.object({
  age:z.string(),role:z.string(),occupation:z.string(),introduction:z.string(),relationship:z.string(),
  values:z.array(z.string()),traits:z.array(z.string()),likes:z.array(z.string()),dislikes:z.array(z.string()),hobbies:z.array(z.string()),
  speakingStyle:z.string(),sampleLines:z.array(z.string()),
}).openapi('CharacterProfile');
export const CharacterCardProfile = z.object({name:z.string(),occupation:z.string(),age:z.string(),hobbies:z.array(z.string()),favoriteFoods:z.array(z.string()),dislikes:z.array(z.string()),currentInterests:z.array(z.string())}).openapi('CharacterCardProfile');
export const Personality = z.object({ id: z.string(), name: z.string(), description: z.string(), assetKey: z.string(), clientKey:z.string().optional(), short:z.string().optional(), level:z.string().optional(),profile:CharacterProfile.optional(),cardProfile:CharacterCardProfile.optional(),profileRevision:z.string().optional() }).openapi('Personality');
export const Character = z.object({ id: z.string(), name: z.string(), role: z.string(), description: z.string(), emoji: z.string(), assetKey: z.string(), personalities: z.array(Personality), clientKey:z.string().optional(), call:z.string().optional(), free:z.boolean().optional(), imageUrl:z.string().optional(), cardUrl:z.string().optional() }).openapi('Character');
export const Choice = z.object({ id: z.string(), text: z.string() }).openapi('Choice');
export const Cue = z.object({ k: z.enum(['표정', '억양', '망설임', '침묵']), v: z.string().trim().min(1).max(400) }).openapi('NonverbalCue');
export const Clue = z.object({ k: z.string().min(1).max(80), v: z.string().min(1).max(1200) }).openapi('HintClue');
export const Perspective = z.object({ who: z.string().min(1).max(100), meaning: z.string().min(1).max(1200), cue: z.string().min(1).max(400) }).openapi('Perspective');
export const Scene = z.object({ id: z.string(), title: z.string(), situation: z.string(), goal: z.string(), pack: Pack, characterId: z.string(), personalityId: z.string(), nodeCount: z.number(), estimatedMinutes: z.number(), backgroundUrl:z.string().optional(), chapterId:z.string().optional(), source:z.string().optional(), clientKey:z.string().optional() }).openapi('Scene');
export const Chapter = z.object({ id: z.string(), no: z.number(), characterId: z.string(), title: z.string(), desc: z.string(), locked: z.boolean(), displayLabel:z.string().optional(), pack:Pack.optional(), source:z.enum(['curriculum','examples','personal']).optional(), generationStatus:z.enum(['ready','generating','failed']).optional(),
  translation:z.object({language:SubtitleLanguage,title:z.string(),desc:z.string()}).optional(),
  subs: z.array(z.object({ id: z.string(), title: z.string(), sceneId: z.string(), personalityId: z.string(), state: z.enum(['done', 'now', 'open', 'locked']), score: z.number().nullable(), availability:z.enum(['ready','generating','unavailable']).optional(),translation:z.object({language:SubtitleLanguage,title:z.string()}).optional() })),
}).openapi('Chapter');
export const AudioMetrics = z.object({ durationMs: z.number(), pauseCount: z.number(), silenceRatio: z.number(), fillerCount: z.number(), speed: z.number(), speedUnit: z.enum(['characters_per_minute', 'words_per_minute']), measurement: z.string(), estimated: z.boolean() }).openapi('AudioMetrics');
export const Feedback = z.object({
  tone: z.object({ score: z.number(), label: z.string(), source: z.literal('text_politeness') }),
  speed: z.object({ value: z.number(), unit: z.string(), estimated: z.boolean() }).nullable(),
  hesitation: z.object({ pauseCount: z.number(), fillerCount: z.number(), estimated: z.boolean(), note: z.string() }).nullable(),
  message: z.string(), betterExpression: z.string(), reason: z.string(), views: z.array(Perspective).max(3).default([]),
}).openapi('TurnFeedback');
export const Briefing=z.object({title:z.string().default(''),partner:z.string(),situation:z.string(),goal:z.string(),translation:z.object({language:SubtitleLanguage,title:z.string(),partner:z.string(),situation:z.string(),goal:z.string()}).nullable().default(null)}).openapi('SubchapterBriefing');
export const RepairAction=z.enum(['none','request_apology','request_clarification','continue','resolved']);
export const DialogueRepair=z.object({kind:z.enum(['apology','clarification']),issue:z.string().max(400),triggerText:z.string().max(1200),resumeNpcText:z.string().max(2000)}).openapi('DialogueRepair');
export type DialogueRepairValue=z.infer<typeof DialogueRepair>;
export const Session = z.object({
  repair:DialogueRepair.nullable().optional(),
  id: z.string().uuid(), sceneId: z.string(), characterId: z.string(), personalityId: z.string(), pack: Pack,
  aiMode: z.enum(['mock', 'live']), status: z.enum(['active', 'paused', 'succeeded', 'failed', 'abandoned']),
  lives: z.number(), initialLives: z.number(), nodeIndex: z.number(), nodeCount: z.number(),
  briefing:Briefing,
  npc: z.object({speechLevel:z.enum(['polite','casual']).optional(),gesture:Gesture.default('idle'),render:CharacterRender.nullable().default(null), subtitle:z.object({language:SubtitleLanguage,text:z.string()}).nullable().default(null),audioUrl:z.string().nullable().default(null),text: z.string(), emotion: Emotion, assetKey: z.string(), action: z.string().default(''), cues: z.array(Cue).default([]) }), choices: z.array(Choice),
  chapterId:z.string().nullable().default(null), backgroundUrl:z.string().nullable().default(null), branchId:z.string().nullable().default(null), hintsUsed: z.number(), createdAt: z.string(), updatedAt: z.string(),
}).openapi('PlaySession');
export const ReactionEvaluation=z.object({mark:z.enum(['O','△','X','?']),category:z.enum(['excellent','acceptable','inappropriate','off_topic']),label:z.string(),reason:z.string(),reasonSubtitle:z.object({language:SubtitleLanguage,text:z.string()}).nullable(),goalAchieved:z.boolean(),progression:z.enum(['advance','retry']),policyVersion:z.enum(['reaction-v1-draft','judgment-v2-draft']),provisional:z.literal(true)}).openapi('ReactionEvaluation');
export const Turn = z.object({ id: z.string().uuid(), clientTurnId: z.string(), inputType: z.enum(['text', 'choice', 'voice']), text: z.string(),
  repairAction:RepairAction.optional(),
  npcSpeechLevel:z.enum(['polite','casual']).optional(),
  prompt:z.object({repair:DialogueRepair.nullable().optional(),speechLevel:z.enum(['polite','casual']).optional(),text:z.string(),action:z.string(),cues:z.array(Cue)}).optional(),
  outcome: z.enum(['correct', 'misunderstanding', 'clarify']), confidence: z.number(), feedback: Feedback,
  nodeId: z.string().default(''), mark: z.enum(['O', '△', 'X','?']).optional(), native: z.boolean().default(false), attempt: z.number().int().min(1).default(1),
  comparison: z.object({ firstAnswer: z.string(), currentAnswer: z.string(), improved: z.boolean() }).nullable().default(null),
  evaluation:ReactionEvaluation.nullable().default(null),gesture:Gesture.default('idle'),render:CharacterRender.nullable().default(null), npcReplySubtitle:z.object({language:SubtitleLanguage,text:z.string()}).nullable().default(null),audioUrl:z.string().nullable().default(null), npcReply: z.string(), action: z.string().default(''), cues: z.array(Cue).default([]), emotion: Emotion, lifeDelta: z.number(), provider: z.string(), isMock: z.boolean(), createdAt: z.string(),
}).openapi('Turn');
export const ReportMeta=z.object({reportId:z.string().uuid(),status:z.enum(['queued','running','ready','failed'])});
export const Ending=z.object({id:z.string(),kind:z.enum(['happy','bad']),title:z.string(),text:z.string(),emotion:Emotion.optional(),render:CharacterRender.nullable().default(null),
  dialogue:z.object({turnId:z.string(),text:z.string(),subtitle:z.object({language:SubtitleLanguage,text:z.string()}).nullable(),audioUrl:z.string().nullable().default(null)}).nullable().default(null),
  recap:z.object({title:z.string(),story:z.string(),comment:z.string(),prompt:z.string(),translation:z.object({language:SubtitleLanguage,title:z.string(),story:z.string(),comment:z.string(),prompt:z.string()}).nullable()}).nullable().default(null),
}).openapi('EndingPresentation');
export const Result = z.object({ sessionId: z.string(), report:ReportMeta.nullable().default(null),passed: z.boolean(), score: z.number(),
  goodUtterances: z.array(z.object({ text: z.string(), reason: z.string() })),
  improvableUtterances: z.array(z.object({ text: z.string(), betterExpression: z.string(), reason: z.string(), mistakeId: z.string().nullable() })),
  ending:Ending.nullable().default(null), rewardCoins: z.number(), durationMs: z.number(), nextSceneId: z.string().nullable(),
  achievement: z.object({ reach: z.number().min(0).max(100), infer: z.number().min(0).max(100), self: z.number().min(0).max(100) }).nullable().default(null),
}).openapi('SessionResult');
export const TurnResult = z.object({ turn: Turn, session: Session, result: Result.nullable(),
  oopsMoment: z.object({ triggered: z.boolean(), lifeDelta: z.number(), assetKey: z.string() }), mistakeId: z.string().nullable(),
}).openapi('SubmitTurnResult');
export const Mistake = z.object({ id: z.string(), sessionId: z.string(), turnId: z.string(), sceneTitle: z.string(),
  original: z.string(), betterExpression: z.string(), reason: z.string(), category: z.enum(['politeness', 'clarity']),
  pack: Pack, practiceCount: z.number(), resolved: z.boolean(), createdAt: z.string(),
}).openapi('Mistake');
export const Wallet = z.object({ coins: z.number(), currency: z.literal('MALO_COIN'), realMoney: z.literal(false) }).openapi('Wallet');
export const LedgerEntry = z.object({ id: z.string(), amount: z.number(), reason: z.string(), createdAt: z.string() }).openapi('LedgerEntry');
export const Streak = z.object({ current: z.number(), longest: z.number(), lastCheckIn: z.string().nullable() }).openapi('Streak');
export const Home = z.object({ user: User, wallet: Wallet, settings: Settings, resumeSession: Session.nullable(), todayScene: Scene, otherScenes: z.array(Scene),
  celebration: z.object({ id: z.string(), days: z.number(), message: z.string() }).nullable(),
}).openapi('Home');
export const Records = z.object({ completedScenes: z.number(), failedScenes: z.number(), totalTurns: z.number(), averageToneScore: z.number().nullable(),
  toneSource: z.literal('text_politeness'), toneTrend: z.array(z.object({ date: z.string(), score: z.number() })),
  frequentMistakes: z.array(z.object({ category: z.string(), count: z.number() })), streak: Streak,
  recentSessions: z.array(z.object({ sessionId: z.string(), title: z.string(), status: z.string(), score: z.number().nullable(), createdAt: z.string() })),
}).openapi('LearningRecords');
export const SpeechDraft = z.object({ transcriptId: z.string(), text: z.string(), editable: z.literal(true), audioMetrics: AudioMetrics, expiresAt: z.string() }).openapi('SpeechDraft');
export const AudioAsset = z.object({ audioUrl: z.string(), assetId: z.string(), mimeType: z.literal('audio/mpeg'), cached: z.boolean(), expiresIn: z.number(), voice: z.string() }).openapi('AudioAsset');
export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean(), requestId: z.string(), details: z.unknown().optional() }) }).openapi('ApiError');
export const envelope = <S extends z.ZodType>(schema: S) => z.object({ data: schema, meta: z.object({ requestId: z.string(), apiVersion: z.literal('v1') }) });

export type SettingsValue = z.infer<typeof Settings>;
export type UserValue = z.infer<typeof User>;
export type SceneValue = z.infer<typeof Scene>;
export type SessionValue = z.infer<typeof Session>;
export type TurnValue = z.infer<typeof Turn>;
export type ResultValue = z.infer<typeof Result>;
export type MistakeValue = z.infer<typeof Mistake>;
export type MetricsValue = z.infer<typeof AudioMetrics>;
