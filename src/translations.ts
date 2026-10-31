import { createHash } from 'node:crypto';
import { aiRequest } from './ai';
import { ApiError } from './errors';
import type { z, SubtitleLanguage } from './contracts';

export type Language = z.infer<typeof SubtitleLanguage>;
const pending = new Map<string, Promise<Record<string, string>>>();

// Share concurrent work; the AI service persists the translated text cache.
export async function translations(texts: string[], language: Language): Promise<Record<string, string>> {
  const unique = [...new Set(texts.filter(text => text.trim()))];
  if (language === 'ko' || !unique.length) return Object.fromEntries(unique.map(text => [text, text]));
  const key = createHash('sha256').update(JSON.stringify([language, unique])).digest('hex');
  if (!pending.has(key)) pending.set(key, (async () => {
    const result: Record<string, string> = {};
    for (let i = 0; i < unique.length; i += 40) {
      const batch = unique.slice(i, i + 40);
      const response = await aiRequest('/v1/subtitles', { language, texts: batch });
      if (!Array.isArray(response.texts) || response.texts.length !== batch.length || response.texts.some((value: unknown) => typeof value !== 'string' || !value.trim())) {
        throw new ApiError('SUBTITLE_INVALID', '번역을 확인하지 못했어요. 다시 시도해 주세요.', 502, true);
      }
      batch.forEach((text, j) => { result[text] = response.texts[j]; });
    }
    return result;
  })().finally(() => pending.delete(key)));
  return pending.get(key)!;
}

export async function localizedChapters<T extends { title: string; desc: string; subs: { title: string }[] }>(chapters: T[], language?: Language) {
  if (!language || language === 'ko') return chapters;
  const tr = await translations(chapters.flatMap(ch => [ch.title, ch.desc, ...ch.subs.map(s => s.title)]), language);
  return chapters.map(ch => ({ ...ch, translation: { language, title: tr[ch.title] || ch.title, desc: tr[ch.desc] || ch.desc }, subs: ch.subs.map(sub => ({ ...sub, translation: { language, title: tr[sub.title] || sub.title } })) }));
}

export function requireKorean(pack: string) {
  if (pack !== 'ko') throw new ApiError('PACK_DISABLED', '현재 한국어팩만 이용할 수 있어요.', 422);
}
