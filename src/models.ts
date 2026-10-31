import type { Scenario } from './catalog';
import type { MetricsValue, MistakeValue, ResultValue, SettingsValue, TurnValue } from './contracts';

export type StoredTurn = { id: string; clientTurnId: string; inputHash: string; status: 'pending' | 'completed' | 'retryable_error'; response?: TurnResponse; errorCode?: string };
export type Play = {
  id: string; sceneId: string; scenario: Scenario; aiMode: 'mock' | 'live'; status: 'active' | 'paused' | 'succeeded' | 'failed' | 'abandoned';
  gesture?:'idle'|'nod'|'tilt'|'thinking'|'open_hand'|'arms_crossed'; subtitleLanguage?:'en'|'ja'|'zh'|'vi'|'es'|'id'|'ko'; subtitles?:Record<string,string>; branchId?:string; endingId?:string; lives: number; nodeIndex: number; hintsUsed: number; hintKeys?: string[]; emotion: 'neutral' | 'happy' | 'confused' | 'sad' | 'angry';
  turns: StoredTurn[]; history: TurnValue[]; result: ResultValue | null; createdAt: string; updatedAt: string;
};
export type SavedMistake = MistakeValue & { nodeIndex: number; scenario: Scenario; practiceRequests: Record<string, unknown> };
export type Speech = { id: string; text: string; metrics: MetricsValue; expiresAt: string };
export type State = {
  settings: SettingsValue; plays: Play[]; mistakes: SavedMistake[]; coins: number;
  ledger: { id: string; amount: number; reason: string; createdAt: string }[];
  attendance: { days: string[]; longest: number; acknowledged: string[] };
  speechDrafts: Speech[]; refreshTokens: { hash: string; expiresAt: string }[];
};
export type Profile = { id: string; kind: 'guest' | 'member'; displayName: string; email: string | null; isMock: boolean;
  authVersion: number; mergedInto: string | null; version: number; createdAt: string; updatedAt: string; state: State };
export type TurnResponse = { turn: TurnValue; session: import('./contracts').SessionValue; result: ResultValue | null;
  oopsMoment: { triggered: boolean; lifeDelta: number; assetKey: string }; mistakeId: string | null };

export function initialState(): State {
  return { settings: { pack: 'ko', voiceSpeed: 1, subtitles: true, notifications: false }, plays: [], mistakes: [], coins: 100,
    ledger: [{ id: 'welcome', amount: 100, reason: '첫 연습 응원 재화', createdAt: new Date().toISOString() }],
    attendance: { days: [], longest: 0, acknowledged: [] }, speechDrafts: [], refreshTokens: [] };
}
