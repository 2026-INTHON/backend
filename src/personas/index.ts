import girlfriend from './girlfriend.json';
import professor from './professor.json';
import friend from './friend.json';
import manager from './manager.json';
import { z, CharacterProfile, CharacterCardProfile } from '../contracts';

const Variant = z.object({ name:z.string(), short:z.string(), description:z.string(), profile:CharacterProfile.partial(), cardProfile:CharacterCardProfile, dialogueRules:z.array(z.string()) });
const Definition = z.object({ revision:z.string(), profile:CharacterProfile.partial(), dialogueRules:z.array(z.string()), personalities:z.object({calm:Variant,playful:Variant,strict:Variant}) });
// One editable source per character; the public card and AI resolve the same variant.
const definitions = Object.fromEntries(Object.entries({girlfriend,professor,friend,manager}).map(([id,value])=>[id,Definition.parse(value)]));

export function characterPersona(characterId:string, personalityId:string) {
  const definition=definitions[characterId];
  if(!definition || !['calm','playful','strict'].includes(personalityId))return null;
  const variant=definition.personalities[personalityId as 'calm'|'playful'|'strict'];
  return {revision:definition.revision,name:variant.name,short:variant.short,description:variant.description,
    cardProfile:variant.cardProfile,
    profile:CharacterProfile.parse({...definition.profile,...variant.profile}),
    dialogueRules:[...definition.dialogueRules,...variant.dialogueRules]};
}

export function personaPrompt(characterId:string, personalityId:string) {
  const selected=characterPersona(characterId,personalityId);
  if(!selected)return undefined;
  const {cardProfile:_,...prompt}=selected;
  return {characterId,personalityId,...prompt};
}
