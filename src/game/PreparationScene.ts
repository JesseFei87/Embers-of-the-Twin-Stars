import Phaser from 'phaser';
import { attackSpells, classes, healingSpells, maxHp, type Unit } from './state';
import { chapters } from './data/chapters';
import { itemDescription, itemName } from './data/items';
import { spellLearning } from './data/spellLearning';
import { statLabels } from './rules/progression';
import { beginBattle, ensureCampaign } from './save';
import { characterNotes } from './ui/portraits';

import { mapSpriteMarkup, portraitUrl, cutoutPortraitUrl, showChronicleDialog } from './ui/replica';

const hud = document.querySelector<HTMLDivElement>('#hud')!;

export class PreparationScene extends Phaser.Scene {
  private chapterId = 'starfall-bridge';
  private roster: Unit[] = [];
  private inventory: string[] = [];
  private selected = new Set<string>();
  private order: string[] = [];
  private equipment = new Map<string, string>();
  private attackMagic = new Map<string, string>();
  private healingMagic = new Map<string, string>();
  private focusedId = '';
  private fromTitle = false;
  private fromStaging = false;
  private readOnly = false;
  private onReturn?: () => void;
  private suppliedRoster?: Unit[];

  constructor() { super('preparation'); }

  init(data: { chapterId?: string; fromTitle?: boolean; fromStaging?: boolean; readOnly?: boolean; roster?: Unit[]; onReturn?: () => void }) { this.chapterId = data.chapterId ?? ensureCampaign().activeChapterId; this.fromTitle = !!data.fromTitle; this.fromStaging = !!data.fromStaging; this.readOnly = !!data.readOnly; this.onReturn = data.onReturn; this.suppliedRoster = data.roster; }

  create() {
    this.equipment.clear(); this.attackMagic.clear(); this.healingMagic.clear();
    const save = ensureCampaign(); const chapter = chapters[this.chapterId];
    this.roster = (this.suppliedRoster ?? save.roster).map(unit => structuredClone(unit)); this.inventory = [...save.inventory];
    this.order = this.fromStaging
      ? (save.battleUnits ?? []).filter(unit => unit.team === 'player').map(unit => unit.id)
      : this.roster.slice(0, chapter.maxSortie).map(unit => unit.id);
    this.selected = new Set(this.order);
    this.focusedId = this.roster[0]?.id ?? '';
    this.roster.forEach(unit => { if (unit.itemId) this.equipment.set(unit.id, unit.itemId); if (unit.activeSpellId) this.attackMagic.set(unit.id, unit.activeSpellId); if (unit.activeHealingSpellId) this.healingMagic.set(unit.id, unit.activeHealingSpellId); });
    this.cameras.main.setBackgroundColor('#06111a');
    const g = this.add.graphics(); g.fillGradientStyle(0x102c35, 0x102c35, 0x050b13, 0x050b13, 1).fillRect(0, 0, 960, 640);
    this.render();
  }

  private itemPool() { return [...this.inventory, ...this.roster.map(unit => unit.itemId).filter((id): id is string => !!id)]; }

  private render(message = '') {
    const chapter = chapters[this.chapterId]; const pool = this.itemPool();
    const itemOptions = (unit: Unit) => ['<option value="">无装备</option>', ...[...new Set(pool)].map(id => `<option value="${id}" ${this.equipment.get(unit.id) === id ? 'selected' : ''}>${itemName(id)}</option>`)].join('');
    const spellOptions = (unit: Unit, healing: boolean) => {
      const source = healing ? healingSpells : attackSpells; const active = healing ? this.healingMagic.get(unit.id) : this.attackMagic.get(unit.id);
      return ['<option value="">无</option>', ...unit.spells.filter(id => source[id]).map(id => `<option value="${id}" ${active === id ? 'selected' : ''}>${source[id].name} · HP${source[id].hpCost} · ${source[id].minRange}-${source[id].maxRange}</option>`)].join('');
    };
    const focused = this.roster.find(unit => unit.id === this.focusedId) ?? this.roster[0];
    const rows = Array.from({ length: Math.max(6, this.roster.length) }, (_, index) => {
      const unit = this.roster[index];
      if (!unit) return `<div class="roster-row vacant"><span>${index + 1}</span><b>尚未结识</b><small>等待新的星光</small></div>`;
      return `<div class="roster-row ${unit.id === focused.id ? 'focused' : ''}"><button data-inspect="${unit.id}" aria-pressed="${unit.id === focused.id}"><span class="roster-number">${index + 1}</span>${mapSpriteMarkup(unit)}<strong>${unit.name}</strong><span class="roster-level">Lv.${unit.level}</span><span class="roster-class">${classes[unit.class].name}</span></button><label class="sortie-check" title="选择出击"><input type="checkbox" data-sortie="${unit.id}" aria-label="${unit.name}出击" ${this.selected.has(unit.id) ? 'checked' : ''} ${this.readOnly ? 'disabled' : ''}></label></div>`;
    }).join('');
    const stats = [['等级', focused.level], ['生命', `${focused.hp} / ${maxHp(focused)}`], ['魔法', '消耗生命'], ...Object.entries(focused.stats).filter(([key]) => key !== 'maxHp').map(([key, value]) => [statLabels[key as keyof Unit['stats']], value])];
    const knownMagic = focused.spells.map(id => attackSpells[id]?.name ?? healingSpells[id]?.name ?? id).join('、') || '尚未习得';
    const nextMagic = (spellLearning[focused.id] ?? []).find(entry => entry.level > focused.level && !focused.spells.includes(entry.spellId));
    const positions = [[744,742],[706,681],[671,796],[841,716],[603,739],[854,790]];
    const board = this.order.map((id,index) => {
      const unit = this.roster.find(candidate => candidate.id === id)!; const [x,y] = positions[index % positions.length];
      return `<button class="formation-piece ${id === focused.id ? 'focused' : ''}" style="left:${x}px;top:${y}px" data-inspect="${id}" aria-label="部署位 ${index + 1} ${unit.name}">${mapSpriteMarkup(unit)}<span>${index + 1}</span></button>`;
    }).join('');
    const index = this.order.indexOf(focused.id);
    const cutout = cutoutPortraitUrl(focused);
    hud.innerHTML = `<section class="prep-screen replica-prep" aria-label="编队与角色"><div class="replica-stage formation-plate">
      <h2 class="visually-hidden">编队与角色</h2><div class="replica-roster">${rows}</div>
      <div class="dossier-heading"><h3>${focused.name}</h3><p>${classes[focused.class].name}，亦是守护的光。</p></div>
      <img class="replica-bust ${cutout ? 'cutout' : ''}" src="${cutout ?? portraitUrl(focused)}" alt="${focused.name}立绘">
      <div class="dossier-cover" style="background-image:url('${portraitUrl(focused)}')" hidden></div>
      <p class="dossier-quote">${characterNotes[focused.id] ?? focused.title}</p>
      ${mapSpriteMarkup(focused, 'dossier-sprite', `${focused.name}战场形象`)}
      <div class="dossier-level">Lv. <b>${focused.level}</b><label>经验值 <span>${focused.exp} / 100</span><progress value="${focused.exp}" max="100"></progress></label></div>
      <div class="dossier-class"><p>职业 <b>${classes[focused.class].name}</b></p><p>阵营 <b>北境同盟</b></p></div>
      <div class="replica-attributes">${stats.map(([label,value])=>`<div><span>${label}</span><b>${value}</b></div>`).join('')}</div>
      <div class="replica-equipment"><label>装备 <select data-item="${focused.id}" title="${itemDescription(this.equipment.get(focused.id))}" ${this.readOnly ? 'disabled' : ''}>${itemOptions(focused)}</select></label><label>攻击 <select data-attack="${focused.id}" ${this.readOnly ? 'disabled' : ''}>${spellOptions(focused,false)}</select></label><label>回复 <select data-heal="${focused.id}" ${this.readOnly ? 'disabled' : ''}>${spellOptions(focused,true)}</select></label></div>
      <p class="dossier-story">${characterNotes[focused.id] ?? focused.title}<br><small>${this.readOnly ? '战斗进行中 · 装备与阵型仅供查阅' : '勾选同伴出击，选择部署位调整顺序。'}</small></p>
      <span class="formation-count">出击 ${this.selected.size} / ${chapter.maxSortie}</span>${board}
      <div class="formation-actions"><button id="formation-reorder">更换<small>CHANGE</small></button><button id="formation-equipment">装备<small>EQUIPMENT</small></button><button id="formation-skills">技能<small>SKILLS</small></button><button id="formation-support">支援<small>待开放</small></button></div>
      <div class="prep-message" role="status">${message}</div><button id="prep-back" class="replica-back">返回${this.onReturn || this.fromStaging ? '战场' : this.fromTitle ? '主菜单' : '世界地图'}</button><button class="replica-confirm" id="start-battle">${this.readOnly ? '返回远征' : '确认编队'}<small>CONFIRM</small></button>
    </div></section>`;
    hud.querySelector('#formation-equipment')?.addEventListener('click', () => hud.querySelector<HTMLSelectElement>('[data-item]')?.focus());
    hud.querySelector('#formation-skills')?.addEventListener('click', () => showChronicleDialog(`${focused.name} · 技能`, `<p>已学魔法：${knownMagic}</p><p>${nextMagic ? `Lv.${nextMagic.level} 习得 ${attackSpells[nextMagic.spellId]?.name ?? healingSpells[nextMagic.spellId]?.name}` : '暂无新的等级魔法'}</p><p>魔法消耗生命；攻击与回复魔法可在装备栏切换。</p>`));
    hud.querySelector('#formation-support')?.addEventListener('click', () => showChronicleDialog('同伴支援', '<p>羁绊对话与支援效果 · 待开放</p>'));
    hud.querySelector('#formation-reorder')?.addEventListener('click', () => {
      if (this.readOnly) { showChronicleDialog('当前阵型', '<p>战斗进行中，无法重新部署。</p>'); return; }
      const dialog = showChronicleDialog('调整出击顺序', `<p>${focused.name} · ${index < 0 ? '未选择出击' : `当前部署位 ${index + 1}`}</p><button class="small-btn" data-reorder="-1" ${index <= 0 ? 'disabled' : ''}>前移一位</button><button class="small-btn" data-reorder="1" ${index < 0 || index >= this.order.length - 1 ? 'disabled' : ''}>后移一位</button>`);
      dialog.querySelectorAll<HTMLButtonElement>('[data-reorder]').forEach(button => button.addEventListener('click', () => { dialog.close(); this.reorder(focused.id, Number(button.dataset.reorder)); }));
    });
    hud.querySelectorAll<HTMLInputElement>('[data-sortie]').forEach(input => input.addEventListener('change', () => this.toggleSortie(input.dataset.sortie!, input.checked)));
    hud.querySelectorAll<HTMLSelectElement>('[data-item]').forEach(select => select.addEventListener('change', () => { this.equipment.set(select.dataset.item!, select.value); this.render(); }));
    hud.querySelectorAll<HTMLSelectElement>('[data-attack]').forEach(select => select.addEventListener('change', () => { this.attackMagic.set(select.dataset.attack!, select.value); this.render(); }));
    hud.querySelectorAll<HTMLSelectElement>('[data-heal]').forEach(select => select.addEventListener('change', () => { this.healingMagic.set(select.dataset.heal!, select.value); this.render(); }));
    hud.querySelectorAll<HTMLButtonElement>('[data-up]').forEach(button => button.addEventListener('click', () => this.reorder(button.dataset.up!, -1)));
    hud.querySelectorAll<HTMLButtonElement>('[data-down]').forEach(button => button.addEventListener('click', () => this.reorder(button.dataset.down!, 1)));
    hud.querySelectorAll<HTMLButtonElement>('[data-inspect]').forEach(button => button.addEventListener('click', () => { this.focusedId = button.dataset.inspect!; this.render(); }));
    hud.querySelector('#prep-back')?.addEventListener('click', () => this.returnToScene());
    hud.querySelector('#start-battle')?.addEventListener('click', () => this.startBattle());
  }

  private toggleSortie(id: string, checked: boolean) {
    const chapter = chapters[this.chapterId];
    if (checked && this.selected.size >= chapter.maxSortie) { this.render(`最多出击 ${chapter.maxSortie} 人`); return; }
    if (checked) { this.selected.add(id); this.order.push(id); } else { this.selected.delete(id); this.order = this.order.filter(unitId => unitId !== id); }
    this.render();
  }

  private reorder(id: string, direction: number) {
    const index = this.order.indexOf(id), target = index + direction; if (index < 0 || target < 0 || target >= this.order.length) return;
    [this.order[index], this.order[target]] = [this.order[target], this.order[index]]; this.render();
  }

  private returnToScene() {
    hud.innerHTML = '';
    if (this.onReturn) { const callback = this.onReturn; this.scene.stop(); callback(); }
    else if (this.fromStaging) this.scene.start('battle', { staging:true });
    else this.scene.start(this.fromTitle ? 'boot' : 'world');
  }

  private startBattle() {
    if (this.readOnly) { this.returnToScene(); return; }
    const chapter = chapters[this.chapterId];
    if (!this.selected.size) { this.render('至少选择一名出击角色'); return; }
    if (!this.selected.has(chapter.mission.leaderId)) { this.render('主角凯尔必须出击'); return; }
    const poolCounts = new Map<string, number>(); this.itemPool().forEach(id => poolCounts.set(id, (poolCounts.get(id) ?? 0) + 1));
    const used = new Map<string, number>(); this.roster.forEach(unit => { const id = this.equipment.get(unit.id); if (id) used.set(id, (used.get(id) ?? 0) + 1); });
    if ([...used].some(([id, count]) => count > (poolCounts.get(id) ?? 0))) { this.render('同一件装备不能分配给多名角色'); return; }
    const roster = this.roster.map(unit => ({ ...unit, itemId: this.equipment.get(unit.id) || undefined, activeSpellId: this.attackMagic.get(unit.id) || undefined, activeHealingSpellId: this.healingMagic.get(unit.id) || undefined }));
    const remaining = [...poolCounts]; const inventory: string[] = [];
    for (const [id, count] of remaining) for (let i = 0; i < count - (used.get(id) ?? 0); i++) inventory.push(id);
    const deployed = this.order.map((id, index) => {
      const unit = structuredClone(roster.find(candidate => candidate.id === id)!); Object.assign(unit, chapter.deployment[index], { acted: false }); return unit;
    });
    beginBattle(this.chapterId, roster, deployed, inventory); hud.innerHTML = ''; this.scene.start('battle', { staging:true });
  }
}
