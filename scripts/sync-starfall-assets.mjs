import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = 'godot-starfall/assets', target = 'public/assets/starfall';
mkdirSync(`${target}/sprites`, { recursive: true });
const files = [['models/starfall_environment.glb', 'environment.glb'], ['layout.json', 'layout.json'],
  ...['sword', 'lancer', 'cavalry', 'mage', 'knight', 'raider'].map(key => [`sprites-hd2d/${key}.png`, `sprites/${key}.png`])];
const manifest = {};
for (const [from, to] of files) {
  copyFileSync(`${source}/${from}`, `${target}/${to}`);
  manifest[to] = createHash('sha256').update(readFileSync(`${target}/${to}`)).digest('hex');
}
writeFileSync(`${target}/source-manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log('Synced editable Starfall environment and six pixel characters into the game.');
