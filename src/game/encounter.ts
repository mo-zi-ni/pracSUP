import * as THREE from 'three';
import { applyFacing, createTelegraphMesh, isInside } from './shapes';
import type { Cast, Pattern, Rule, RunResult, Vec2 } from './types';
import type { Player } from './player';

/**
 * 패턴 타임라인 실행기.
 *
 * 정해진 시각에 장판을 띄우고, windup이 끝나면 판정한다.
 * 시간은 바깥에서 주입받는다 — 슬로우모션이 그냥 dt 스케일로 해결되게 하려는 것.
 */

type CastState = 'pending' | 'telegraphing' | 'resolved';

interface LiveCast {
  cast: Cast;
  state: CastState;
  /** 시전 시점에 확정된 위치·각도 */
  origin: Vec2;
  angle: number;
  group: THREE.Group;
  fill: THREE.MeshBasicMaterial;
  /** 터진 뒤 잔상이 사라지기까지 남은 시간(ms) */
  fadeLeft: number;
  hit: boolean;
}

const BURST_FADE = 260;

const COLOR_DODGE = 0xff4d5e;
const COLOR_STAND = 0x49e08a;

export interface Encounter {
  readonly time: number;
  readonly duration: number;
  readonly finished: boolean;
  /** 지금 화면에 떠 있는 장판들의 라벨 */
  activeLabels(): { text: string; rule: Rule }[];
  update(dt: number): void;
  restart(): void;
  result(): RunResult;
  dispose(): void;
}

export function createEncounter(
  pattern: Pattern,
  scene: THREE.Scene,
  player: Player,
  onHit: (cast: Cast) => void,
): Encounter {
  const boss = createBoss();
  scene.add(boss);

  const duration =
    pattern.duration ?? Math.max(...pattern.casts.map((c) => c.at + c.windup)) + 1500;

  let live: LiveCast[] = [];
  let time = 0;
  let hits = 0;

  function spawn(cast: Cast): LiveCast {
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
    const color = rule === 'stand' ? COLOR_STAND : COLOR_DODGE;

    const fill = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const group = createTelegraphMesh(cast.shape, fill);
    applyFacing(group, angle);
    group.position.set(origin.x, 0.06, origin.z);
    scene.add(group);

    return { cast, state: 'telegraphing', origin, angle, group, fill, fadeLeft: 0, hit: false };
  }

  function resolve(entry: LiveCast) {
    const rule = entry.cast.rule ?? 'dodge';
    const inside = isInside(entry.cast.shape, entry.origin, entry.angle, player.pos);
    // stand 규칙은 "안에 없으면" 피격. dodge는 "안에 있으면" 피격.
    const wouldHit = rule === 'stand' ? !inside : inside;

    entry.state = 'resolved';
    entry.fadeLeft = BURST_FADE;
    entry.fill.opacity = 0.55;

    if (wouldHit && !player.invulnerable) {
      entry.hit = true;
      hits++;
      player.hp -= entry.cast.damage ?? 1;
      onHit(entry.cast);
    } else {
      // 회피 성공은 초록으로 — 대시 타이밍이 맞았는지 즉시 보이게 한다
      entry.fill.color.set(0x49e08a);
    }
  }

  return {
    get time() {
      return time;
    },
    duration,
    get finished() {
      return time >= duration || player.hp <= 0;
    },

    activeLabels() {
      return live
        .filter((e) => e.state === 'telegraphing' && e.cast.label)
        .map((e) => ({ text: e.cast.label!, rule: e.cast.rule ?? 'dodge' }));
    },

    update(dt) {
      const prev = time;
      time += dt;

      // 이번 프레임 구간에 진입한 장판을 띄운다
      for (const cast of pattern.casts) {
        if (cast.at > prev && cast.at <= time) live.push(spawn(cast));
      }

      for (const entry of live) {
        if (entry.state === 'telegraphing') {
          const progress = (time - entry.cast.at) / entry.cast.windup;
          if (progress >= 1) {
            resolve(entry);
          } else {
            // 터질수록 진해진다 — 남은 시간을 색으로 읽을 수 있게
            entry.fill.opacity = 0.18 + progress * 0.32;
          }
        } else if (entry.fadeLeft > 0) {
          entry.fadeLeft -= dt;
          entry.fill.opacity = Math.max(0, (entry.fadeLeft / BURST_FADE) * 0.55);
        }
      }

      // 다 사라진 장판 정리
      const done = live.filter((e) => e.state === 'resolved' && e.fadeLeft <= 0);
      for (const entry of done) disposeCast(scene, entry);
      if (done.length) live = live.filter((e) => !done.includes(e));

      boss.rotation.y += dt * 0.0004;
    },

    restart() {
      for (const entry of live) disposeCast(scene, entry);
      live = [];
      time = 0;
      hits = 0;
    },

    result(): RunResult {
      return {
        cleared: player.hp > 0 && time >= duration,
        hits,
        totalCasts: pattern.casts.length,
        elapsed: time,
      };
    },

    dispose() {
      for (const entry of live) disposeCast(scene, entry);
      live = [];
      scene.remove(boss);
    },
  };
}

function disposeCast(scene: THREE.Scene, entry: LiveCast): void {
  scene.remove(entry.group);
  entry.group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  entry.fill.dispose();
}

function createBoss(): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2.2, 3.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.5 }),
  );
  body.position.y = 1.7;
  group.add(body);

  const crown = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.9),
    new THREE.MeshStandardMaterial({ color: 0xd8b4fe, emissive: 0x4c1d95 }),
  );
  crown.position.y = 4.2;
  group.add(crown);

  return group;
}
