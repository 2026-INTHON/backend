import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { ApiError } from './errors';
import { initialState, type Profile } from './models';
import { insertProfile, mergeProfiles, mutate, readProfile } from './store';

function secret() {
  const value = process.env.MALO_JWT_SECRET;
  if (!value || value.length < 32) throw new ApiError('AUTH_NOT_CONFIGURED', '서버 인증 설정이 필요합니다.', 503);
  return new TextEncoder().encode(value);
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function publicUser(p: Profile) {
  const { id, kind, displayName, email, isMock, createdAt } = p;
  return { id, kind, displayName, email, isMock, createdAt };
}
async function sign(subject: string, claims: Record<string, unknown>, seconds: number) {
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setSubject(subject).setIssuer('malo-backend').setAudience('malo-app').setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + seconds).sign(secret());
}
async function verify(token: string, type: string) {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'], issuer: 'malo-backend', audience: 'malo-app' });
    if (payload.type !== type || !payload.sub) throw new Error('scope');
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('TOKEN_INVALID', '로그인이 만료되었어요. 다시 로그인해 주세요.', 401);
  }
}
export async function authenticate(header?: string) {
  if (!header?.startsWith('Bearer ')) throw new ApiError('AUTH_REQUIRED', '로그인이 필요해요.', 401);
  const payload = await verify(header.slice(7), 'access');
  const profile = await readProfile(payload.sub!);
  if (!profile || profile.mergedInto || profile.authVersion !== payload.ver) throw new ApiError('TOKEN_REVOKED', '다시 로그인해 주세요.', 401);
  return profile;
}
async function issue(profile: Profile, migrated = false) {
  const refreshToken = await sign(profile.id, { type: 'refresh', ver: profile.authVersion, jti: randomUUID() }, 7 * 86400);
  const { profile: saved } = await mutate(profile.id, p => {
    if (p.authVersion !== profile.authVersion) throw new ApiError('TOKEN_REVOKED', '로그인 상태가 바뀌었어요. 다시 로그인해 주세요.', 401);
    p.state.refreshTokens = p.state.refreshTokens.filter(t => Date.parse(t.expiresAt) > Date.now()).slice(-4);
    p.state.refreshTokens.push({ hash: hash(refreshToken), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
  });
  return { accessToken: await sign(saved.id, { type: 'access', ver: saved.authVersion }, 3600), refreshToken, expiresIn: 3600,
    authProvider: saved.isMock ? 'demo' as const : 'supabase' as const, user: publicUser(saved), migrated };
}
export async function createGuest(displayName = '게스트') {
  const now = new Date().toISOString();
  const profile: Profile = { id: randomUUID(), kind: 'guest', displayName, email: null, isMock: true, authVersion: 1, mergedInto: null, version: 1, createdAt: now, updatedAt: now, state: initialState() };
  await insertProfile(profile);
  return issue(profile);
}
export async function refresh(token: string) {
  const payload = await verify(token, 'refresh');
  const { profile } = await mutate(payload.sub!, p => {
    if (p.authVersion !== payload.ver || !p.state.refreshTokens.some(t => t.hash === hash(token) && Date.parse(t.expiresAt) > Date.now())) throw new ApiError('REFRESH_INVALID', '다시 로그인해 주세요.', 401);
    p.state.refreshTokens = p.state.refreshTokens.filter(t => t.hash !== hash(token));
  });
  return issue(profile);
}
export async function logout(id: string) {
  await mutate(id, p => { p.authVersion++; p.state.refreshTokens = []; });
  return { loggedOut: true };
}
export async function demoUpgrade(id: string, displayName: string) {
  if (process.env.MALO_ALLOW_DEMO_AUTH !== 'true') throw new ApiError('DEMO_AUTH_DISABLED', 'Google 로그인을 이용해 주세요.', 403);
  const { profile } = await mutate(id, p => {
    if (p.kind !== 'guest') throw new ApiError('ALREADY_MEMBER', '이미 회원 계정이에요.', 409);
    p.kind = 'member'; p.displayName = displayName; p.isMock = true; p.authVersion++; p.state.refreshTokens = [];
  });
  return issue(profile, true);
}
export function authConfig() {
  return { guestEnabled: true, google: { enabled: process.env.MALO_GOOGLE_ENABLED === 'true', supabaseUrl: process.env.SUPABASE_URL || null,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || null, flow: 'supabase_oauth_pkce' }, demoUpgradeEnabled: process.env.MALO_ALLOW_DEMO_AUTH === 'true' };
}
export async function googleExchange(accessToken: string, guest?: Profile) {
  if (process.env.MALO_GOOGLE_ENABLED !== 'true') throw new ApiError('GOOGLE_NOT_CONFIGURED', 'Google OAuth 클라이언트 설정이 필요합니다. 게스트로 먼저 이용할 수 있어요.', 503);
  let identity: { id: string; email?: string; user_metadata?: Record<string, string>; identities?: { provider: string }[] };
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('invalid');
    identity = await response.json();
    if (!identity.identities?.some(i => i.provider === 'google') || !/^[0-9a-f-]{36}$/i.test(identity.id)) throw new Error('provider');
  } catch { throw new ApiError('GOOGLE_TOKEN_INVALID', 'Google 로그인 정보를 확인하지 못했어요.', 401); }
  let target = await readProfile(identity.id);
  if (!target) {
    const now = new Date().toISOString();
    target = { id: identity.id, kind: 'member', displayName: identity.user_metadata?.full_name || 'Malo 학습자', email: identity.email || null,
      isMock: false, authVersion: 1, mergedInto: null, version: 1, createdAt: now, updatedAt: now, state: initialState() };
    try { await insertProfile(target); } catch (error) { const existing = await readProfile(identity.id); if (!existing) throw error; target = existing; }
  }
  const migrated = !!guest && guest.kind === 'guest' && guest.id !== target.id;
  if (migrated) target = await mergeProfiles(guest!.id, target.id);
  return issue(target, migrated);
}
export async function signAudio(userId: string, assetId: string) { return sign(userId, { type: 'audio', assetId }, 600); }
export async function verifyAudio(token: string, assetId: string) {
  const payload = await verify(token, 'audio');
  if (payload.assetId !== assetId) throw new ApiError('AUDIO_TOKEN_INVALID', '음성 링크가 만료되었어요.', 401);
}
