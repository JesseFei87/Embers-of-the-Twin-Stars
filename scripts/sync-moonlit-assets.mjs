import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = 'godot-starfall/assets', target = 'public/assets/moonlit';
mkdirSync(target, { recursive: true });
const manifest = {};
for (const [from, to] of [['models/moonlit_environment.glb','environment.glb'],['moonlit-layout.json','layout.json']]) {
  copyFileSync(`${source}/${from}`, `${target}/${to}`);
  manifest[to] = createHash('sha256').update(readFileSync(`${target}/${to}`)).digest('hex');
}
writeFileSync(`${target}/source-manifest.json`, JSON.stringify(manifest,null,2)+'\n');
console.log('Synced the authored Moonlit GLB and layout into the playable game.');
