import type { Feedback } from '../game/encounter';
import type { Pattern, PatternMode, Rule, RunResult } from '../game/types';

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
  /** 헛가드로 현재 보스 패턴의 가드가 막혔으면 true */
  locked: boolean;
  /** 방어 자세가 서 있는 동안의 남은 비율 0~1. 자세가 아니면 0. */
  guardRatio: number;
  /** 자세가 끝난 뒤 경직 중이면 true */
  guardRecovering: boolean;
  labels: { text: string; rule: Rule | 'guard' }[];
}

export interface Hud {
  setPattern(pattern: Pattern): void;
  update(state: HudState): void;
  /** 저스트가드 판정처럼 순간적으로 뜨는 텍스트 */
  flash(feedback: Feedback): void;
  /** 프레임 루프가 죽었을 때 원인을 화면에 남긴다 */
  crash(message: string): void;
  setPaused(paused: boolean): void;
  setCue(show: boolean): void;
  onPause(cb: () => void): void;
  onCueToggle(cb: (show: boolean) => void): void;
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
  const pause = $<HTMLButtonElement>('pause');
  const cue = $<HTMLInputElement>('cue');
  const pausedOverlay = $<HTMLDivElement>('paused');
  const pausedModes = $<HTMLDivElement>('paused-modes');
  const fill = $<HTMLDivElement>('timeline-fill');
  const callout = $<HTMLDivElement>('callout');
  const feedback = $<HTMLDivElement>('feedback');
  const hp = $<HTMLDivElement>('hp');
  const dashFill = $<HTMLDivElement>('dash-fill');
  const guardState = $<HTMLSpanElement>('guard-state');
  const guardFill = $<HTMLDivElement>('guard-fill');
  const result = $<HTMLDivElement>('result');
  const resultTitle = $<HTMLHeadingElement>('result-title');
  const resultDetail = $<HTMLParagraphElement>('result-detail');
  const resultRetry = $<HTMLButtonElement>('result-retry');

  // 상단 드롭다운과 일시정지 화면의 버튼이 같은 동작을 해야 하므로
  // 콜백을 한 곳에 모아두고 양쪽에서 호출한다.
  let selectCallback: ((id: string) => void) | null = null;
  select.addEventListener('change', () => selectCallback?.(select.value));

  for (const p of patterns) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.append(opt);
  }

  /**
   * 일시정지 화면의 모드 선택.
   *
   * 상단 드롭다운과 같은 목록이지만 모드별로 묶어서 크게 보여준다.
   * 연습 중에 "이건 말고 저스트가드를 해보자"가 되는 순간은 대개
   * 멈춰 세운 직후라, 그 자리에서 바로 고를 수 있어야 한다.
   */
  const MODE_LABEL: Record<PatternMode, string> = {
    field: '장판 회피',
    guard: '저스트가드 (대난투)',
  };
  const modeButtons = new Map<string, HTMLButtonElement>();

  for (const mode of ['field', 'guard'] as PatternMode[]) {
    const inMode = patterns.filter((p) => p.mode === mode);
    if (!inMode.length) continue;

    const group = document.createElement('div');
    group.className = 'mode-group';

    const heading = document.createElement('h3');
    heading.textContent = MODE_LABEL[mode];
    group.append(heading);

    for (const p of inMode) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-btn';
      btn.textContent = p.name;
      btn.addEventListener('click', () => selectCallback?.(p.id));
      modeButtons.set(p.id, btn);
      group.append(btn);
    }
    pausedModes.append(group);
  }

  // 매 프레임 DOM을 새로 만들지 않도록 현재 표시 중인 라벨을 기억한다
  let shownLabels = '';
  let shownHp = -1;

  return {
    setPattern(pattern) {
      name.textContent = pattern.name;
      desc.textContent = pattern.description ?? '';
      select.value = pattern.id;
      for (const [id, btn] of modeButtons) {
        btn.classList.toggle('current', id === pattern.id);
      }
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

      // 자세가 서 있는 0.5초를 눈으로 볼 수 있어야 "언제까지 막고 있었는지"를
      // 배운다. 막대가 줄어드는 게 곧 남은 방어 시간이다.
      guardFill.style.width = `${state.guardRatio * 100}%`;
      guardFill.classList.toggle('active', state.guardRatio > 0);

      const guardText = state.locked
        ? '잠김'
        : state.guardRatio > 0
          ? '방어 중'
          : state.guardRecovering
            ? '경직'
            : '준비';
      guardState.textContent = guardText;
      guardState.classList.toggle('locked', state.locked);
      guardState.classList.toggle('active', state.guardRatio > 0);

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

    setPaused(paused) {
      pausedOverlay.classList.toggle('hidden', !paused);
      pause.textContent = paused ? '계속 (P)' : '일시정지 (P)';
    },

    setCue(show) {
      cue.checked = show;
    },

    onPause(cb) {
      pause.addEventListener('click', cb);
    },

    onCueToggle(cb) {
      cue.addEventListener('change', () => cb(cue.checked));
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
        lines.push(
          `저스트가드 ${res.justGuards}/${res.guardTotal} · Excellent ${res.excellents} / Great ${res.greats}`,
        );
        // 자세를 세운 뒤 맞기까지의 평균 시간. 크면 미리 눌러두고 기다린 것이고,
        // 그건 실전에서 연타 2번째를 흘리는 습관으로 이어진다.
        if (res.avgLead !== null) {
          const early = res.avgLead > 220 ? ' — 미리 누르는 습관' : '';
          lines.push(`평균 반응 ${res.avgLead}ms${early}`);
        }
        if (res.whiffs > 0) lines.push(`헛가드 ${res.whiffs}회 — 패턴 잠김`);
      }
      resultDetail.innerHTML = lines.join('<br>');
      result.classList.remove('hidden');
    },

    hideResult() {
      result.classList.add('hidden');
    },

    onSelect(cb) {
      selectCallback = cb;
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
