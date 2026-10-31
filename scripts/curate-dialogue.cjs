// One-off editorial migration. Exact reviewed strings only; never filter live AI output.
const fs = require('node:fs');
const edits = require('./data/dialogue-edits-20261101.json');

function revise(value) {
  if (typeof value === 'string') return Object.hasOwn(edits, value) ? edits[value] : value;
  if (Array.isArray(value)) return value.map(revise);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revise(v)]));
  return value;
}

async function main() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const base = process.env.SUPABASE_URL;
  if (!key || !base) throw new Error('Supabase server credentials are required');
  async function request(path, options = {}) {
    const r = await fetch(base + '/rest/v1/' + path, {...options, headers: {
      apikey: key, ...(key.startsWith('eyJ') ? {Authorization: 'Bearer ' + key} : {}),
      'Content-Type': 'application/json', Prefer: 'return=representation',
    }, signal: AbortSignal.timeout(15000)});
    if (!r.ok) throw new Error('Catalog HTTP ' + r.status);
    return r.json();
  }
  const rows = await request('malo_catalog?kind=in.(scene,chapter)&select=id,kind,document,updated_at&order=id');
  const changes = rows.map(row => ({row, document: revise(row.document)}))
    .filter(({row, document}) => JSON.stringify(row.document) !== JSON.stringify(document));
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({dryRun: true, changedRows: changes.length, ids: changes.map(c => c.row.id)}));
    return;
  }
  const backup = process.argv[process.argv.indexOf('--backup') + 1];
  if (!process.argv.includes('--backup') || !backup || backup.startsWith('--')) throw new Error('--backup PATH is required');
  if (changes.some(c => !c.row.updated_at)) throw new Error('Cannot guard a row without updated_at');
  fs.writeFileSync(backup, JSON.stringify({savedAt: new Date().toISOString(), rows: changes.map(c => c.row)}, null, 2), {flag: 'wx', mode: 0o600});
  for (const {row, document} of changes) {
    // Stop on concurrent edits rather than replacing a teammate's newer document.
    const result = await request('malo_catalog?id=eq.' + encodeURIComponent(row.id) + '&updated_at=eq.' + encodeURIComponent(row.updated_at), {
      method: 'PATCH', body: JSON.stringify({document, updated_at: new Date().toISOString()}),
    });
    if (result.length !== 1) throw new Error('Concurrent catalog edit: ' + row.id + '. Earlier rows may already be applied; rerun safely after review.');
    if (JSON.stringify(result[0].document) !== JSON.stringify(document)) throw new Error('Catalog verification failed: ' + row.id);
  }
  console.log(JSON.stringify({appliedRows: changes.length, backup}));
}

module.exports = {revise};
if (require.main === module) main().catch(e => {console.error(e.message); process.exitCode = 1;});
