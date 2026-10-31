import assert from 'node:assert/strict';
import { createGuest, demoUpgrade, authenticate } from '../src/auth';
import { mutate, mergeProfiles, readProfile } from '../src/store';

// Explicit opt-in integration check; creates two disposable demo profiles in the configured project.
if (process.env.MALO_DATA_MODE !== 'supabase') throw new Error('Set MALO_DATA_MODE=supabase to run this integration check');
const guest = await createGuest('Supabase merge smoke');
const target = await createGuest('Supabase member smoke');
await demoUpgrade(target.user.id, 'Supabase member smoke');
await mutate(guest.user.id, p => { p.state.coins += 30; p.state.settings.pack = 'en'; p.state.ledger.push({ id: 'smoke-earned', amount: 30, reason: 'integration check', createdAt: new Date().toISOString() }); });
const merged = await mergeProfiles(guest.user.id, target.user.id);
assert.equal(merged.state.coins, 130); assert.equal(merged.state.settings.pack, 'en');
assert.equal((await readProfile(guest.user.id))?.mergedInto, target.user.id);
await assert.rejects(authenticate(`Bearer ${guest.accessToken}`));
await assert.rejects(mergeProfiles(guest.user.id, target.user.id));
console.log('Supabase: CAS persistence, atomic RPC merge, earned-coin transfer and guest-token revocation passed.');
