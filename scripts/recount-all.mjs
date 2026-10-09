// Recount every meeting under meetings/. Exit 0 only if all match.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let bad = 0;
for (const d of readdirSync('meetings', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
  const r = spawnSync('node', ['scripts/recount.mjs', `meetings/${d}`], { encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'MATCH' : 'DIFF '} ${d}${ok ? '' : `\n${r.stderr || r.stdout}`}`);
}
console.log(bad ? `${bad} meeting(s) do not match` : 'all meetings match');
process.exit(bad ? 1 : 0);
