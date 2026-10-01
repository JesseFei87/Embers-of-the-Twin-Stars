import { musicSettingsMarkup } from '../../audio/BattleMusic';
import type { DisplaySettings } from '../../presentation/DisplaySettings';

export const paperTitle = (title: string, eyebrow = 'EXPEDITION JOURNAL') => `<header class="paper-title"><small>${eyebrow}</small><h2>${title}</h2></header>`;
export const paperMessage = (message: string, kind = '') => `<p class="paper-message ${kind}" role="status">${message}</p>`;
export const paperButton = (label: string, id: string, primary = false, back = false, disabled = false) => `<button class="paper-button ${primary ? 'primary' : ''}" id="${id}" ${back ? 'data-paper-back' : ''} ${disabled ? 'disabled' : ''}>${label}</button>`;
export const paperBook = (left: string, right: string, footer: string, label: string) => `<section class="paper-screen" aria-label="${label}"><div class="paper-book"><div class="paper-page paper-left">${left}</div><div class="paper-page paper-right">${right}</div><footer class="paper-footer">${footer}</footer></div></section>`;
export const paperSheet = (content: string, footer = '', label = '远征消息') => `<section class="paper-screen" aria-label="${label}"><div class="paper-sheet"><div class="paper-sheet-content">${content}</div><footer class="paper-footer">${footer}</footer></div></section>`;
export const paperTabs = (labels: string[], active = 0) => `<nav class="paper-tabs" aria-label="内容栏目">${labels.map((label, index) => `<button data-paper-tab="${index}" aria-pressed="${index === active}">${label}</button>`).join('')}</nav>`;
export const paperPage = (index: number, content: string, active = 0) => `<div data-paper-page="${index}" ${index === active ? '' : 'hidden'}>${content}</div>`;

export function settingsPages(settings: DisplaySettings, title = false) {
  const qualityId = title ? 'title-quality' : 'render-quality';
  const toggle = (key: keyof DisplaySettings, label: string) => `<label class="paper-setting"><span>${label}</span><input type="checkbox" ${title ? 'id="title-motion"' : `data-render-setting="${key}"`} ${settings[key] ? 'checked' : ''}></label>`;
  const left = `${paperTitle('系统设置', 'FIELD MANUAL')}<p>让旅途以舒适的方式展开。</p>${paperTabs(['画面', '声音', '辅助'])}<p class="paper-muted">调整即时生效。<br>关闭后返回原来的界面。</p>`;
  const quality = `<label class="paper-setting"><span>画面品质</span><select id="${qualityId}">${(['low', 'medium', 'high'] as const).map((q, i) => `<option value="${q}" ${settings.quality === q ? 'selected' : ''}>${['流畅', '均衡', '精细'][i]}</option>`).join('')}</select></label><p class="paper-muted">流畅档关闭实时阴影和后处理，保留完整玩法。</p>`;
  const atmosphere = `<label class="paper-setting">光照<select id="render-time">${(['map', 'day', 'night'] as const).map((v, i) => `<option value="${v}" ${settings.timeOfDay === v ? 'selected' : ''}>${['随地图', '日光', '月夜'][i]}</option>`).join('')}</select></label><label class="paper-setting">天气<select id="render-weather">${(['clear', 'rain', 'snow'] as const).map((v, i) => `<option value="${v}" ${settings.weather === v ? 'selected' : ''}>${['晴朗', '细雨', '落雪'][i]}</option>`).join('')}</select></label>${([['fog', '远景雾'], ['mist', '低空薄雾'], ['bloom', '柔和辉光'], ['dof', '景深 · 高画质'], ['particles', '环境粒子']] as Array<[keyof DisplaySettings, string]>).map(([key, label]) => toggle(key, label)).join('')}`;
  const right = paperPage(0, `${paperTitle('画面', 'DISPLAY')}${quality}${title ? paperMessage('天气、光照与环境细节在战场设置中调整。') : atmosphere}`) + paperPage(1, `${paperTitle('声音', 'AUDIO')}${musicSettingsMarkup()}<p class="paper-muted">音量为 0 时静音，设置在主菜单与战场之间共用。</p>`) + paperPage(2, `${paperTitle('辅助', 'ACCESSIBILITY')}${toggle('reducedMotion', '减少动态效果')}${title ? '' : toggle('shake', '镜头震动') + toggle('flashes', '受击闪光')}<h3>鼠标与键盘</h3><p>拖动平移 · 右键拖动旋转<br>滚轮缩放 · Esc 返回</p><p class="paper-muted">按键自定义 · 待开放</p>`);
  return { left, right };
}

export function installParchmentInteractions() {
  document.documentElement.dataset.input = 'pointer';
  document.addEventListener('pointerdown', () => { document.documentElement.dataset.input = 'pointer'; }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Tab' || event.key.startsWith('Arrow')) document.documentElement.dataset.input = 'keyboard'; }, true);
  document.addEventListener('click', event => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-paper-tab]');
    if (!tab) return;
    const book = tab.closest('.paper-book');
    book?.querySelectorAll<HTMLButtonElement>('[data-paper-tab]').forEach(button => button.setAttribute('aria-pressed', String(button === tab)));
    book?.querySelectorAll<HTMLElement>('[data-paper-page]').forEach(page => { page.hidden = page.dataset.paperPage !== tab.dataset.paperTab; });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    const back = document.querySelector<HTMLButtonElement>('#hud .paper-screen [data-paper-back]');
    if (back && !back.disabled) { event.preventDefault(); event.stopImmediatePropagation(); back.click(); }
  }, true);
}
