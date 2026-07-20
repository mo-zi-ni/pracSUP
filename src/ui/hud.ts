import type { Pattern, Rule, RunResult } from '../game/types';

/**
 * HUD. 3D 위에 얹는 DOM 오버레이 — 캔버스에 텍스트를 그리는 것보다
 * 훨씬 다루기 쉽고, 화면 크기 대응도 CSS가 알아서 해준다.
 */

export interface HudState {
  time: number;
  duration: number;
  hp: number;
  maxHp: number;
  /** 대시 충전 비율 0~1 */
  dashRatio: number;
  labels: { text: string; rule: Rule }[];
}

export interface Hud {
  setPattern(pattern: Pattern): void;
  update(state: HudState): void;
  showResult(result: RunResult): void;
  hideResult(): void;
  onSelect(cb: (id: string) => void): void;
  onRestart(cb: () => void): void;
  /** 재생 속도 0.25~1.0 */
  onSpeed(cb: (scale: number) => void): void;
}

export function createHud(patterns: Pattern[]): Hud {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  const name = $<HTMLHeadingElement>('pattern-name');
  const desc = $<HTMLParagraphElement>('pattern-desc');
  const select = $<HTMLSelectElement>('pattern-select');
  const speed = $<HTMLInputElement>('speed');
  const speedOut = $<HTMLOutputElement>('speed-out');
  const restart = $<HTMLButtonElement>('restart');
  const fill = $<HTMLDivElement>('timeline-fill');
  const callout = $<HTMLDivElement>('callout');
  const hp = $<HTMLDivElement>('hp');
  const dashFill = $<HTMLDivElement>('dash-fill');
  const result = $<HTMLDivElement>('result');
  const resultTitle = $<HTMLHeadingElement>('result-title');
  const resultDetail = $<HTMLParagraphElement>('result-detail');
  const resultRetry = $<HTMLButtonElement>('result-retry');

  for (const p of patterns) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.append(opt);
  }

  // 매 프레임 DOM을 새로 만들지 않도록 현재 표시 중인 라벨을 기억한다
  let shownLabels = '';
  let shownHp = -1;

  return {
    setPattern(pattern) {
      name.textContent = pattern.name;
      desc.textContent = pattern.description ?? '';
      select.value = pattern.id;
      shownHp = -1;
      shownLabels = '';
    },

    update(state) {
      fill.style.width = `${Math.min(100, (state.time / state.duration) * 100)}%`;

      if (state.hp !== shownHp) {
        hp.replaceChildren(
          ...Array.from({ length: state.maxHp }, (_, i) => {
            const pip = document.createElement('div');
            pip.className = i < state.hp ? 'pip' : 'pip lost';
            return pip;
          }),
        );
        shownHp = state.hp;
      }

      dashFill.style.width = `${state.dashRatio * 100}%`;
      dashFill.classList.toggle('ready', state.dashRatio >= 1);

      const key = state.labels.map((l) => `${l.rule}:${l.text}`).join('|');
      if (key !== shownLabels) {
        callout.replaceChildren(
          ...state.labels.map((l) => {
            const el = document.createElement('div');
            el.className = l.rule === 'stand' ? 'call safe' : 'call';
            el.textContent = l.text;
            return el;
          }),
        );
        shownLabels = key;
      }
    },

    showResult(res) {
      const perfect = res.cleared && res.hits === 0;
      resultTitle.textContent = perfect ? '무피격 클리어' : res.cleared ? '클리어' : '전멸';
      resultTitle.style.color = perfect ? '#49e08a' : res.cleared ? '#e8ecf8' : '#ff4d5e';
      resultDetail.textContent = `피격 ${res.hits}회 · 장판 ${res.totalCasts}개 · ${(res.elapsed / 1000).toFixed(1)}초`;
      result.classList.remove('hidden');
    },

    hideResult() {
      result.classList.add('hidden');
    },

    onSelect(cb) {
      select.addEventListener('change', () => cb(select.value));
    },

    onRestart(cb) {
      restart.addEventListener('click', cb);
      resultRetry.addEventListener('click', cb);
    },

    onSpeed(cb) {
      speed.addEventListener('input', () => {
        const pct = Number(speed.value);
        speedOut.textContent = `${pct}%`;
        cb(pct / 100);
      });
    },
  };
}
