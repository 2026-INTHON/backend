import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Profile } from './models';
import { ApiError } from './errors';
import { chapterSql } from './chapter-sql';

let localDb: DatabaseSync | undefined;
let localPath = '';
export function dataMode() { return process.env.MALO_DATA_MODE === 'supabase' ? 'supabase' : 'sqlite'; }
export function sqlite() {
  const path = process.env.MALO_DB_PATH || '.data/malo.sqlite';
  if (!localDb || path !== localPath) {
    localDb?.close();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    localDb = new DatabaseSync(path, { timeout: 5000 });
    localPath = path;
    localDb.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS malo_profiles (id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL)');
    localDb.exec(chapterSql);
  }
  return localDb;
}
function restHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!process.env.SUPABASE_URL || !key) throw new ApiError('DATABASE_NOT_CONFIGURED', 'Supabase 서버 설정이 필요합니다.', 503, true);
  return { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation' };
}
export async function rest(path: string, init: RequestInit = {}) {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...restHeaders(), ...init.headers }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new ApiError('DATABASE_UNAVAILABLE', '데이터 저장소에 연결하지 못했어요.', 503, true);
    return response.status === 204 ? null : await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('DATABASE_UNAVAILABLE', '데이터 저장소에 연결하지 못했어요.', 503, true);
  }
}
function document(profile: Profile) { const { version: _, ...value } = profile; return value; }
function decode(row: { id: string; version: number; document: string | Omit<Profile, 'version'> }): Profile {
  return { ...(typeof row.document === 'string' ? JSON.parse(row.document) : row.document), id: row.id, version: row.version };
}
export async function readProfile(id: string): Promise<Profile | null> {
  if (dataMode() === 'supabase') {
    const rows = await rest(`malo_profiles?id=eq.${encodeURIComponent(id)}&select=id,version,document&limit=1`);
    return rows?.[0] ? decode(rows[0]) : null;
  }
  const row = sqlite().prepare('SELECT * FROM malo_profiles WHERE id=?').get(id) as { id: string; version: number; document: string } | undefined;
  return row ? decode(row) : null;
}
export async function insertProfile(profile: Profile) {
  if (dataMode() === 'supabase') {
    await rest('malo_profiles', { method: 'POST', body: JSON.stringify({ id: profile.id, version: profile.version, document: document(profile) }) });
  } else {
    sqlite().prepare('INSERT INTO malo_profiles VALUES (?,?,?)').run(profile.id, profile.version, JSON.stringify(document(profile)));
  }
}
async function saveProfile(profile: Profile) {
  profile.updatedAt = new Date().toISOString();
  const version = profile.version;
  if (dataMode() === 'supabase') {
    const rows = await rest(`malo_profiles?id=eq.${profile.id}&version=eq.${version}`, { method: 'PATCH', body: JSON.stringify({ version: version + 1, document: document(profile) }) });
    if (!rows?.length) return false;
  } else {
    const result = sqlite().prepare('UPDATE malo_profiles SET version=?,document=? WHERE id=? AND version=?').run(version + 1, JSON.stringify(document(profile)), profile.id, version);
    if (!result.changes) return false;
  }
  profile.version++;
  return true;
}
export async function mutate<T>(id: string, operation: (profile: Profile) => T): Promise<{ profile: Profile; value: T }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const profile = await readProfile(id);
    if (!profile || profile.mergedInto) throw new ApiError('USER_NOT_AVAILABLE', '다시 로그인해 주세요.', 401);
    const value = operation(profile);
    if (await saveProfile(profile)) return { profile, value };
  }
  throw new ApiError('STATE_CONFLICT', '다른 요청을 처리 중이에요. 잠시 후 다시 시도해 주세요.', 409, true);
}

export function mergeDocuments(guest: Profile, target: Profile): Profile {
  if (guest.id === target.id) return target;
  if (guest.kind !== 'guest' || guest.mergedInto || target.mergedInto) throw new ApiError('MERGE_INVALID', '이관할 수 없는 계정입니다.', 409);
  if (guest.state.plays.some(play => play.turns.some(turn => turn.status === 'pending'))) throw new ApiError('MERGE_BUSY', '대화 응답을 기다린 뒤 로그인해 주세요.', 409, true);
  const result = structuredClone(target);
  const appendUnique = <T extends { id: string }>(a: T[], b: T[]) => [...a, ...b.filter(item => !a.some(old => old.id === item.id))];
  result.state.plays = appendUnique(target.state.plays, guest.state.plays);
  result.state.mistakes = appendUnique(target.state.mistakes, guest.state.mistakes);
  const guestLedger = guest.state.ledger.filter(entry => entry.id !== 'welcome').map(entry => ({ ...entry, id: `guest:${guest.id}:${entry.id}` }));
  result.state.ledger = appendUnique(target.state.ledger, guestLedger);
  result.state.coins += Math.max(0, guest.state.coins - 100); // One welcome grant per member; earned coins transfer.
  result.state.attendance.days = [...new Set([...target.state.attendance.days, ...guest.state.attendance.days])].sort();
  result.state.attendance.longest = Math.max(target.state.attendance.longest, guest.state.attendance.longest);
  result.state.settings = guest.state.settings;
  result.updatedAt = new Date().toISOString();
  return result;
}
export async function mergeProfiles(guestId: string, targetId: string): Promise<Profile> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const guest = await readProfile(guestId), target = await readProfile(targetId);
    if (!guest || !target) throw new ApiError('USER_NOT_FOUND', '계정 정보를 찾지 못했어요.', 404);
    const merged = mergeDocuments(guest, target);
    if (guest.id === target.id) return target;
    if (dataMode() === 'supabase') {
      const done = await rest('rpc/malo_merge_profiles', { method: 'POST', body: JSON.stringify({ guest_id: guestId, target_id: targetId, guest_version: guest.version, target_version: target.version, target_document: document(merged) }) });
      if (!done) continue;
    } else {
      const db = sqlite();
      db.exec('BEGIN IMMEDIATE');
      try {
        const versions = db.prepare('SELECT id,version FROM malo_profiles WHERE id IN (?,?)').all(guestId, targetId) as { id: string; version: number }[];
        if (versions.find(row => row.id === guestId)?.version !== guest.version || versions.find(row => row.id === targetId)?.version !== target.version) { db.exec('ROLLBACK'); continue; }
        guest.mergedInto = targetId;
        guest.authVersion++;
        guest.state.refreshTokens = [];
        db.prepare('UPDATE malo_profiles SET version=?,document=? WHERE id=?').run(target.version + 1, JSON.stringify(document(merged)), targetId);
        db.prepare('UPDATE malo_profiles SET version=?,document=? WHERE id=?').run(guest.version + 1, JSON.stringify(document(guest)), guestId);
        for (const table of ['malo_generation_jobs', 'malo_user_chapters', 'malo_push_subscriptions']) db.prepare(`UPDATE ${table} SET owner_id=? WHERE owner_id=?`).run(targetId, guestId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    return (await readProfile(targetId))!;
  }
  throw new ApiError('MERGE_CONFLICT', '기록 이관을 다시 시도해 주세요.', 409, true);
}
