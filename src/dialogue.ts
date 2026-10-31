export type SpeechLevel='polite'|'casual';

// The opening line establishes the scene's register, not a later chapter goal.
export function initialSpeechLevel(opening:string):SpeechLevel{
  if(/(?:요|습니다|십시오|십니까)[.!?…\s]*$/u.test(opening))return 'polite';
  return /(?:안녕|어|아|야|니|래|까|지|게|자|다|해)[.!?…\s]*$/u.test(opening)?'casual':'polite';
}
// This only permits the AI to consider an agreement; it does not grant consent.
export function mentionsSpeechLevel(text:string){
  return /반말|존댓말|존대|말(?:을)?\s*(?:놓|놔|편하게)|편하게\s*(?:말|얘기|이야기)/u.test(text);
}
