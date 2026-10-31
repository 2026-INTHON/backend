import {z,SubtitleLanguage,Cue,ReactionEvaluation,Result,Turn} from './contracts';
export const ReportDraft=z.object({language:SubtitleLanguage,headline:z.string().min(1).max(200),overallFeedback:z.string().min(1).max(1200),strengths:z.array(z.string()).max(3),improvements:z.array(z.string()).max(3),culturalTakeaways:z.array(z.string()).min(1).max(3),nextPractice:z.array(z.string()).min(1).max(3),nodes:z.array(z.object({nodeId:z.string(),implicitIntent:z.string().min(1).max(500),culturalContext:z.string().min(1).max(1000),practiceTip:z.string().min(1).max(500)})).min(1).max(8)});
export const ReportRequest=z.object({sessionId:z.string().uuid(),policyVersion:z.literal('report-v1-draft')});
export const DetailedReport=z.object({id:z.string().uuid(),sessionId:z.string().uuid(),sceneId:z.string(),title:z.string(),language:SubtitleLanguage,policyVersion:z.literal('report-v1-draft'),provisional:z.literal(true),createdAt:z.string(),
 overview:z.object({passed:z.boolean(),score:z.number(),grade:z.string(),achievement:Result.shape.achievement,rewardCoins:z.number(),elapsedMs:z.number(),learnerTurns:z.number(),judgmentCounts:z.record(z.string(),z.number())}),
 summary:ReportDraft.omit({nodes:true,language:true}),
 details:z.array(z.object({turnId:z.string(),nodeId:z.string(),attempt:z.number(),comparison:Turn.shape.comparison,npcText:z.string(),learnerText:z.string(),native:z.boolean(),assessmentSource:z.enum(['recorded','legacy']),legacyOutcome:z.enum(['correct','misunderstanding','clarify']),evaluation:ReactionEvaluation.nullable(),originalIntent:z.string(),implicitIntent:z.string(),cues:z.array(Cue),culturalContext:z.string(),feedback:z.string(),feedbackTranslation:z.object({language:SubtitleLanguage,text:z.string()}).nullable(),praise:z.string().nullable(),alternativeExpression:z.string().nullable(),practiceTip:z.string()})).max(100),
});
export const ReportResource=z.object({reportId:z.string().uuid(),status:z.enum(['queued','running','ready','failed']),error:z.object({code:z.string(),message:z.string(),retryable:z.boolean()}).nullable(),report:DetailedReport.nullable()});
export type DetailedReportValue=z.infer<typeof DetailedReport>;

