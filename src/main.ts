import Phaser from 'phaser';
import { battleMusic, bindMusicSettings } from './audio/BattleMusic';
import './style.css';
import './ui-theme.css';
import './chronicle-theme.css';
import './replica-theme.css';
import './world-map.css';
import './parchment-ui.css';
import { installParchmentInteractions, paperSheet, paperTitle, paperMessage, paperButton, settingsPages } from './game/ui/parchment';
import { installReplicaLayout, showChronicleDialog } from './game/ui/replica';
import { readDisplaySettings, saveDisplaySettings } from './presentation/DisplaySettings';
import { chapters } from './game/data/chapters';
import { installChronicleMotion } from './game/ui/chronicle';
import { PixelBattleScene } from './game/PixelBattleScene';
import { PreparationScene } from './game/PreparationScene';
import { WorldScene } from './game/WorldScene';
import { VillageScene } from './game/VillageScene';
import { playDialogue } from './game/ui/dialogue';
import { clearSave, createNewCampaign, loadGame } from './game/save';

const hud = document.querySelector<HTMLDivElement>('#hud')!;
installChronicleMotion(hud);
installReplicaLayout();
installParchmentInteractions();
battleMusic.install();
if (import.meta.hot) import.meta.hot.dispose(() => battleMusic.dispose());

function showTitle(onStart: () => void, onContinue?: () => void) {
  hud.innerHTML = `<section class="screen replica-title" aria-label="双星余烬主菜单"><div class="replica-stage title-plate"><h1 class="visually-hidden">双星余烬</h1>
    <nav class="replica-menu" aria-label="主菜单"><button id="start">开始游戏</button><button id="continue" ${onContinue ? '' : 'disabled'}>继续</button><button id="load-menu">读取存档</button><button id="formation-menu">编队</button><button id="settings-menu">设置</button><button id="exit-menu">退出</button></nav>
    </div></section>`;
  hud.querySelector('#load-menu')?.addEventListener('click', () => {
    const save = loadGame();
    const dialog = showChronicleDialog('远征存档', save ? `<div class="save-entry"><b>${chapters[save.activeChapterId].title}</b><p>${save.status === 'battle' ? `战斗中 · 第 ${save.turn} 回合` : '世界地图'} · ${save.roster.length} 位同伴</p><p>${new Date(save.savedAt).toLocaleString('zh-CN')}</p><button class="paper-button primary" id="load-current">读取此存档</button></div><p>更多存档栏位 · 待开放</p>` : '<p>尚无远征记录，请先开始游戏。</p>');
    dialog.querySelector('#load-current')?.addEventListener('click', () => { dialog.close(); onContinue?.(); });
  });
  hud.querySelector('#formation-menu')?.addEventListener('click', () => {
    const save = loadGame() ?? createNewCampaign();
    game.scene.start('preparation', { chapterId: save.activeChapterId, fromTitle: true, readOnly: save.status === 'battle' });
    game.scene.stop('boot');
  });
  hud.querySelector('#settings-menu')?.addEventListener('click', () => {
    const settings = readDisplaySettings();
    const pages = settingsPages(settings, true);
    const dialog = showChronicleDialog('系统设置', pages.right, undefined, pages.left);
    bindMusicSettings(dialog);
    dialog.querySelector('#title-quality')?.addEventListener('change', e => { settings.quality = (e.target as HTMLSelectElement).value as typeof settings.quality; saveDisplaySettings(settings); });
    dialog.querySelector('#title-motion')?.addEventListener('change', e => { settings.reducedMotion = (e.target as HTMLInputElement).checked; saveDisplaySettings(settings); document.documentElement.dataset.reducedMotion = String(settings.reducedMotion); });
  });
  hud.querySelector('#exit-menu')?.addEventListener('click', () => showChronicleDialog('结束远征', '<p>进度会在行动后自动保存。关闭当前游戏标签页即可退出。</p>'));
  hud.querySelector('#start')?.addEventListener('click', () => {
    if (!onContinue) { onStart(); return; }
    hud.innerHTML = paperSheet(`${paperTitle('开启新的篇章？', 'NEW CHRONICLE')}<p>新游戏将覆盖当前远征存档。</p>${paperMessage('此操作无法在游戏内撤销。', 'warning')}`, paperButton('保留存档', 'new-cancel', true, true) + paperButton('覆盖并开始', 'new-confirm'), '新游戏确认');
    hud.querySelector('#new-confirm')?.addEventListener('click', onStart, { once: true });
    hud.querySelector('#new-cancel')?.addEventListener('click', () => showTitle(onStart, onContinue), { once: true });
  }, { once: true });
  hud.querySelector('#continue')?.addEventListener('click', () => onContinue?.(), { once: true });
}

class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }
  create() {
    const save = loadGame();
    showTitle(async () => {
      clearSave();
      createNewCampaign();
      await playDialogue([
        { speaker: '旁白', portrait: 3, text: '当蚀月遮蔽天空，北境诸国的烽火一夜熄灭。唯有两颗自古老神殿坠落的星，仍在黑暗中燃烧。' },
        { speaker: '莱拉', portrait: 4, text: '哥哥，你守护故乡。我会沿圣所之路寻找让群星复明的方法。' },
        { speaker: '凯尔', portrait: 0, text: '无论相隔多远，同一片星光会指引我们。先从被封锁的星落桥开始。' },
      ]);
      this.scene.start('world');
    }, save ? () => this.scene.start(save.status === 'battle' ? 'battle' : 'world') : undefined);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 640,
  backgroundColor: '#07111c',
  scene: [BootScene, WorldScene, VillageScene, PreparationScene, PixelBattleScene],
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: false, pixelArt: true, roundPixels: true },
});

// Development acceptance harness entry; omitted from production.
if (import.meta.env.DEV) Object.assign(window, { __embers: { game } });
