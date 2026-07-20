import * as THREE from 'three';
import type { Input } from '../core/input';
import { applyFacing, createTelegraphMesh, isInside } from './shapes';
import type { Player } from './player';
import {
  isGuard,
  type Arena,
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
 *  - 가드(GuardCast): 시간으로 판정. cue 기준 입력 시각의 오차를 본다.
 *
 * 가드 연출은 실제 대난투를 따른다. 보스가 금색 파동을 터뜨리면(at) 바닥
 * 장판이 차오르기 시작하고, 장판이 가득 차는 순간(cue)이 저스트가드 타이밍이다.
 * 즉 "차오르는 정도"가 곧 타이밍 게이지다.
 */

type FieldState = 'telegraphing' | 'resolved';

interface LiveField {
  cast: FieldCast;
  state: FieldState;
  origin: Vec2;
  angle: number;
  group: THREE.Group;
  fill: THREE.MeshBasicMaterial;
  fadeLeft: number;
}

type GuardState = 'telegraphing' | 'done';

interface LiveGuard {
  cast: GuardCast;
  state: GuardState;
  group: THREE.Group;
  /** 차오르는 장판 */
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  fillTexture: THREE.CanvasTexture;
  /** 장판이 가득 찼을 때의 크기 */
  span: { width: number; length: number; from: number };
  fadeLeft: number;
  fadeTotal: number;
}

/** 보스가 터뜨리는 금색 파동 */
interface Shockwave {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  total: number;
  maxScale: number;
}

const GUARD_FADE = 220;
const BURST_FADE = 260;
const COLOR_DODGE = 0xff4d5e;
const COLOR_STAND = 0x49e08a;
const COLOR_CUE = 0xffe066;

/** 느낌표가 화면에 남아있는 시간(ms) */
const CUE_VISIBLE = 300;
const SHOCKWAVE_LIFE = 700;

export type Feedback = {
  text: string;
  tone: 'just' | 'good' | 'bad';
};

export interface EncounterOptions {
  /** 느낌표 안내를 띄울지. 끄면 보스 모션과 장판만 보고 쳐야 한다. */
  showCue: boolean;
}

export interface Encounter {
  readonly time: number;
  readonly duration: number;
  readonly finished: boolean;
  readonly guardBlocked: boolean;
  activeLabels(): { text: string; rule: Rule | 'guard' }[];
  update(dt: number, input: Input): void;
  restart(): void;
  result(): RunResult;
  setShowCue(show: boolean): void;
  dispose(): void;
}

function endOf(event: TimelineEvent): number {
  return isGuard(event) ? event.cue + event.window : event.at + event.windup;
}

function sequenceOf(cast: GuardCast): string {
  return cast.sequence ?? `solo@${cast.at}`;
}

/**
 * 주황 바탕에 어두운 갈매기무늬. 실제 대난투 장판의 결을 흉내낸 것으로,
 * 무늬가 있어야 장판이 "차오르는" 방향이 눈에 들어온다.
 */
function chevronTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ff9520';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(110, 45, 0, 0.5)';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  for (let i = -1; i < 3; i++) {
    const y = i * 32;
    ctx.beginPath();
    ctx.moveTo(-2, y);
    ctx.lineTo(size / 2, y + 22);
    ctx.lineTo(size + 2, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 가드 장판이 덮는 영역. 통로는 레인 전체, 원형은 보스 주변. */
function guardSpan(arena: Arena): { width: number; length: number; from: number } {
  if (arena.kind === 'corridor') {
    return {
      width: arena.halfWidth * 2,
      length: arena.near - arena.far,
      from: arena.far,
    };
  }
  return { width: arena.radius * 2, length: arena.radius * 2, from: -arena.radius };
}

export function createEncounter(
  pattern: Pattern,
  scene: THREE.Scene,
  player: Player,
  onHit: () => void,
  onFeedback: (feedback: Feedback) => void,
  options: EncounterOptions,
): Encounter {
  const bossZ = pattern.arena.kind === 'corridor' ? pattern.arena.far + 5 : 0;
  const boss = createBoss();
  boss.object.position.z = bossZ;
  scene.add(boss.object);

  const span = guardSpan(pattern.arena);
  const duration = pattern.duration ?? Math.max(...pattern.casts.map(endOf)) + 1500;
  const guardTotal = pattern.casts.filter(isGuard).length;

  let showCue = options.showCue;
  let fields: LiveField[] = [];
  let guards: LiveGuard[] = [];
  let waves: Shockwave[] = [];
  let time = 0;
  let hits = 0;
  let justGuards = 0;
  let whiffs = 0;
  let offsets: number[] = [];
  let lockedSequences = new Set<string>();

  // ---------- 장판 ----------

  function spawnField(cast: FieldCast): LiveField {
    const anchor = cast.anchor ?? { kind: 'boss' };
    const origin: Vec2 =
      anchor.kind === 'boss'
        ? { x: 0, z: bossZ }
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

  // ---------- 금색 파동 ----------

  function spawnShockwave() {
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd76a,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0.25 + i * 0.5, bossZ);
      scene.add(mesh);
      waves.push({
        mesh,
        mat,
        life: SHOCKWAVE_LIFE,
        total: SHOCKWAVE_LIFE,
        maxScale: 7 + i * 2.5,
      });
    }
  }

  function updateWaves(dt: number) {
    for (const w of waves) {
      w.life -= dt;
      const t = 1 - Math.max(0, w.life) / w.total;
      w.mesh.scale.setScalar(0.6 + t * w.maxScale);
      w.mat.opacity = Math.max(0, 0.9 * (1 - t));
    }
    const dead = waves.filter((w) => w.life <= 0);
    for (const w of dead) {
      scene.remove(w.mesh);
      w.mesh.geometry.dispose();
      w.mat.dispose();
    }
    if (dead.length) waves = waves.filter((w) => !dead.includes(w));
  }

  // ---------- 저스트가드 ----------

  function spawnGuard(cast: GuardCast): LiveGuard {
    const group = new THREE.Group();
    const texture = chevronTexture();

    const fillMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // 로컬 +Y가 월드 -Z가 되도록 눕힌다. 길이는 스케일로 조절한다.
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(span.width, span.length), fillMat);
    fill.rotation.x = -Math.PI / 2;
    group.add(fill);
    group.position.y = 0.05;
    scene.add(group);

    spawnShockwave();

    return {
      cast,
      state: 'telegraphing',
      group,
      fill,
      fillMat,
      fillTexture: texture,
      span,
      fadeLeft: 0,
      fadeTotal: 1,
    };
  }

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
    entry.fillMat.map = null;
    entry.fillMat.color.set(color);
    entry.fillMat.needsUpdate = true;
  }

  /**
   * 헛가드. 실제 대난투 규칙대로 해당 보스 패턴 전체의 저스트가드를 막는다.
   * 확신이 없으면 안 누르는 판단을 훈련시키는 장치다.
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
    // 파동이 터지기 전에는 가드가 성립하지 않는다
    if (time < near.cast.at) {
      whiff(near, '너무 이름 — 파동 전');
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

    whiff(near, offset < 0 ? `이름 ${offset}ms` : `늦음 +${offset}ms`);
  }

  function resolveGuard(entry: LiveGuard) {
    finishGuard(entry, COLOR_DODGE);
    hits++;
    player.hp -= entry.cast.damage ?? 1;
    onHit();
  }

  function updateGuard(entry: LiveGuard, dt: number) {
    if (entry.state === 'telegraphing') {
      const windup = Math.max(1, entry.cast.cue - entry.cast.at);
      const toCue = entry.cast.cue - time;

      if (toCue < -entry.cast.window) {
        resolveGuard(entry);
        return;
      }

      // 0 → 1로 차오른다. 가득 차는 순간이 cue.
      const progress = Math.max(0.001, Math.min(1, 1 - toCue / windup));
      const filled = entry.span.length * progress;
      entry.fill.scale.y = progress;
      entry.group.position.z = entry.span.from + filled / 2;

      // 무늬가 늘어나지 않도록 채워진 길이에 맞춰 반복 횟수를 조절한다
      entry.fillTexture.repeat.set(entry.span.width / 5, Math.max(0.2, filled / 5));

      const locked = lockedSequences.has(sequenceOf(entry.cast));
      const inWindow = Math.abs(toCue) <= entry.cast.window;
      entry.fillMat.color.set(locked ? 0x6b7392 : inWindow ? 0xfff3b0 : 0xffffff);
      entry.fillMat.opacity = locked ? 0.4 : 0.72;
      return;
    }

    entry.fadeLeft -= dt;
    // 통로 전체를 덮는 면이라 진하면 다음 패턴이 안 보인다
    entry.fillMat.opacity = Math.max(0, 0.32 * (entry.fadeLeft / entry.fadeTotal));
  }

  /** 보스 연출: 반짝임(가드 가능)과 느낌표(누를 타이밍) */
  function updateBoss(dt: number) {
    let glow = 0;
    let cue = false;

    for (const g of guards) {
      const c = g.cast;
      if (time >= c.at && time <= c.cue + c.window) {
        const windup = Math.max(1, c.cue - c.at);
        glow = Math.max(glow, Math.min(1, 0.4 + 0.6 * (1 - Math.abs(c.cue - time) / windup)));
      }
      if (time >= c.cue && time <= c.cue + CUE_VISIBLE) cue = true;
    }

    boss.setGlow(glow);
    boss.setCue(showCue && cue);
    boss.update(dt);
  }

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

    setShowCue(show) {
      showCue = show;
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

      for (const event of pattern.casts) {
        if (event.at > prev && event.at <= time) {
          if (isGuard(event)) guards.push(spawnGuard(event));
          else fields.push(spawnField(event));
        }
      }

      // 가드 입력은 판정 갱신보다 먼저 본다.
      // 나중에 보면 같은 프레임에 판정이 끝나 정확한 입력이 "늦음"이 된다.
      if (input.pressed.has('KeyG')) onGuardPress();

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

      updateWaves(dt);
      updateBoss(dt);

      const doneFields = fields.filter((e) => e.state === 'resolved' && e.fadeLeft <= 0);
      for (const entry of doneFields) disposeGroup(scene, entry.group);
      if (doneFields.length) fields = fields.filter((e) => !doneFields.includes(e));

      const doneGuards = guards.filter((g) => g.state === 'done' && g.fadeLeft <= 0);
      for (const entry of doneGuards) {
        entry.fillTexture.dispose();
        disposeGroup(scene, entry.group);
      }
      if (doneGuards.length) guards = guards.filter((g) => !doneGuards.includes(g));
    },

    restart() {
      for (const entry of fields) disposeGroup(scene, entry.group);
      for (const entry of guards) {
        entry.fillTexture.dispose();
        disposeGroup(scene, entry.group);
      }
      for (const w of waves) {
        scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        w.mat.dispose();
      }
      fields = [];
      guards = [];
      waves = [];
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
      this.restart();
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
 * 보스. 검은 몸체에 금색 장식을 두른 채 공중에 떠 있는 실루엣.
 *
 * 저스트가드는 "보스 모션을 보고" 치는 것이므로 보스가 상태를 분명히
 * 드러내야 한다. 그래서 반짝임과 느낌표를 보스 자신이 표현한다.
 */
interface Boss {
  object: THREE.Group;
  setGlow(amount: number): void;
  setCue(visible: boolean): void;
  update(dt: number): void;
}

function createBoss(): Boss {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const darkMat = new THREE.MeshStandardMaterial({ color: 0x14101f, roughness: 0.7 });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd9a441,
    roughness: 0.35,
    metalness: 0.6,
  });

  // 아래로 갈수록 퍼지는 검은 로브
  const robe = new THREE.Mesh(new THREE.ConeGeometry(1.55, 4.4, 14), darkMat);
  robe.position.y = 2.1;
  body.add(robe);

  // 금색 어깨 장식
  for (const side of [-1, 1]) {
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10), goldMat);
    pauldron.position.set(side * 1.35, 3.5, 0);
    pauldron.scale.set(1, 0.7, 1);
    body.add(pauldron);
  }

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.16, 8, 20), goldMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 3.9;
  body.add(collar);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), darkMat);
  head.position.y = 4.5;
  body.add(head);

  // 넓은 챙의 마녀 모자
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.75, 0.16, 22), darkMat);
  brim.position.y = 5.0;
  body.add(brim);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.05, 3.0, 18), darkMat);
  cone.position.y = 6.5;
  cone.rotation.z = 0.14;
  body.add(cone);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.16, 0.34, 22), goldMat);
  band.position.y = 5.25;
  body.add(band);

  // 느낌표
  const cueMat = new THREE.MeshBasicMaterial({ color: COLOR_CUE });
  const cueGroup = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.5), cueMat);
  bar.position.y = 1.1;
  cueGroup.add(bar);
  cueGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), cueMat));
  cueGroup.position.y = 7.6;
  cueGroup.visible = false;
  group.add(cueGroup);

  const darkBase = darkMat.color.clone();
  const goldBase = goldMat.color.clone();
  const glowTarget = new THREE.Color(0xffdf80);
  let bob = 0;

  return {
    object: group,

    setGlow(amount) {
      const a = Math.max(0, Math.min(1, amount));
      // 금색 장식만 확실히 빛나게 하고 검은 로브는 어둡게 둔다.
      // 전체를 물들이면 실루엣이 사라져 "모션을 보고 친다"가 성립하지 않는다.
      goldMat.emissive.setRGB(a * 0.9, a * 0.66, 0);
      goldMat.color.copy(goldBase).lerp(glowTarget, a * 0.5);
      darkMat.emissive.setRGB(a * 0.14, a * 0.09, 0);
      darkMat.color.copy(darkBase);
    },

    setCue(visible) {
      cueGroup.visible = visible;
    },

    update(dt) {
      // 공중에 떠 있는 느낌
      bob += dt * 0.0016;
      body.position.y = Math.sin(bob) * 0.28 + 0.9;
      if (cueGroup.visible) {
        cueGroup.position.y = 7.6 + Math.sin(performance.now() * 0.02) * 0.24;
      }
    },
  };
}
