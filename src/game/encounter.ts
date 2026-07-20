import * as THREE from 'three';
import type { Input } from '../core/input';
import { applyFacing, createTelegraphMesh, isInside } from './shapes';
import type { Player } from './player';
import {
  isGuard,
  type FieldCast,
  type GuardCast,
  type Pattern,
  type Rule,
  type RunResult,
  type TimelineEvent,
  type Vec2,
} from './types';

/**
 * 패턴 타임라인 실행기.
 *
 * 두 종류의 공격을 다룬다:
 *  - 장판(FieldCast): 위치로 판정. windup이 끝나는 순간 플레이어 좌표를 본다.
 *  - 가드(GuardCast): 시간으로 판정. 느낌표(cue) 기준 입력 시각의 오차를 본다.
 *
 * 시간은 바깥에서 주입받는다 — 슬로우모션이 dt 스케일만으로 해결되게 하려는 것.
 */

type FieldState = 'telegraphing' | 'resolved';

interface LiveField {
  cast: FieldCast;
  state: FieldState;
  /** 시전 시점에 확정된 위치·각도 */
  origin: Vec2;
  angle: number;
  group: THREE.Group;
  fill: THREE.MeshBasicMaterial;
  /** 터진 뒤 잔상이 사라지기까지 남은 시간(ms) */
  fadeLeft: number;
}

/**
 * telegraphing: 반짝임 이후, 아직 판정 전
 * done:        판정 끝. 링이 사라지는 중
 */
type GuardState = 'telegraphing' | 'done';

interface LiveGuard {
  cast: GuardCast;
  state: GuardState;
  group: THREE.Group;
  incoming: THREE.Mesh;
  incomingMat: THREE.MeshBasicMaterial;
  windowMat: THREE.MeshBasicMaterial;
  /** 판정이 끝난 뒤 링이 사라지기까지 남은 시간(ms) */
  fadeLeft: number;
  fadeTotal: number;
}

const GUARD_FADE = 200;
const BURST_FADE = 260;
const COLOR_DODGE = 0xff4d5e;
const COLOR_STAND = 0x49e08a;
const COLOR_CUE = 0xffe066;

/** 가드 예고 링이 줄어드는 구간. 반짝임에서 시작해 느낌표 순간에 안쪽 링에 닿는다. */
const GUARD_RING_START = 4.6;
const GUARD_RING_TARGET = 1.15;

/** 느낌표가 화면에 남아있는 시간(ms) */
const CUE_VISIBLE = 260;

export type Feedback = {
  text: string;
  tone: 'just' | 'good' | 'bad';
};

export interface Encounter {
  readonly time: number;
  readonly duration: number;
  readonly finished: boolean;
  /** 헛가드로 지금 진행 중인 보스 패턴의 가드가 막혔는가 */
  readonly guardBlocked: boolean;
  /** 지금 화면에 떠 있는 공격들의 라벨 */
  activeLabels(): { text: string; rule: Rule | 'guard' }[];
  update(dt: number, input: Input): void;
  restart(): void;
  result(): RunResult;
  dispose(): void;
}

/** 이 공격이 완전히 끝나는 시각 */
function endOf(event: TimelineEvent): number {
  return isGuard(event) ? event.cue + event.window : event.at + event.windup;
}

/** 헛가드 잠금의 단위. 지정하지 않으면 공격 하나가 곧 하나의 패턴이다. */
function sequenceOf(cast: GuardCast): string {
  return cast.sequence ?? `solo@${cast.at}`;
}

export function createEncounter(
  pattern: Pattern,
  scene: THREE.Scene,
  player: Player,
  onHit: () => void,
  onFeedback: (feedback: Feedback) => void,
): Encounter {
  const boss = createBoss();
  scene.add(boss.object);

  const duration = pattern.duration ?? Math.max(...pattern.casts.map(endOf)) + 1500;
  const guardTotal = pattern.casts.filter(isGuard).length;

  let fields: LiveField[] = [];
  let guards: LiveGuard[] = [];
  let time = 0;
  let hits = 0;
  let justGuards = 0;
  let whiffs = 0;
  let offsets: number[] = [];
  /** 헛가드로 잠긴 보스 패턴들 */
  let lockedSequences = new Set<string>();

  // ---------- 장판 ----------

  function spawnField(cast: FieldCast): LiveField {
    const anchor = cast.anchor ?? { kind: 'boss' };
    const origin: Vec2 =
      anchor.kind === 'boss'
        ? { x: 0, z: 0 }
        : anchor.kind === 'player'
          ? { ...player.pos }
          : { ...anchor.at };

    const facing = cast.facing ?? { kind: 'toward-player' };
    const angle =
      facing.kind === 'absolute'
        ? facing.angle
        : Math.atan2(player.pos.z - origin.z, player.pos.x - origin.x);

    const rule = cast.rule ?? 'dodge';
    const fill = new THREE.MeshBasicMaterial({
      color: rule === 'stand' ? COLOR_STAND : COLOR_DODGE,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const group = createTelegraphMesh(cast.shape, fill);
    applyFacing(group, angle);
    group.position.set(origin.x, 0.06, origin.z);
    scene.add(group);

    return { cast, state: 'telegraphing', origin, angle, group, fill, fadeLeft: 0 };
  }

  function resolveField(entry: LiveField) {
    const rule = entry.cast.rule ?? 'dodge';
    const inside = isInside(entry.cast.shape, entry.origin, entry.angle, player.pos);
    // stand 규칙은 "안에 없으면" 피격. dodge는 "안에 있으면" 피격.
    const wouldHit = rule === 'stand' ? !inside : inside;

    entry.state = 'resolved';
    entry.fadeLeft = BURST_FADE;
    entry.fill.opacity = 0.55;

    if (wouldHit && !player.invulnerable) {
      hits++;
      player.hp -= entry.cast.damage ?? 1;
      onHit();
    } else {
      entry.fill.color.set(COLOR_STAND);
    }
  }

  // ---------- 저스트가드 ----------

  function spawnGuard(cast: GuardCast): LiveGuard {
    const group = new THREE.Group();
    const windup = Math.max(1, cast.cue - cast.at);

    // 느낌표가 뜨는 순간을 나타내는 고정 링
    const target = new THREE.Mesh(
      new THREE.RingGeometry(GUARD_RING_TARGET - 0.06, GUARD_RING_TARGET + 0.06, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    target.rotation.x = -Math.PI / 2;
    group.add(target);

    // 판정 창 — 이 띠 안에 줄어드는 링이 들어와 있을 때 누르면 성공
    const windowRadius =
      GUARD_RING_TARGET + (cast.window / windup) * (GUARD_RING_START - GUARD_RING_TARGET);
    const windowMat = new THREE.MeshBasicMaterial({
      color: COLOR_STAND,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const windowRing = new THREE.Mesh(
      new THREE.RingGeometry(GUARD_RING_TARGET, windowRadius, 48),
      windowMat,
    );
    windowRing.rotation.x = -Math.PI / 2;
    group.add(windowRing);

    const incomingMat = new THREE.MeshBasicMaterial({
      color: COLOR_CUE,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });
    const incoming = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), incomingMat);
    incoming.rotation.x = -Math.PI / 2;
    group.add(incoming);

    group.position.set(player.pos.x, 0.09, player.pos.z);
    scene.add(group);

    return { cast, state: 'telegraphing', group, incoming, incomingMat, windowMat, fadeLeft: 0, fadeTotal: 1 };
  }

  /** 지금 판정 대상이 되는 가드 — 느낌표 시각이 가장 가까운 것 */
  function nearestGuard(): LiveGuard | undefined {
    const live = guards.filter((g) => g.state === 'telegraphing');
    if (!live.length) return undefined;
    return live.reduce((best, g) =>
      Math.abs(g.cast.cue - time) < Math.abs(best.cast.cue - time) ? g : best,
    );
  }

  function finishGuard(entry: LiveGuard, color: number) {
    entry.state = 'done';
    entry.fadeLeft = GUARD_FADE;
    entry.fadeTotal = GUARD_FADE;
    entry.incomingMat.color.set(color);
    entry.windowMat.opacity = 0;
  }

  /**
   * 헛가드. 실제 대난투 규칙대로 해당 보스 패턴 전체의 저스트가드를 막는다.
   * 0.7초 경직보다 훨씬 무거운 대가라, 확신이 없으면 안 누르는 판단을 훈련시킨다.
   */
  function whiff(target: LiveGuard | undefined, message: string) {
    whiffs++;
    if (target) lockedSequences.add(sequenceOf(target.cast));
    onFeedback({ text: message, tone: 'bad' });
  }

  function onGuardPress() {
    const near = nearestGuard();

    if (near && lockedSequences.has(sequenceOf(near.cast))) {
      onFeedback({ text: '가드 불가 — 이미 헛가드', tone: 'bad' });
      return;
    }

    if (!near) {
      whiff(undefined, '헛가드 — 대상 없음');
      return;
    }

    // 반짝이기 전에는 가드 자체가 성립하지 않는다
    if (time < near.cast.at) {
      whiff(near, '너무 이름 — 반짝임 전');
      return;
    }

    const offset = Math.round(time - near.cast.cue);
    if (Math.abs(offset) <= near.cast.window) {
      justGuards++;
      offsets.push(offset);
      finishGuard(near, COLOR_STAND);
      player.guardFlash = 220;
      onFeedback({
        text: offset === 0 ? '저스트가드 PERFECT' : `저스트가드 ${offset > 0 ? '+' : ''}${offset}ms`,
        tone: 'just',
      });
      return;
    }

    // 창을 벗어난 입력. 어느 쪽으로 빗나갔는지 알려줘야 교정이 된다.
    whiff(near, offset < 0 ? `이름 ${offset}ms` : `늦음 +${offset}ms`);
  }

  /** 느낌표 시점까지 막지 못했다 */
  function resolveGuard(entry: LiveGuard) {
    finishGuard(entry, COLOR_DODGE);
    hits++;
    player.hp -= entry.cast.damage ?? 1;
    onHit();
  }

  function updateGuard(entry: LiveGuard, dt: number) {
    // 링은 항상 플레이어를 따라다닌다 — 움직이면서도 타이밍을 봐야 한다
    entry.group.position.set(player.pos.x, 0.09, player.pos.z);

    if (entry.state === 'telegraphing') {
      const windup = Math.max(1, entry.cast.cue - entry.cast.at);
      const toCue = entry.cast.cue - time;

      // 판정 창이 완전히 지나면 실패로 확정
      if (toCue < -entry.cast.window) {
        resolveGuard(entry);
        return;
      }

      const progress = 1 - toCue / windup;
      const radius = Math.max(
        0.1,
        GUARD_RING_START - progress * (GUARD_RING_START - GUARD_RING_TARGET),
      );
      entry.incoming.scale.setScalar(radius);
      // 판정 창 안에 들어오면 초록 — "지금"이라는 신호
      const inWindow = Math.abs(toCue) <= entry.cast.window;
      entry.incomingMat.color.set(
        lockedSequences.has(sequenceOf(entry.cast)) ? 0x6b7392 : inWindow ? COLOR_STAND : COLOR_CUE,
      );
      return;
    }

    entry.fadeLeft -= dt;
    entry.incoming.scale.setScalar(GUARD_RING_TARGET);
    entry.incomingMat.opacity = Math.max(0, entry.fadeLeft / entry.fadeTotal);
  }

  /** 보스 연출: 반짝임(가드 가능)과 느낌표(누를 타이밍) */
  function updateBoss(dt: number) {
    let glow = 0;
    let cue = false;

    for (const g of guards) {
      const c = g.cast;
      if (time >= c.at && time <= c.cue + c.window) {
        // 느낌표에 가까울수록 밝아진다 — 모션으로 타이밍을 읽게 하는 부분
        const windup = Math.max(1, c.cue - c.at);
        glow = Math.max(glow, Math.min(1, 0.35 + 0.65 * (1 - Math.abs(c.cue - time) / windup)));
      }
      if (time >= c.cue && time <= c.cue + CUE_VISIBLE) cue = true;
    }

    boss.setGlow(glow);
    boss.setCue(cue);
    boss.update(dt);
  }

  // ---------- 루프 ----------

  return {
    get time() {
      return time;
    },
    duration,
    get finished() {
      return time >= duration || player.hp <= 0;
    },
    get guardBlocked() {
      const near = nearestGuard();
      return near ? lockedSequences.has(sequenceOf(near.cast)) : false;
    },

    activeLabels() {
      const guardLabels = guards
        .filter((g) => g.state === 'telegraphing' && g.cast.label)
        .map((g) => ({ text: g.cast.label!, rule: 'guard' as const }));
      const fieldLabels = fields
        .filter((e) => e.state === 'telegraphing' && e.cast.label)
        .map((e) => ({ text: e.cast.label!, rule: (e.cast.rule ?? 'dodge') as Rule }));
      return [...guardLabels, ...fieldLabels];
    },

    update(dt, input) {
      const prev = time;
      time += dt;

      // 이번 프레임 구간에 진입한 공격을 띄운다
      for (const event of pattern.casts) {
        if (event.at > prev && event.at <= time) {
          if (isGuard(event)) guards.push(spawnGuard(event));
          else fields.push(spawnField(event));
        }
      }

      // 가드 입력은 판정 갱신보다 먼저 본다.
      // 나중에 보면 같은 프레임에 판정이 끝나 정확한 입력이 "늦음"이 된다.
      if (input.pressed.has('g')) onGuardPress();

      for (const entry of guards) updateGuard(entry, dt);

      for (const entry of fields) {
        if (entry.state === 'telegraphing') {
          const progress = (time - entry.cast.at) / entry.cast.windup;
          if (progress >= 1) resolveField(entry);
          else entry.fill.opacity = 0.18 + progress * 0.32;
        } else if (entry.fadeLeft > 0) {
          entry.fadeLeft -= dt;
          entry.fill.opacity = Math.max(0, (entry.fadeLeft / BURST_FADE) * 0.55);
        }
      }

      updateBoss(dt);

      // 다 사라진 것들 정리
      const doneFields = fields.filter((e) => e.state === 'resolved' && e.fadeLeft <= 0);
      for (const entry of doneFields) disposeGroup(scene, entry.group);
      if (doneFields.length) fields = fields.filter((e) => !doneFields.includes(e));

      const doneGuards = guards.filter((g) => g.state === 'done' && g.fadeLeft <= 0);
      for (const entry of doneGuards) disposeGroup(scene, entry.group);
      if (doneGuards.length) guards = guards.filter((g) => !doneGuards.includes(g));
    },

    restart() {
      for (const entry of fields) disposeGroup(scene, entry.group);
      for (const entry of guards) disposeGroup(scene, entry.group);
      fields = [];
      guards = [];
      time = 0;
      hits = 0;
      justGuards = 0;
      whiffs = 0;
      offsets = [];
      lockedSequences = new Set();
      boss.setGlow(0);
      boss.setCue(false);
    },

    result(): RunResult {
      return {
        cleared: player.hp > 0 && time >= duration,
        hits,
        totalCasts: pattern.casts.length,
        elapsed: time,
        justGuards,
        guardTotal,
        whiffs,
        avgOffset: offsets.length
          ? Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length)
          : null,
      };
    },

    dispose() {
      for (const entry of fields) disposeGroup(scene, entry.group);
      for (const entry of guards) disposeGroup(scene, entry.group);
      fields = [];
      guards = [];
      scene.remove(boss.object);
    },
  };
}

function disposeGroup(scene: THREE.Scene, group: THREE.Group): void {
  scene.remove(group);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mat = o.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}

/**
 * 보스. 마녀 모자를 쓴 실루엣.
 *
 * 저스트가드는 "보스 모션을 보고" 치는 것이므로 보스가 상태를 분명히
 * 드러내야 한다. 그래서 반짝임(가드 가능)과 느낌표(누를 타이밍)를
 * 보스 자신이 표현하도록 만들었다.
 */
interface Boss {
  object: THREE.Group;
  /** 노란 반짝임 세기 0~1 */
  setGlow(amount: number): void;
  /** 머리 위 느낌표 표시 */
  setCue(visible: boolean): void;
  update(dt: number): void;
}

function createBoss(): Boss {
  const group = new THREE.Group();

  const robeMat = new THREE.MeshStandardMaterial({ color: 0x4a2d6b, roughness: 0.75 });
  const robe = new THREE.Mesh(new THREE.ConeGeometry(1.9, 3.6, 12), robeMat);
  robe.position.y = 1.8;
  group.add(robe);

  const headMat = new THREE.MeshStandardMaterial({ color: 0xe8d5c0, roughness: 0.6 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 12), headMat);
  head.position.y = 4.0;
  group.add(head);

  // 마녀 모자 — 챙 + 고깔
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x2b1b3d, roughness: 0.8 });
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.16, 20), hatMat);
  brim.position.y = 4.6;
  group.add(brim);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.6, 16), hatMat);
  cone.position.y = 5.9;
  cone.rotation.z = 0.16;
  group.add(cone);

  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(1.02, 1.06, 0.3, 20),
    new THREE.MeshStandardMaterial({ color: 0x8b5cf6 }),
  );
  band.position.y = 4.85;
  group.add(band);

  // 느낌표 — 눌러야 하는 순간에만 뜬다
  const cueMat = new THREE.MeshBasicMaterial({ color: COLOR_CUE });
  const cueGroup = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.5, 0.42), cueMat);
  bar.position.y = 0.95;
  cueGroup.add(bar);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), cueMat);
  cueGroup.add(dot);
  cueGroup.position.y = 8.2;
  cueGroup.visible = false;
  group.add(cueGroup);

  const glowMats = [robeMat, headMat, hatMat];
  const baseColors = glowMats.map((m) => m.color.clone());
  const glowTarget = new THREE.Color(COLOR_CUE);

  return {
    object: group,

    setGlow(amount) {
      const a = Math.max(0, Math.min(1, amount));
      glowMats.forEach((m, i) => {
        m.emissive.setRGB(a * 0.8, a * 0.65, 0);
        // 발광만으로는 약해서 본래 색도 함께 밝힌다
        m.color.copy(baseColors[i]).lerp(glowTarget, a * 0.45);
      });
    },

    setCue(visible) {
      cueGroup.visible = visible;
    },

    update() {
      if (cueGroup.visible) {
        cueGroup.position.y = 8.2 + Math.sin(performance.now() * 0.02) * 0.22;
      }
    },
  };
}
