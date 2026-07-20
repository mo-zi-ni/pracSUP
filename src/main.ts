import './style.css';
import { createInput } from './core/input';
import { createView } from './core/view';
import { createEncounter, type Encounter } from './game/encounter';
import { createPlayer, DASH_COOLDOWN } from './game/player';
import { PATTERNS } from './game/patterns';
import type { Pattern } from './game/types';
import { createHud } from './ui/hud';

const canvas = document.getElementById('stage') as HTMLCanvasElement;

const view = createView(canvas);
const input = createInput(canvas, view.camera, view.groundPlane);
const hud = createHud(PATTERNS);
const player = createPlayer();
view.scene.add(player.object);

const params = new URLSearchParams(location.search);

/**
 * ?t=4000 을 붙이면 그 시각(ms)까지 진행한 뒤 멈춘다.
 * 패턴 타이밍을 맞출 때 특정 순간의 장판 배치를 그대로 놓고 볼 수 있다.
 */
const requested = Number(params.get('t'));
const freezeAt = Number.isFinite(requested) && requested > 0 ? requested : null;

// ?p=guard-rhythm 처럼 패턴을 바로 열 수 있다. 특정 패턴 링크를 공유할 때 쓴다.
let pattern: Pattern = PATTERNS.find((p) => p.id === params.get('p')) ?? PATTERNS[0];
let encounter: Encounter;
/** 슬로우모션 배율. 연습 도구의 핵심 기능이라 게임 시간에만 곱한다. */
let timeScale = 1;
let resultShown = false;
let paused = false;
/** 느낌표 안내. 끄면 보스 모션과 장판만 보고 쳐야 하는 상위 난이도가 된다. */
let showCue = params.get('cue') !== 'off';

function load(next: Pattern) {
  encounter?.dispose();
  pattern = next;
  view.setArena(pattern.arena);
  player.reset();
  encounter = createEncounter(
    pattern,
    view.scene,
    player,
    () => flashDamage(),
    (fb) => hud.flash(fb),
    { showCue },
  );
  hud.setPattern(pattern);
  hud.hideResult();
  input.clearMoveTarget();
  resultShown = false;
  setPaused(false);
}

function restart() {
  player.reset();
  encounter.restart();
  hud.hideResult();
  input.clearMoveTarget();
  resultShown = false;
  setPaused(false);
}

function setPaused(next: boolean) {
  paused = next;
  hud.setPaused(paused);
}

function togglePause() {
  // 이미 끝난 판을 일시정지해봐야 의미가 없다
  if (encounter.finished) return;
  setPaused(!paused);
}

/** 피격 시 화면을 잠깐 붉게 — 맞은 걸 놓치면 연습이 안 된다 */
function flashDamage() {
  canvas.animate(
    [{ filter: 'brightness(1)' }, { filter: 'brightness(1.9) sepia(0.5) hue-rotate(-40deg)' }, { filter: 'brightness(1)' }],
    { duration: 220, easing: 'ease-out' },
  );
}

hud.onSelect((id) => {
  const found = PATTERNS.find((p) => p.id === id);
  if (found) load(found);
});
hud.onRestart(restart);
hud.onSpeed((scale) => {
  timeScale = scale;
});
hud.onPause(togglePause);
hud.onCueToggle((show) => {
  showCue = show;
  encounter.setShowCue(show);
});
hud.setCue(showCue);

window.addEventListener('keydown', (ev) => {
  // ev.code라서 한글 입력 상태에서도 동작한다
  if (ev.code === 'KeyR') restart();
  if (ev.code === 'KeyP' || ev.code === 'Escape') togglePause();
});
window.addEventListener('resize', () => view.resize());

load(pattern);
view.resize();

let last = performance.now();

function frame(now: number) {
  try {
    step(now);
  } catch (err) {
    // 프레임 루프가 죽으면 화면이 조용히 멈춰버려 원인을 알 수 없다.
    // 조용한 정지보다 눈에 보이는 에러가 낫다.
    console.error(err);
    hud.crash(err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
  }
}

function step(now: number) {
  // 탭이 백그라운드에 있다가 돌아오면 dt가 폭발하므로 잘라낸다
  const real = Math.min(now - last, 50);
  last = now;
  const dt = real * timeScale;

  if (freezeAt !== null && encounter.time >= freezeAt) {
    // 목표 시각 도달 — 마지막 화면을 한 번 그리고 루프를 끝낸다.
    // 계속 rAF를 돌면 아무 변화 없이 CPU만 쓴다.
    view.render();
    return;
  }

  if (paused) {
    // 입력만 흘려보내고 시간은 세우지 않는다
    input.endFrame();
    view.render();
    requestAnimationFrame(frame);
    return;
  }

  if (!encounter.finished) {
    player.update(dt, input, pattern.arena);
    encounter.update(dt, input);
  } else if (!resultShown) {
    hud.showResult(encounter.result());
    resultShown = true;
  }

  hud.update({
    time: encounter.time,
    duration: encounter.duration,
    hp: Math.max(0, player.hp),
    maxHp: player.maxHp,
    dashRatio: 1 - player.cooldown / DASH_COOLDOWN,
    locked: encounter.guardBlocked,
    labels: encounter.activeLabels(),
  });

  input.endFrame();
  view.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
