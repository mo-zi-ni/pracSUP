import * as THREE from 'three';
import type { Input } from '../core/input';
import { createBoss } from './boss';
import { applyFacing, createTelegraphMesh, isInside } from './shapes';
import { GUARD_STANCE, type Player } from './player';
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
 *  - 가드(GuardCast): 시간으로 판정. impact 한 순간에만 판정한다.
 *
 * 가드 판정의 핵심은 판정 창을 누가 들고 있느냐다. 공격이 창을 들고 있는 게
 * 아니라 플레이어가 들고 있다 — G를 누르면 0.5초짜리 방어 자세가 서고,
 * 공격이 닿는 순간(impact) 그 자세가 살아 있으면 막힌다. 그래서 여기서는
 * "누른 시각과 목표 시각의 오차"를 재지 않는다. impact 시점의 상태만 본다.
 *
 * 연출은 실제 대난투를 따른다. 보스가 무기를 들면(at) 바닥에 예고 장판이
 * 깔리며 플레이어 쪽으로 밀려오고, 그것이 발밑에 닿는 순간이 impact다.
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
  /** 밀려오는 앞쪽 경계선 — 실제 타이밍은 이걸 보고 잡는다 */
  edge: THREE.Mesh;
  edgeMat: THREE.MeshBasicMaterial;
  /** 장판이 가득 찼을 때의 크기 */
  span: { width: number; length: number; from: number };
  /** 이 공격이 보스에게 지시한 모션의 식별자 */
  motionToken: number;
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

/** 느낌표가 화면에 남아있는 시간(ms) */
const CUE_VISIBLE = 300;
const SHOCKWAVE_LIFE = 700;

/**
 * 자세를 세운 뒤 이 시간(ms) 안에 맞으면 최고 등급.
 *
 * 자세는 0.5초 유지되므로 아무 때나 미리 눌러도 막히기는 한다. 그러면
 * "일찍 눌러두고 기다리기"가 최적해가 되어 연습이 안 되므로, 공격에
 * 맞춰 늦게 세운 가드에 더 높은 등급을 준다.
 */
const LEAD_EXCELLENT = 160;

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
  return isGuard(event) ? event.impact : event.at + event.windup;
}

function sequenceOf(cast: GuardCast): string {
  return cast.sequence ?? `solo@${cast.at}`;
}

/**
 * 어두운 바탕에 주황 갈매기무늬. 무늬가 있어야 장판이 밀려오는 방향이
 * 눈에 들어온다.
 *
 * 바탕을 칠하지 않고 무늬만 남기는 게 핵심이다. 통로 전체를 덮는 면이라
 * 바탕까지 밝으면 보스가 그 위에 묻혀버리고, 그러면 "보스 모션을 보고
 * 친다"가 성립하지 않는다. 타이밍은 앞쪽 경계선이 알려주므로 바닥은
 * 어디까지 왔는지만 알려줄 정도면 충분하다.
 */
function chevronTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(255, 140, 40, 0.85)';
  ctx.lineWidth = 6;
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
  const boss = createBoss(bossZ);
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
  let excellents = 0;
  let greats = 0;
  let whiffs = 0;
  let leads: number[] = [];
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
    // 보스가 무기를 들고 예비동작에 들어간다. 낫은 플레이어를 향해 날아가므로
    // 지금 서 있는 자리를 목표로 준다.
    const motionToken = boss.cast(cast.motion, cast.impact - cast.at, player.pos.z);

    const group = new THREE.Group();
    const texture = chevronTexture();

    const fillMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // 로컬 +Y가 월드 -Z가 되도록 눕힌다. 길이는 스케일로 조절한다.
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(span.width, span.length), fillMat);
    fill.rotation.x = -Math.PI / 2;
    group.add(fill);
    group.position.y = 0.05;
    scene.add(group);

    // 경계선은 group과 따로 움직인다 — group은 차오른 만큼 중심이 이동하지만
    // 경계선은 항상 그 앞쪽 끝에 있어야 한다.
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(span.width, 0.45), edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.09;
    scene.add(edge);

    spawnShockwave();

    return {
      cast,
      state: 'telegraphing',
      group,
      fill,
      fillMat,
      fillTexture: texture,
      edge,
      edgeMat,
      span,
      motionToken,
      fadeLeft: 0,
      fadeTotal: 1,
    };
  }

  /** 가드 하나가 쓰던 GPU 자원을 전부 놓는다. 경계선은 group 밖이라 따로 지운다. */
  function disposeGuard(entry: LiveGuard) {
    entry.fillTexture.dispose();
    disposeGroup(scene, entry.group);
    scene.remove(entry.edge);
    entry.edge.geometry.dispose();
    entry.edgeMat.dispose();
  }

  /** 아직 닿지 않은 공격 중 가장 먼저 닿을 것 */
  function nextGuard(): LiveGuard | undefined {
    const live = guards.filter((g) => g.state === 'telegraphing' && g.cast.impact >= time);
    if (!live.length) return undefined;
    return live.reduce((best, g) => (g.cast.impact < best.cast.impact ? g : best));
  }

  function finishGuard(entry: LiveGuard, color: number) {
    entry.state = 'done';
    entry.fadeLeft = GUARD_FADE;
    entry.fadeTotal = GUARD_FADE;
    entry.fillMat.map = null;
    entry.fillMat.color.set(color);
    entry.fillMat.needsUpdate = true;
    // 경계선은 역할이 끝났다. 남겨두면 다음 공격의 선과 헷갈린다.
    entry.edge.visible = false;
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

  /**
   * G 입력. 여기서는 성공/실패를 판정하지 않는다 — 방어 자세를 세울 뿐이다.
   * 실제 판정은 공격이 닿는 순간(resolveGuard)에 일어난다.
   *
   * 다만 "아무것도 안 오는데 눌렀다"는 이 시점에 확정할 수 있다. 자세가
   * 유지되는 0.5초 안에 닿을 공격이 하나도 없으면 그게 헛가드다.
   */
  function onGuardPress() {
    if (!player.canGuard) {
      onFeedback({ text: '가드 경직 중', tone: 'bad' });
      return;
    }

    player.startGuard();

    // 이번 자세가 덮는 시간대에 닿을 공격
    const covered = guards.find(
      (g) =>
        g.state === 'telegraphing' &&
        g.cast.impact >= time &&
        g.cast.impact <= time + GUARD_STANCE,
    );

    if (!covered) {
      // 곧 올 공격을 향해 헛친 것이라면 그 패턴을 잠근다.
      // 완전히 엉뚱한 타이밍이면 잠글 대상이 없으니 경고만 한다.
      const upcoming = nextGuard();
      whiff(upcoming, upcoming ? '헛가드 — 너무 이름' : '헛가드 — 대상 없음');
    }
  }

  /**
   * 공격이 닿는 순간. 저스트가드 판정은 오직 여기서만 일어난다.
   * 조건은 하나다 — 지금 방어 자세가 서 있는가.
   */
  function resolveGuard(entry: LiveGuard) {
    const locked = lockedSequences.has(sequenceOf(entry.cast));

    if (player.guarding && !locked) {
      // 자세를 세운 뒤 몇 ms 만에 맞았는가. 작을수록 공격에 맞춰 눌렀다는 뜻.
      const lead = Math.round(player.guardElapsed ?? 0);
      const excellent = lead <= LEAD_EXCELLENT;

      justGuards++;
      leads.push(lead);
      if (excellent) excellents++;
      else greats++;

      finishGuard(entry, COLOR_STAND);
      player.guardFlash = 260;
      onFeedback({
        text: excellent ? 'Excellent' : 'Great',
        tone: 'just',
      });
      return;
    }

    finishGuard(entry, COLOR_DODGE);
    hits++;
    player.hp -= entry.cast.damage ?? 1;
    onHit();
    onFeedback({
      text: locked && player.guarding ? '가드 불가 — 이미 헛가드' : '피격',
      tone: 'bad',
    });
  }

  function updateGuard(entry: LiveGuard, dt: number) {
    if (entry.state === 'telegraphing') {
      const windup = Math.max(1, entry.cast.impact - entry.cast.at);
      const toImpact = entry.cast.impact - time;

      // 판정은 닿는 순간 딱 한 번. 지나쳤으면 즉시 결론을 낸다.
      if (toImpact <= 0) {
        boss.strike(entry.motionToken);
        resolveGuard(entry);
        return;
      }

      // 0 → 1로 차오르며 플레이어 쪽으로 밀려온다. 발밑에 닿는 순간이 impact.
      const progress = Math.max(0.001, Math.min(1, 1 - toImpact / windup));
      const filled = entry.span.length * progress;
      entry.fill.scale.y = progress;
      entry.group.position.z = entry.span.from + filled / 2;

      // 무늬가 늘어나지 않도록 채워진 길이에 맞춰 반복 횟수를 조절한다
      entry.fillTexture.repeat.set(entry.span.width / 5, Math.max(0.2, filled / 5));

      // 경계선은 항상 차오른 끝, 즉 "지금 공격이 도달한 지점"에 놓인다.
      // 이게 플레이어 발밑에 닿는 순간이 impact다.
      entry.edge.position.z = entry.span.from + filled;
      // 닿기 직전에 굵고 밝아진다 — 마지막 순간이 눈에 띄어야 한다
      const imminent = Math.max(0, 1 - toImpact / 320);
      entry.edge.scale.y = 1 + imminent * 2.2;

      // 지금 자세가 서 있으면 장판이 파랗게 죽는다 —
      // "이 순간 맞으면 막힌다"를 실시간으로 보여주는 게 학습에 제일 중요하다.
      const locked = lockedSequences.has(sequenceOf(entry.cast));
      const tint = locked ? 0x6b7392 : player.guarding ? 0x7fd8ff : 0xffffff;
      entry.fillMat.color.set(tint);
      entry.fillMat.opacity = locked ? 0.22 : 0.38;
      entry.edgeMat.color.set(locked ? 0x6b7392 : player.guarding ? 0x7fd8ff : 0xffb347);
      entry.edgeMat.opacity = locked ? 0.45 : 0.95;
      return;
    }

    entry.fadeLeft -= dt;
    // 통로 전체를 덮는 면이라 진하면 다음 패턴이 안 보인다
    entry.fillMat.opacity = Math.max(0, 0.32 * (entry.fadeLeft / entry.fadeTotal));
  }

  /** 보스 연출: 반짝임(예비동작 진행도)과 느낌표(누를 타이밍) */
  function updateBoss(dt: number) {
    let glow = 0;
    let cue = false;

    for (const g of guards) {
      const c = g.cast;
      if (time >= c.at && time <= c.impact) {
        // 닿을 때가 가까울수록 밝아진다 — 예비동작의 진행도가 곧 밝기다
        const windup = Math.max(1, c.impact - c.at);
        glow = Math.max(glow, Math.min(1, 0.35 + 0.65 * (1 - (c.impact - time) / windup)));
      }
      // 느낌표는 닿기 직전에 뜬다. 이때 눌러야 자세가 공격을 정확히 받는다.
      if (time >= c.impact - CUE_VISIBLE && time <= c.impact) cue = true;
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
      const next = nextGuard();
      return next ? lockedSequences.has(sequenceOf(next.cast)) : false;
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
        disposeGuard(entry);
      }
      if (doneGuards.length) guards = guards.filter((g) => !doneGuards.includes(g));
    },

    restart() {
      for (const entry of fields) disposeGroup(scene, entry.group);
      for (const entry of guards) {
        disposeGuard(entry);
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
      excellents = 0;
      greats = 0;
      whiffs = 0;
      leads = [];
      lockedSequences = new Set();
      boss.reset();
    },

    result(): RunResult {
      return {
        cleared: player.hp > 0 && time >= duration,
        hits,
        totalCasts: pattern.casts.length,
        elapsed: time,
        justGuards,
        guardTotal,
        excellents,
        greats,
        whiffs,
        avgLead: leads.length
          ? Math.round(leads.reduce((a, b) => a + b, 0) / leads.length)
          : null,
      };
    },

    dispose() {
      this.restart();
      scene.remove(boss.object);
      boss.dispose();
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
