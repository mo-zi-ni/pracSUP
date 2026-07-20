import type { Feedback } from '../game/encounter';
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
  /** 헛가드 경직 중이면 true */
  locked: boolean;
  labels: { text: string; rule: Rule | 'guard' }[];
}

export interface Hud {
  setPattern(pattern: Pattern): void;
  update(state: HudState): void;
  /** 저스트가드 판정처럼 순간적으로 뜨는 텍스트 */
  flash(feedback: Feedback): void;
  /** 프레임 루프가 죽었을 때 원인을 화면에 남긴다 */
  crash(message: string): void;
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
  const feedback = $<HTMLDivElement>('feedback');
  const hp = $<HTMLDivElement>('hp');
  const dashFill = $<HTMLDivElement>('dash-fill');
  const guardState = $<HTMLSpanElement>('guard-state');
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
      guardState.textContent = state.locked ? '경직' : '준비';
      guardState.classList.toggle('locked', state.locked);

      const key = state.labels.map((l) => `${l.rule}:${l.text}`).join('|');
      if (key !== shownLabels) {
        callout.replaceChildren(
          ...state.labels.map((l) => {
            const el = document.createElement('div');
            el.className =
              l.rule === 'guard' ? 'call guard' : l.rule === 'stand' ? 'call safe' : 'call';
            el.textContent = l.text;
            return el;
          }),
        );
        shownLabels = key;
      }
    },

    flash(fb) {
      const el = document.createElement('div');
      el.className = `fb ${fb.tone}`;
      el.textContent = fb.text;
      feedback.append(el);
      // 애니메이션이 끝나면 스스로 사라진다. reduced-motion에서도 확실히 지우려고
      // animationend가 아니라 타이머를 쓴다.
      setTimeout(() => el.remove(), 700);
    },

    crash(message) {
      let box = document.getElementById('crash');
      if (!box) {
        box = document.createElement('pre');
        box.id = 'crash';
        document.getElementById('app')?.append(box);
      }
      box.textContent = `프레임 루프 중단\n\n${message}`;
    },

    showResult(res) {
      const perfect = res.cleared && res.hits === 0;
      resultTitle.textContent = perfect ? '무피격 클리어' : res.cleared ? '클리어' : '전멸';
      resultTitle.style.color = perfect ? '#49e08a' : res.cleared ? '#e8ecf8' : '#ff4d5e';

      const lines = [`피격 ${res.hits}회 · ${(res.elapsed / 1000).toFixed(1)}초`];
      if (res.guardTotal > 0) {
        // 평균 오차가 한쪽으로 치우쳐 있으면 그게 교정 포인트다
        const drift =
          res.avgOffset === null
            ? ''
            : ` · 평균 ${res.avgOffset > 0 ? '+' : ''}${res.avgOffset}ms${
                res.avgOffset < -15 ? ' (이름)' : res.avgOffset > 15 ? ' (늦음)' : ''
              }`;
        lines.push(`저스트가드 ${res.justGuards}/${res.guardTotal}${drift}`);
      }
      resultDetail.innerHTML = lines.join('<br>');
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
