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

let pattern: Pattern = PATTERNS[0];
let encounter: Encounter;
/** 슬로우모션 배율. 연습 도구의 핵심 기능이라 게임 시간에만 곱한다. */
let timeScale = 1;
let resultShown = false;

/**
 * ?t=4000 을 붙이면 그 시각(ms)까지 진행한 뒤 멈춘다.
 * 패턴 타이밍을 맞출 때 특정 순간의 장판 배치를 그대로 놓고 볼 수 있다.
 */
const requested = Number(new URLSearchParams(location.search).get('t'));
const freezeAt = Number.isFinite(requested) && requested > 0 ? requested : null;

function load(next: Pattern) {
  encounter?.dispose();
  pattern = next;
  view.setArena(pattern.arenaRadius);
  player.reset();
  encounter = createEncounter(pattern, view.scene, player, () => flashDamage());
  hud.setPattern(pattern);
  hud.hideResult();
  input.clearMoveTarget();
  resultShown = false;
}

function restart() {
  player.reset();
  encounter.restart();
  hud.hideResult();
  input.clearMoveTarget();
  resultShown = false;
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

window.addEventListener('keydown', (ev) => {
  if (ev.key.toLowerCase() === 'r') restart();
});
window.addEventListener('resize', () => view.resize());

load(pattern);
view.resize();

let last = performance.now();

function frame(now: number) {
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

  if (!encounter.finished) {
    player.update(dt, input, pattern.arenaRadius);
    encounter.update(dt);
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
    labels: encounter.activeLabels(),
  });

  input.endFrame();
  view.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
