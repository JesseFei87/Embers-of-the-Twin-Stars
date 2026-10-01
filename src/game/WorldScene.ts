import Phaser from 'phaser';
import { chapters, isChapterAvailable } from './data/chapters';
import { applyPromotion, promotionFor, promotionGains } from './data/promotions';
import { statLabels } from './rules/progression';
import { classes, type Unit } from './state';
import { ensureCampaign, saveWorldPosition, selectChapter, updateRosterUnit, visitWorldNode } from './save';
import { paperBook, paperSheet, paperTitle, paperMessage, paperButton } from './ui/parchment';
import { portraitMarkup } from './ui/replica';
import { playDialogue } from './ui/dialogue';
import { RoadNavigator, worldNodes as nodes, type WorldNode } from './world/RoadNetwork';
import { WorldMapView } from './world/WorldMapView';

const hud = document.querySelector<HTMLDivElement>('#hud')!;
export class WorldScene extends Phaser.Scene {
  private navigator!: RoadNavigator;
  private view?: WorldMapView;
  private selectedNode?: WorldNode;
  private nearby?: WorldNode;
  private dismissedNode?: string;
  private modal = false;
  private loading = true;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private uiStamp = '';
  constructor() { super('world'); }
  create() {
    this.modal = false; this.loading = true; this.selectedNode = undefined; this.nearby = undefined; this.dismissedNode = undefined; this.uiStamp = '';
    this.cameras.main.setVisible(false);
    this.navigator = new RoadNavigator(ensureCampaign().worldPosition ?? nodes[0]);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,ENTER,SPACE,ESC') as Record<string, Phaser.Input.Keyboard.Key>;
    const view = new WorldMapView(node => this.travelTo(node)); this.view = view;
    hud.innerHTML = paperSheet(`${paperTitle('铺展开北境的旅图', 'THE NORTHERN REALMS')}<p>正在载入海岸、山林与城镇……</p>${paperMessage('正在准备地图，请稍候。')}`);
    void view.mount(document.querySelector('#game')!).then(() => {
      if (this.view !== view) return; this.loading = false; this.nearby = this.navigator.nearby(); this.renderWorld();
    }).catch(error => { if (this.view === view) this.showLoadFailure(error instanceof Error ? error.message : '大地图加载失败'); });
    this.events.once('shutdown', () => {
      saveWorldPosition(this.navigator.position.x, this.navigator.position.y); this.view = undefined; view.dispose();
      this.input.keyboard?.removeCapture('W,A,S,D,UP,DOWN,LEFT,RIGHT,ENTER,SPACE,ESC');
    });
  }
  private showLoadFailure(message: string) {
    this.loading = true;
    hud.innerHTML = paperSheet(`${paperTitle('旅图暂未展开')}<p id="world-load-error"></p>${paperMessage('队伍、章节与地图位置均已保留。')}`, paperButton('重新载入地图', 'world-retry', true));
    hud.querySelector('#world-load-error')!.textContent = message;
    hud.querySelector('#world-retry')?.addEventListener('click', () => this.scene.restart(), { once: true });
  }
  private isUnlocked(node: WorldNode) {
    return node.id === 'village' || node.id === 'shrine' || isChapterAvailable(node.id, ensureCampaign().unlockedChapterIds);
  }
  private travelTo(node: WorldNode) {
    if (this.modal || this.loading) return;
    this.dismissedNode = undefined; this.selectedNode = node; this.navigator.travelTo(node.id); this.renderWorld();
  }
  update(_time: number, delta: number) {
    if (this.loading) return;
    if (!this.modal) {
      const k = this.keys;
      const dx = Number(k.D.isDown || k.RIGHT.isDown) - Number(k.A.isDown || k.LEFT.isDown);
      const dy = Number(k.S.isDown || k.DOWN.isDown) - Number(k.W.isDown || k.UP.isDown);
      if ((dx || dy) && !this.navigator.moving) { this.selectedNode = undefined; this.dismissedNode = undefined; this.navigator.direction(dx, dy); }
      const wasMoving = this.navigator.moving;
      this.navigator.update(delta / 1000); this.nearby = this.navigator.nearby();
      if (wasMoving && !this.navigator.moving) saveWorldPosition(this.navigator.position.x, this.navigator.position.y);
      const stamp = `${this.selectedNode?.id}:${this.nearby?.id}:${this.navigator.moving}`;
      if (stamp !== this.uiStamp) { this.uiStamp = stamp; this.renderWorld(); }
      if (Phaser.Input.Keyboard.JustDown(k.ESC)) this.dismiss();
      if (Phaser.Input.Keyboard.JustDown(k.ENTER) || Phaser.Input.Keyboard.JustDown(k.SPACE)) void this.enterNode();
    }
    this.view?.update(delta / 1000, this.navigator.position, this.navigator.moving, this.navigator.facingLeft, this.selectedNode?.id);
  }
  private dismiss() {
    this.dismissedNode = this.nearby?.id; this.selectedNode = undefined; this.navigator.stop();
    saveWorldPosition(this.navigator.position.x, this.navigator.position.y); this.renderWorld();
  }
  private renderWorld() {
    const save = ensureCampaign(), node = this.selectedNode ?? (this.nearby?.id === this.dismissedNode ? undefined : this.nearby);
    const arrived = !!node && node.id === this.nearby?.id && !this.navigator.moving;
    const mainClears = ['starfall-bridge', 'moonlit-pass'].filter(id => save.completedChapterIds.includes(id)).length;
    const count = node ? save.encounterWins?.[node.id] ?? 0 : 0;
    hud.innerHTML = `<section class="world-map-ui" aria-label="北境旅行地图">
      <header class="world-heading world-paper"><small>THE NORTHERN REALMS · 北境诸国</small><h1>群星指引之地</h1><p>双星远征 <i>✧</i> 主线 ${mainClears} / 2</p></header>
      <div class="world-compass" aria-hidden="true">N<br>✧</div>
      ${node ? `<aside class="world-destination world-paper"><small>${node.kind}</small><h2>${node.label}</h2>${node.enemy ? `<div class="world-enemy-preview"><img src="/assets/hd2d/${node.enemy}/01.png" alt="${node.label}的代表敌人"><span>${chapters[node.id]?.repeatable ? `${node.enemy === 'mossling' ? '苔灯灵' : '潮壳蟹'} × 3<br>已讨伐 ${count} 次` : '前方有敌军驻守'}</span></div>` : ''}<p>${node.text}</p><div class="world-status" role="status">${!this.isUnlocked(node) ? '尚未开放 · 完成月影峡道后开放' : arrived ? '已抵达 · 等待你的指令' : '沿道路前往目的地…'}</div><button id="world-enter" ${!arrived || !this.isUnlocked(node) ? 'disabled' : ''}>${chapters[node.id]?.repeatable ? '挑战魔物 · 战前整备' : chapters[node.id] ? '进入战役 · 战前整备' : '确认进入'} <span>↵</span></button><button id="world-cancel">${this.navigator.moving ? '停步查看地图' : '收起旅记'}</button></aside>` : ''}
      <footer class="world-dock world-paper"><div class="world-party"><img src="/assets/hd2d/sword/01.png" alt="队长凯尔"><div><b>双星远征队</b><small>点击地名沿路行走 · Enter 进入<br>WASD / 方向键沿路选择方向 · Esc 停步</small></div></div><nav aria-label="地图目的地">${nodes.map(n => `<button data-world-node="${n.id}" class="${node?.id === n.id ? 'active' : ''}"><span>${n.icon}</span>${n.label}</button>`).join('')}</nav></footer>
    </section>`;
    hud.querySelectorAll<HTMLButtonElement>('[data-world-node]').forEach(button => button.addEventListener('click', () => this.travelTo(nodes.find(n => n.id === button.dataset.worldNode)!)));
    hud.querySelector('#world-enter')?.addEventListener('click', () => void this.enterNode());
    hud.querySelector('#world-cancel')?.addEventListener('click', () => this.dismiss());
  }
  private async enterNode() {
    const node = this.selectedNode ?? this.nearby;
    if (this.modal || !node || node.id !== this.nearby?.id || this.navigator.moving || !this.isUnlocked(node)) return;
    this.modal = true; saveWorldPosition(this.navigator.position.x, this.navigator.position.y);
    const chapter = chapters[node.id];
    if (chapter) {
      const completed = ensureCampaign().completedChapterIds.includes(node.id); selectChapter(chapter.id);
      if (!completed && !chapter.repeatable) await playDialogue(chapter.intro);
      this.scene.start('preparation', { chapterId: chapter.id });
    } else if (node.id === 'village') this.scene.start('village');
    else this.showWorldEvent(node.id as 'shrine' | 'ashen-frontier');
  }

  private showWorldEvent(id: 'shrine' | 'ashen-frontier') {
    if (id === 'ashen-frontier') {
      hud.innerHTML = paperSheet(`${paperTitle('灰烬边境', 'NEXT CHAPTER')}<p>双星的队伍已经抵达北境尽头。</p>${paperMessage('第三章 · 尚未开放')}`, paperButton('返回世界地图', 'world-return', true, true));
      hud.querySelector('#world-return')?.addEventListener('click', () => this.scene.restart(), { once: true });
      return;
    }
    const result = visitWorldNode(id);
    this.showShrine(result.save, result.firstVisit ? '神殿星光已恢复全队生命。' : '群星仍在回应远征者。');
  }

  private showShrine(save: ReturnType<typeof ensureCampaign>, message: string, selectedId = save.roster[0]?.id) {
    const selected = save.roster.find(unit => unit.id === selectedId);
    const promotion = selected && promotionFor(selected);
    const eligible = !!selected && !!promotion && selected.level >= promotion.minLevel;
    const rows = save.roster.map(unit => `<button class="paper-roster-row ${unit.id === selectedId ? 'active' : ''}" data-shrine-select="${unit.id}" aria-pressed="${unit.id === selectedId}">${portraitMarkup(unit)}<span><b>${unit.name}</b><small>Lv.${unit.level} ${classes[unit.class].name}</small></span></button>`).join('');
    const right = selected ? `${paperTitle(selected.name, 'CHOOSE YOUR PATH')}${portraitMarkup(selected)}<p class="paper-center">${classes[selected.class].name}${promotion ? ` → ${classes[promotion.to].name}` : ''}</p>${paperMessage(!promotion ? '已完成最终转职' : eligible ? '已满足转职条件，可查看能力变化。' : `等级不足 · 达到 Lv.${promotion.minLevel} 后可转职`, eligible ? 'success' : '')}` : paperMessage('暂无同行的伙伴。');
    hud.innerHTML = paperBook(`${paperTitle('群星神殿', 'SANCTUARY')}${paperMessage(message, 'success')}<div class="paper-roster">${rows}</div>`, right, paperButton('返回世界地图', 'world-return', false, true) + paperButton('查看转职预览', 'shrine-preview', true, false, !eligible), '群星神殿');
    hud.querySelectorAll<HTMLButtonElement>('[data-shrine-select]').forEach(button => button.addEventListener('click', () => this.showShrine(save, message, button.dataset.shrineSelect)));
    hud.querySelector('#shrine-preview')?.addEventListener('click', () => { if (selected && eligible) this.showShrinePromotion(selected); });
    hud.querySelector('#world-return')?.addEventListener('click', () => this.scene.restart(), { once: true });
  }

  private showShrinePromotion(unit: Unit) {
    const promotion = promotionFor(unit); if (!promotion || unit.level < promotion.minLevel) return;
    const gains = promotionGains(unit, promotion);
    const comparison = Object.entries(unit.stats).map(([key, value]) => {
      const gain = gains[key as keyof Unit['stats']] ?? 0;
      return `<tr><th scope="row">${statLabels[key as keyof Unit['stats']]}</th><td>${value}</td><td>${value + gain}</td><td>${gain ? `+${gain}` : '—'}</td></tr>`;
    }).join('');
    hud.innerHTML = paperBook(`${paperTitle(unit.name, 'CLASS CHANGE')}${portraitMarkup(unit)}<p class="paper-center">${classes[unit.class].name} → ${classes[promotion.to].name}</p>`, `${paperTitle('转职预览')}<table class="paper-comparison"><thead><tr><th>能力</th><th>当前</th><th>转职后</th><th>提升</th></tr></thead><tbody>${comparison}</tbody></table>${paperMessage('转职后等级重置为 Lv.1，装备与已学魔法保留。')}`, paperButton('取消转职', 'shrine-cancel', false, true) + paperButton('确认转职', 'shrine-confirm', true), '转职预览');
    hud.querySelector('#shrine-cancel')?.addEventListener('click', () => this.showShrine(ensureCampaign(), '尚未进行转职。', unit.id), { once: true });
    hud.querySelector('#shrine-confirm')?.addEventListener('click', () => {
      const from = classes[unit.class].name; applyPromotion(unit, promotion); const save = updateRosterUnit(unit);
      this.showShrine(save, `${unit.name}完成转职：${from} → ${classes[unit.class].name}`, unit.id);
    }, { once: true });
  }
}
