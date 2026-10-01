import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const temp = mkdtempSync(join(tmpdir(), 'embers-music-'));
try {
  const storage = new Map();
  globalThis.localStorage = { getItem:key=>storage.get(key)??null, setItem:(key,value)=>storage.set(key,value) };
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget(); document.hidden = false;
  let requests=0, finishFetch, sources=[];
  globalThis.fetch = () => { requests++; return new Promise(resolve=>{finishFetch=()=>resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});}); };
  class Context {
    state='suspended'; currentTime=0; destination={};
    async resume(){this.state='running';} async suspend(){this.state='suspended';} async close(){this.state='closed';}
    async decodeAudioData(){return {duration:96};}
    createGain(){return {gain:{value:0,cancelScheduledValues(){},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;}},connect(){},disconnect(){}};}
    createBufferSource(){const source={connect(){},disconnect(){},start(){this.started=true;},stop(time){this.stoppedAt=time;}};sources.push(source);return source;}
  }
  globalThis.AudioContext=Context;
  const outfile=join(temp,'music.mjs');
  await build({entryPoints:['src/audio/BattleMusic.ts'],bundle:true,platform:'node',format:'esm',outfile,logLevel:'silent'});
  const {BattleMusic}=await import(pathToFileURL(outfile));
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const music=new BattleMusic(); music.install();
  music.playChapter('starfall-bridge'); await tick();
  assert.equal(requests,0,'music waits for a browser user gesture before requesting audio');
  music.playChapter('moonlit-pass'); window.dispatchEvent(new Event('pointerdown')); await tick();
  assert.equal(requests,0,'other chapters stay silent');
  music.playChapter('starfall-bridge'); await tick();
  music.stop(); finishFetch(); await tick();
  assert.equal(sources.length,0,'leaving during load cannot start a late track');
  music.playChapter('starfall-bridge'); await tick();
  assert.equal(sources.length,1); assert.equal(sources[0].loop,true); assert.equal(sources[0].loopEnd,96);
  music.playChapter('starfall-bridge'); window.dispatchEvent(new Event('keydown')); await tick();
  assert.equal(sources.length,1,'scene refresh and extra gestures never overlap music');
  music.setVolume(0); assert.equal(music.volume,0);
  const restored=new BattleMusic(); assert.equal(restored.volume,0,'mute persists independently of campaign saves');
  music.setVolume(.55); assert.equal(music.volume,.55);
  document.hidden=true; document.dispatchEvent(new Event('visibilitychange')); await tick();
  assert.equal(music.context.state,'suspended','hidden tabs suspend playback');
  document.hidden=false; document.dispatchEvent(new Event('visibilitychange')); await tick();
  assert.equal(music.context.state,'running'); assert.equal(sources.length,1,'resume keeps the same playhead');
  music.playChapter('moonlit-pass'); assert.equal(sources[0].stoppedAt,.6,'exit schedules a fade and stop');
  music.dispose(); window.dispatchEvent(new Event('pointerdown')); await tick();
  assert.equal(sources.length,1,'dispose removes gesture listeners');
  const score=JSON.parse(readFileSync('public/assets/audio/starfall-music.json','utf8'));
  assert.equal(score.version,3,'piano arrangement is installed');
  assert.equal(score.instrument,'Acoustic grand piano');
  assert(score.spectrum['0-180Hz']<.20,'low bass no longer dominates');
  assert(score.spectrum['450-2000Hz']>.35,'melody has clear midrange presence');
  assert(score.sections[3].rmsDb-score.sections[0].rmsDb>6,'climax rises audibly above the restrained opening');
  assert(score.sections[3].rmsDb-score.sections[4].rmsDb>3,'music relaxes after the climax');
  const bytes=readFileSync('public/assets/audio/starfall-under-the-same-stars.wav');
  assert.equal(bytes.toString('ascii',0,4),'RIFF'); assert.equal(bytes.readUInt16LE(22),2);
  const rate=bytes.readUInt32LE(24), samples=bytes.readUInt32LE(40)/4;
  assert.equal(samples/rate,96,'the loop contains 40 full musical bars');
  let peak=0,sum=0; for(let i=44;i<bytes.length;i+=2){const v=bytes.readInt16LE(i)/32768;peak=Math.max(peak,Math.abs(v));sum+=v*v;}
  assert(peak<.9,'no digital clipping'); assert(Math.sqrt(sum/((bytes.length-44)/2))>.03,'music is audible');
  for(let channel=0;channel<2;channel++) assert(Math.abs(bytes.readInt16LE(44+channel*2)-bytes.readInt16LE(bytes.length-4+channel*2))<180,'loop boundary has no sharp discontinuity');
  console.log('PASS: chapter scope, delayed-load cancellation, single seamless loop, persisted mute/volume, hidden-tab suspension, scene cleanup, 96-second stereo audio and seam.');
} finally {rmSync(temp,{recursive:true,force:true});}
