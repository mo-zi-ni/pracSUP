import * as THREE from 'three';
import type { GuardMotion } from './types';

/**
 * 고통의 마녀, 세르카.
 *
 * 저스트가드는 "보스 모션을 보고" 치는 것이므로 보스가 지금 무엇을 하는지
 * 몸으로 드러내야 한다. 그래서 공격마다 무기와 예비동작이 다르다 —
 * 낫은 크게 들었다가 던지고, 망치는 치켜들었다가 내려찍고, 창은 짧게 당겼다
 * 내지른다. 예비동작의 길이와 결이 곧 타이밍 단서다.
 *
 * 애니메이션은 전부 0~1 진행도(p)의 함수다. p는 예비동작 시작(at)에서 0,
 * 공격이 닿는 순간(impact)에 1이 되고, 그 뒤 후속 동작으로 넘어간다.
 */

const COLOR_CUE = 0xffe066;
const COLOR_BLADE = 0xff2f45;
/** 임팩트 후 무기를 거두는 시간(ms) */
const FOLLOW_THROUGH = 420;
/** 반짝임이 잦아드는 시간(ms). FLASH_LEAD(1초)보다 짧아야 신호가 끊겨 보인다. */
const FLASH_TIME = 420;

export interface Boss {
  object: THREE.Group;
  /**
   * 예비동작 시작. windup(ms) 뒤에 공격이 닿는다.
   * targetZ는 낫이 날아가 꽂히는 지점 — 던지는 모션에만 쓴다.
   *
   * 연타가 촘촘하면 앞 모션이 끝나기 전에 다음 예비동작이 들어온다. 그때는
   * 새 모션이 앞 모션을 덮는다 — 플레이어가 읽어야 하는 건 "다음에 닿을
   * 공격"이므로 최신 예비동작을 보여주는 쪽이 맞다.
   *
   * 반환값은 이 모션의 식별자다. strike에 그대로 넘겨야 한다.
   */
  cast(motion: GuardMotion, windup: number, targetZ: number): number;
  /**
   * 공격이 닿은 순간. 후속 동작으로 넘긴다.
   * 이미 다음 모션으로 덮인 뒤라면 무시된다 — 그래서 token이 필요하다.
   */
  strike(token: number): void;
  /**
   * "온다"는 신호. 날카롭게 한 번 번쩍인 뒤 잦아든다.
   * 이 반짝임에서 1초 뒤에 모션이 시작된다.
   */
  flash(): void;
  /** 금색 발광 0~1 — 예비동작의 진행도를 나타낸다 */
  setGlow(amount: number): void;
  setCue(visible: boolean): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

interface Motion {
  token: number;
  kind: GuardMotion;
  windup: number;
  targetZ: number;
  elapsed: number;
  /** 임팩트를 지났으면 후속 동작 경과 시간(ms) */
  after: number | null;
  /** 낫을 이미 던졌는가 */
  released: boolean;
}

/** 날아가는 낫 */
interface Projectile {
  mesh: THREE.Group;
  fromZ: number;
  toZ: number;
  /** 남은 비행 시간(ms) */
  life: number;
  total: number;
}

const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
/** 구간 [a, b]에서의 0~1 진행도 */
const phase = (t: number, a: number, b: number) =>
  Math.max(0, Math.min(1, (t - a) / (b - a)));

export function createBoss(bossZ: number): Boss {
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

  // ---------- 무기 ----------
  //
  // 팔 대신 "손 위치"에 무기 축(arm)을 두고 그걸 회전시킨다. 관절을 제대로
  // 만드는 것보다 훨씬 단순한데, 쿼터뷰에서 보이는 결과는 거의 같다.
  const arm = new THREE.Group();
  arm.position.set(1.1, 3.2, 0);
  // 쿼터뷰에서 보스가 작게 잡히므로 무기는 실제 비율보다 키운다.
  // 모션을 보고 치는 게임이라 무기가 안 보이면 아무 의미가 없다.
  arm.scale.setScalar(1.35);
  body.add(arm);

  const scythe = buildScythe();
  const hammer = buildHammer();
  const wheel = buildWaterwheel();
  const broom = buildBroom();
  const all = [scythe, hammer, wheel, broom];
  for (const w of all) {
    w.visible = false;
    arm.add(w);
  }

  const weapons: Record<GuardMotion, THREE.Group> = {
    scythe,
    'hammer-spin': hammer,
    'hammer-slow': hammer,
    waterwheel: wheel,
    broom,
  };

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
  let motion: Motion | null = null;
  let projectiles: Projectile[] = [];
  let nextToken = 1;
  /** 반짝임의 남은 시간(ms) */
  let flashLeft = 0;
  /** setGlow로 들어온 예비동작 밝기 — 반짝임과 합쳐서 최종 발광이 된다 */
  let baseGlow = 0;

  function hideWeapons() {
    for (const w of all) {
      w.visible = false;
      w.rotation.set(0, 0, 0);
    }
  }

  /**
   * 예비동작 밝기와 반짝임을 합쳐 재질에 반영한다.
   * 반짝임은 예비동작 밝기를 덮어쓰지 않고 위로 얹힌다 — 그래야 모션
   * 도중에 다음 공격이 예고돼도 두 신호가 서로를 지우지 않는다.
   */
  function applyGlow() {
    const pulse = flashLeft > 0 ? flashLeft / FLASH_TIME : 0;
    const a = baseGlow;
    // 반짝임(pulse)만 세게 때리고 예비동작 밝기(a)는 낮게 깐다.
    //
    // 예전엔 예비동작이 진행될수록 보스를 밝게 물들였는데, 임팩트 직전에는
    // 실루엣이 통째로 금색 덩어리가 되어 무기가 안 보였다. 이제 신호는
    // 반짝임이 따로 담당하므로 예비동작 밝기는 은은한 정도면 충분하다.
    goldMat.emissive.setRGB(a * 0.3 + pulse * 0.55, a * 0.2 + pulse * 0.4, pulse * 0.12);
    goldMat.color.copy(goldBase).lerp(glowTarget, Math.min(1, a * 0.2 + pulse * 0.6));
    // 로브는 거의 물들이지 않는다. 여기까지 밝히면 실루엣이 뭉개져
    // 무기가 어디 있는지가 안 보인다.
    darkMat.emissive.setRGB(a * 0.03 + pulse * 0.18, a * 0.02 + pulse * 0.12, 0);
    darkMat.color.copy(darkBase);
  }

  /** 무기를 기본 자세로 되돌린다 */
  function restArm() {
    arm.rotation.set(0, 0, 0);
    arm.position.set(1.1, 3.2, 0);
  }

  function spawnThrownScythe(fromZ: number, toZ: number, travel: number) {
    const mesh = buildScythe();
    mesh.scale.setScalar(1.15);
    mesh.position.set(0, 2.6, fromZ);
    group.parent?.add(mesh);
    projectiles.push({ mesh, fromZ, toZ, life: travel, total: travel });
  }

  /**
   * 모션별 자세. p는 예비동작 진행도(0~1), after는 임팩트 후 경과 비율(0~1).
   * 임팩트 직전에 빠르게 움직이도록 후반부에 가속을 준다 —
   * 그래야 "지금 온다"가 눈에 보인다.
   */
  function poseArm(m: Motion, p: number, after: number | null) {
    restArm();

    switch (m.kind) {
      // 낫을 머리 위로 크게 들었다가 통로를 향해 던진다
      case 'scythe': {
        const raise = phase(p, 0, 0.7);
        arm.rotation.z = -easeOut(raise) * 2.4;
        arm.rotation.y = easeOut(raise) * 0.8;
        arm.position.y = 3.2 + easeOut(raise) * 0.7;
        // 던진 뒤에는 손이 비어 있다
        if (m.released) scythe.visible = false;
        break;
      }

      // 망치를 머리 위로 한 바퀴 빙글 돌린 뒤 곧바로 찍는다.
      // 도는 동작이 짧게 끝나므로 느린 망치보다 훨씬 급하게 느껴진다.
      case 'hammer-spin': {
        const spin = phase(p, 0, 0.68);
        const slam = phase(p, 0.68, 1);
        arm.position.y = 3.2 + easeOut(spin) * 0.9 - easeIn(slam) * 2.0;
        // 머리 위에서 한 바퀴 — 이 회전이 이 모션의 표식이다
        arm.rotation.y = spin * Math.PI * 2;
        arm.rotation.z = -easeOut(spin) * 2.3 + easeIn(slam) * 3.4;
        if (after !== null) {
          arm.rotation.y = 0;
          arm.rotation.z = 1.1 - easeOut(after) * 1.1;
          arm.position.y = 2.3 + easeOut(after) * 0.9;
        }
        break;
      }

      // 망치를 천천히 들어올렸다가 느리게 찍는다.
      // 올리는 구간이 길고 찍는 구간도 완만해 다섯 중 가장 읽기 쉽다.
      case 'hammer-slow': {
        const raise = phase(p, 0, 0.78);
        const slam = phase(p, 0.78, 1);
        arm.rotation.z = -easeOut(raise) * 2.6 + easeOut(slam) * 3.6;
        arm.position.y = 3.2 + easeOut(raise) * 0.9 - easeOut(slam) * 2.0;
        if (after !== null) {
          arm.rotation.z = 1.0 - easeOut(after) * 1.0;
          arm.position.y = 2.3 + easeOut(after) * 0.9;
        }
        break;
      }

      // 커다란 물레방아를 머리 위에서 빙빙 돌리다가 내려찍는다.
      // 바퀴 자체가 계속 도는 게 핵심이라 무기를 따로 회전시킨다.
      case 'waterwheel': {
        const lift = phase(p, 0, 0.72);
        const slam = phase(p, 0.72, 1);
        arm.position.y = 3.2 + easeOut(lift) * 1.2 - easeIn(slam) * 2.4;
        arm.rotation.z = -easeOut(lift) * 1.4 + easeIn(slam) * 2.6;
        // 도는 속도가 붙었다가 찍는 순간 멈춘다
        wheel.rotation.z = lift * Math.PI * 5 * (1 - slam);
        if (after !== null) {
          arm.rotation.z = 1.2 - easeOut(after) * 1.2;
          arm.position.y = 2.4 + easeOut(after) * 0.8;
        }
        break;
      }

      // 빗자루를 천천히 들었다가 느리게 찍는다.
      // 망치보다 가벼워 조금 더 높이 들리지만 속도는 비슷하게 완만하다.
      case 'broom': {
        const raise = phase(p, 0, 0.75);
        const slam = phase(p, 0.75, 1);
        arm.rotation.z = -easeOut(raise) * 2.2 + easeOut(slam) * 3.2;
        arm.rotation.x = -easeOut(raise) * 0.3;
        arm.position.y = 3.2 + easeOut(raise) * 0.8 - easeOut(slam) * 2.0;
        if (after !== null) {
          arm.rotation.z = 1.0 - easeOut(after) * 1.0;
          arm.position.y = 2.4 + easeOut(after) * 0.8;
        }
        break;
      }
    }
  }

  function updateProjectiles(dt: number) {
    for (const p of projectiles) {
      p.life -= dt;
      const t = 1 - Math.max(0, p.life) / p.total;
      p.mesh.position.z = p.fromZ + (p.toZ - p.fromZ) * t;
      p.mesh.rotation.z += dt * 0.022;
      // 도착 직후 잠깐 남았다가 사라지도록 끝에서만 흐린다
      const mat = (p.mesh.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (p.life < 0) mat.opacity = Math.max(0, 1 + p.life / 200);
    }
    const dead = projectiles.filter((p) => p.life < -200);
    for (const p of dead) {
      p.mesh.parent?.remove(p.mesh);
      disposeTree(p.mesh);
    }
    if (dead.length) projectiles = projectiles.filter((p) => !dead.includes(p));
  }

  return {
    object: group,

    cast(kind, windup, targetZ) {
      const token = nextToken++;
      motion = {
        token,
        kind,
        windup: Math.max(1, windup),
        targetZ,
        elapsed: 0,
        after: null,
        released: false,
      };
      hideWeapons();
      weapons[kind].visible = true;
      restArm();
      body.rotation.y = 0;
      return token;
    },

    strike(token) {
      // 이미 다음 예비동작이 시작됐다면 그 모션을 끊지 않는다
      if (motion && motion.token === token) motion.after = 0;
    },

    flash() {
      flashLeft = FLASH_TIME;
    },

    setGlow(amount) {
      baseGlow = Math.max(0, Math.min(1, amount));
      applyGlow();
    },

    setCue(visible) {
      cueGroup.visible = visible;
    },

    update(dt) {
      // 반짝임은 스스로 잦아든다. 이걸 빼먹으면 한 번 번쩍인 뒤 영영
      // 최대 밝기로 남아 보스가 통째로 금색 덩어리가 된다.
      if (flashLeft > 0) {
        flashLeft = Math.max(0, flashLeft - dt);
        applyGlow();
      }

      // 공중에 떠 있는 느낌
      bob += dt * 0.0016;
      body.position.y = Math.sin(bob) * 0.28 + 0.9;

      if (motion) {
        motion.elapsed += dt;
        const p = Math.min(1, motion.elapsed / motion.windup);

        // 낫은 임팩트보다 먼저 손을 떠나 날아온다. 날아오는 시간이 있어야
        // "던졌다 → 온다"가 두 단계로 읽힌다.
        if (motion.kind === 'scythe' && !motion.released && p >= 0.7) {
          motion.released = true;
          const travel = motion.windup * 0.3;
          spawnThrownScythe(bossZ, motion.targetZ, travel);
        }

        const after = motion.after === null ? null : Math.min(1, motion.after / FOLLOW_THROUGH);
        poseArm(motion, p, after);

        if (motion.after !== null) {
          motion.after += dt;
          if (motion.after >= FOLLOW_THROUGH) {
            motion = null;
            hideWeapons();
            restArm();
            body.rotation.y = 0;
          }
        }
      }

      updateProjectiles(dt);

      if (cueGroup.visible) {
        cueGroup.position.y = 7.6 + Math.sin(performance.now() * 0.02) * 0.24;
      }
    },

    reset() {
      motion = null;
      hideWeapons();
      restArm();
      body.rotation.y = 0;
      for (const p of projectiles) {
        p.mesh.parent?.remove(p.mesh);
        disposeTree(p.mesh);
      }
      projectiles = [];
      this.setGlow(0);
      this.setCue(false);
    },

    dispose() {
      this.reset();
      disposeTree(group);
    },
  };
}

/** 빨간 초승달 날이 달린 낫 */
function buildScythe(): THREE.Group {
  const g = new THREE.Group();

  // 날이 첫 자식이어야 한다 — 투사체가 children[0]의 재질로 페이드한다
  const blade = new THREE.Mesh(
    new THREE.TorusGeometry(1.05, 0.11, 8, 24, Math.PI * 1.15),
    new THREE.MeshBasicMaterial({
      color: COLOR_BLADE,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    }),
  );
  blade.position.y = 2.0;
  blade.rotation.z = -0.4;
  g.add(blade);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x241a2e, roughness: 0.6 }),
  );
  shaft.position.y = 1.0;
  g.add(shaft);

  return g;
}

/** 묵직한 망치 */
function buildHammer(): THREE.Group {
  const g = new THREE.Group();

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x3a3550, roughness: 0.5, metalness: 0.4 }),
  );
  head.position.y = 2.6;
  g.add(head);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 0.28, 1.32),
    new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.3, metalness: 0.7 }),
  );
  trim.position.y = 2.6;
  g.add(trim);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 2.8, 8),
    new THREE.MeshStandardMaterial({ color: 0x241a2e, roughness: 0.6 }),
  );
  shaft.position.y = 1.2;
  g.add(shaft);

  return g;
}

/**
 * 물레방아. 테두리 + 살 + 물받이 판으로 만든다.
 * 머리 위에서 도는 게 이 모션의 표식이라 실루엣이 확실히 바퀴여야 한다.
 */
function buildWaterwheel(): THREE.Group {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.75 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xd9a441,
    roughness: 0.35,
    metalness: 0.6,
  });

  const R = 1.9;

  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.16, 8, 28), trimMat);
  rim.position.y = 2.4;
  g.add(rim);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.34, 12), trimMat);
  hub.rotation.x = Math.PI / 2;
  hub.position.y = 2.4;
  g.add(hub);

  // 살 8개와 그 끝의 물받이 판
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;

    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.12, R * 2, 0.12), woodMat);
    spoke.position.y = 2.4;
    spoke.rotation.z = a;
    g.add(spoke);

    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.5), woodMat);
    paddle.position.set(Math.cos(a) * R, 2.4 + Math.sin(a) * R, 0);
    paddle.rotation.z = a;
    g.add(paddle);
  }

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 2.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x241a2e, roughness: 0.6 }),
  );
  shaft.position.y = 0.9;
  g.add(shaft);

  return g;
}

/** 마녀의 빗자루 */
function buildBroom(): THREE.Group {
  const g = new THREE.Group();

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 3.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.7 }),
  );
  shaft.position.y = 1.5;
  g.add(shaft);

  // 솔 — 위로 갈수록 퍼지는 짚단.
  // 옆에서 봐도 부피가 있어야 빗자루로 읽히므로 원뿔대를 쓴다.
  const bristles = new THREE.Mesh(
    new THREE.CylinderGeometry(0.66, 0.26, 1.5, 12),
    new THREE.MeshStandardMaterial({ color: 0xc79a4e, roughness: 0.9 }),
  );
  bristles.position.y = 3.7;
  g.add(bristles);

  const tie = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.24, 10),
    new THREE.MeshStandardMaterial({ color: 0x8c5a2b, roughness: 0.6 }),
  );
  tie.position.y = 3.05;
  g.add(tie);

  return g;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mat = o.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}
