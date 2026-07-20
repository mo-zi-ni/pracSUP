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
  /** 금색 발광 0~1 — 가드 가능 구간임을 알린다 */
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
  const spear = buildSpear();
  for (const w of [scythe, hammer, spear]) {
    w.visible = false;
    arm.add(w);
  }

  const weapons: Record<GuardMotion, THREE.Group> = {
    scythe,
    hammer,
    thrust: spear,
    sweep: scythe,
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

  function hideWeapons() {
    for (const w of [scythe, hammer, spear]) w.visible = false;
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
        arm.position.y = 3.2 + easeOut(raise) * 1.1;
        // 던진 뒤에는 손이 비어 있다
        if (m.released) scythe.visible = false;
        break;
      }

      // 망치를 치켜들었다가 내려찍는다. 예비동작이 길고 임팩트가 갑작스럽다.
      case 'hammer': {
        const raise = phase(p, 0, 0.72);
        const slam = phase(p, 0.72, 1);
        // 뒤로 크게 젖혔다가(-2.5) 앞으로 내려찍는다(+1.0)
        arm.rotation.z = -easeOut(raise) * 2.5 + easeIn(slam) * 3.5;
        arm.position.y = 3.2 + easeOut(raise) * 1.4 - easeIn(slam) * 2.2;
        if (after !== null) {
          // 찍은 자세로 잠깐 머물렀다가 천천히 든다
          arm.rotation.z = 1.0 - easeOut(after) * 1.0;
          arm.position.y = 2.4 + easeOut(after) * 0.8;
        }
        break;
      }

      // 창을 뒤로 당겼다가 내지른다. 당기는 폭이 작아 제일 빠르게 느껴진다.
      case 'thrust': {
        const pull = phase(p, 0, 0.6);
        const stab = phase(p, 0.6, 1);
        arm.rotation.x = -0.35 - easeOut(pull) * 0.5;
        arm.position.z = easeOut(pull) * 1.2 - easeIn(stab) * 4.2;
        if (after !== null) arm.position.z = -3.0 + easeOut(after) * 3.0;
        break;
      }

      // 몸을 비틀었다가 통로 전체를 옆으로 훑는다
      case 'sweep': {
        const wind = phase(p, 0, 0.62);
        const swing = phase(p, 0.62, 1);
        body.rotation.y = -easeOut(wind) * 0.7 + easeIn(swing) * 1.6;
        arm.rotation.z = -0.5 - easeOut(wind) * 0.4;
        arm.rotation.y = -easeOut(wind) * 1.0 + easeIn(swing) * 2.2;
        if (after !== null) {
          body.rotation.y = 0.9 * (1 - easeOut(after));
          arm.rotation.y = 1.2 * (1 - easeOut(after));
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

    setGlow(amount) {
      const a = Math.max(0, Math.min(1, amount));
      // 금색 장식만 확실히 빛나게 하고 검은 로브는 어둡게 둔다.
      // 전체를 물들이면 실루엣이 사라져 "모션을 보고 친다"가 성립하지 않는다.
      goldMat.emissive.setRGB(a * 0.55, a * 0.38, 0);
      goldMat.color.copy(goldBase).lerp(glowTarget, a * 0.35);
      // 로브는 물들이지 않는다. 여기까지 밝히면 실루엣이 뭉개져
      // 무기가 어디 있는지가 안 보인다.
      darkMat.emissive.setRGB(a * 0.06, a * 0.04, 0);
      darkMat.color.copy(darkBase);
    },

    setCue(visible) {
      cueGroup.visible = visible;
    },

    update(dt) {
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

/** 찌르기용 창 */
function buildSpear(): THREE.Group {
  const g = new THREE.Group();

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 1.1, 10),
    new THREE.MeshBasicMaterial({ color: COLOR_BLADE }),
  );
  tip.position.y = 2.9;
  g.add(tip);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 4.0, 8),
    new THREE.MeshStandardMaterial({ color: 0x241a2e, roughness: 0.6 }),
  );
  shaft.position.y = 1.2;
  g.add(shaft);

  // 창은 앞으로 눕혀 든다
  g.rotation.x = Math.PI / 2.2;
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
