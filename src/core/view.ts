import * as THREE from 'three';
import type { Arena } from '../game/types';

/**
 * 쿼터뷰 고정 카메라 + 아레나 씬.
 * 3D 공간이지만 카메라를 고정해 로아 특유의 시점을 만든다.
 *
 * 렌더러는 한 번만 만들고 재사용한다. 패턴을 바꿀 때마다 WebGLRenderer를
 * 새로 만들면 컨텍스트가 누수되므로, 바뀌는 것(아레나 크기)만 setArena로 교체한다.
 */
export interface View {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  /** 마우스 레이캐스트용 바닥 평면 (y=0) */
  groundPlane: THREE.Plane;
  /** 아레나를 다시 만들고 카메라를 맞춘다 */
  setArena(arena: Arena): void;
  resize(): void;
  render(): void;
}

/**
 * 시점 각도. 원형 아레나는 로아처럼 45도 돌려 보고,
 * 통로는 돌리지 않는다 — 대난투는 통로가 화면 세로로 곧게 서야 읽힌다.
 */
const YAW_CIRCLE = Math.PI / 4;
const YAW_CORRIDOR = 0;
const CAMERA_PITCH = THREE.MathUtils.degToRad(52);

let cameraYaw = YAW_CIRCLE;

/** WASD를 화면 기준으로 맞추려면 플레이어도 현재 시점 각도를 알아야 한다. */
export function getCameraYaw(): number {
  return cameraYaw;
}

export function createView(canvas: HTMLCanvasElement): View {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d14);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(20, 40, 15);
  scene.add(key);

  const arena = new THREE.Group();
  scene.add(arena);

  // 아레나 전체가 화면에 들어오도록 여유를 둔 값. setArena에서 갱신된다.
  let viewSize = 1;

  function applyCamera() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;

    // 세로가 짧아도 아레나가 잘리지 않도록 짧은 축을 기준으로 맞춘다
    const aspect = w / h;
    if (aspect >= 1) {
      camera.left = -viewSize * aspect;
      camera.right = viewSize * aspect;
      camera.top = viewSize;
      camera.bottom = -viewSize;
    } else {
      camera.left = -viewSize;
      camera.right = viewSize;
      camera.top = viewSize / aspect;
      camera.bottom = -viewSize / aspect;
    }
    camera.updateProjectionMatrix();
  }

  function setArena(shape: Arena) {
    clearGroup(arena);

    // 카메라가 담아야 하는 반경. 통로는 긴 축을 기준으로 잡는다.
    let radius: number;
    if (shape.kind === 'circle') {
      buildCircleArena(arena, shape.radius);
      radius = shape.radius;
      cameraYaw = YAW_CIRCLE;
    } else {
      buildCorridorArena(arena, shape);
      // 통로는 세로 길이를 기준으로 잡는다. 폭을 기준으로 하면 화면이 텅 빈다.
      radius = ((shape.near - shape.far) / 2) * 0.88;
      cameraYaw = YAW_CORRIDOR;
    }

    viewSize = radius * 1.35;
    const dist = radius * 3;
    camera.position.set(
      Math.sin(cameraYaw) * Math.cos(CAMERA_PITCH) * dist,
      Math.sin(CAMERA_PITCH) * dist,
      Math.cos(cameraYaw) * Math.cos(CAMERA_PITCH) * dist,
    );
    // 통로는 가운데를 봐야 위아래가 균형 있게 잡힌다
    const focusZ = shape.kind === 'corridor' ? (shape.far + shape.near) / 2 : 0;
    camera.position.z += focusZ;
    camera.lookAt(0, 0, focusZ);
    camera.far = dist * 4;
    applyCamera();
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    applyCamera();
  }

  return {
    scene,
    camera,
    renderer,
    groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    setArena,
    resize,
    render: () => renderer.render(scene, camera),
  };
}

function buildCircleArena(parent: THREE.Group, radius: number): void {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 96),
    new THREE.MeshStandardMaterial({ color: 0x1c2030, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  parent.add(floor);

  // 5칸마다 동심원 — 사각 격자보다 낫다. 도넛 장판의 안쪽 반지름이나
  // "보스에서 7 거리"를 눈으로 재려면 거리 눈금이 원형이어야 한다.
  for (let r = 5; r < radius; r += 5) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.04, r + 0.04, 96),
      new THREE.MeshBasicMaterial({ color: 0x2e3550, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    parent.add(ring);
  }

  // 3시간 간격 스포크 — 사분면을 나눠 콜 위치를 잡는 데 쓴다
  for (const hour of [0, 3, 6, 9]) {
    const angle = (hour / 12) * Math.PI * 2;
    const spoke = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, radius),
      new THREE.MeshBasicMaterial({ color: 0x272d42, side: THREE.DoubleSide }),
    );
    spoke.rotation.x = -Math.PI / 2;
    spoke.position.set(
      (Math.sin(angle) * radius) / 2,
      0.01,
      (-Math.cos(angle) * radius) / 2,
    );
    spoke.rotation.z = -angle;
    parent.add(spoke);
  }

  const edge = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.25, radius, 96),
    new THREE.MeshBasicMaterial({ color: 0x4a5578, side: THREE.DoubleSide }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.02;
  parent.add(edge);

  // 시계 방향 눈금(12/3/6/9시가 굵게) — 공대 콜을 연습하려면 필요하다
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const major = i % 3 === 0;
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(major ? 0.5 : 0.2, 0.05, major ? 2.4 : 1.2),
      new THREE.MeshBasicMaterial({ color: major ? 0x6f7ca8 : 0x39405c }),
    );
    // 12시를 -Z에 두고 시계 방향으로 배치
    tick.position.set(Math.sin(angle) * (radius - 1.4), 0.03, -Math.cos(angle) * (radius - 1.4));
    tick.rotation.y = -angle;
    parent.add(tick);
  }
}

/**
 * 대난투 통로. 좌우가 파란 빛 기둥으로 막힌 좁고 긴 공간.
 * 보스가 안쪽(-Z), 플레이어가 바깥쪽(+Z)에 선다.
 */
function buildCorridorArena(
  parent: THREE.Group,
  { halfWidth, far, near }: { halfWidth: number; far: number; near: number },
): void {
  const length = near - far;
  const midZ = (far + near) / 2;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(halfWidth * 2, length),
    new THREE.MeshStandardMaterial({ color: 0x171b28, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = midZ;
  parent.add(floor);

  // 거리 눈금 — 통로에서는 가로선이 곧 "보스와의 거리"다
  for (let z = far + 4; z < near; z += 4) {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(halfWidth * 2, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x262d42, side: THREE.DoubleSide }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.01, z);
    parent.add(line);
  }

  // 좌우 파란 빛 벽. 실제로 이 선 밖으로는 못 나간다.
  for (const side of [-1, 1]) {
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(length, 3.2),
      new THREE.MeshBasicMaterial({
        color: 0x4d7dff,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.rotation.y = Math.PI / 2;
    glow.position.set(side * halfWidth, 1.4, midZ);
    parent.add(glow);

    // 바닥에 닿는 밝은 심지
    const core = new THREE.Mesh(
      // 폭이 X, 길이가 Z를 향하도록 — 반대로 두면 통로 밖으로 뻗어나간다
      new THREE.PlaneGeometry(0.18, length),
      new THREE.MeshBasicMaterial({ color: 0xa8c8ff, side: THREE.DoubleSide }),
    );
    core.rotation.x = -Math.PI / 2;
    core.position.set(side * halfWidth, 0.04, midZ);
    parent.add(core);
  }

  // 보스가 선 안쪽 끝을 어둡게 막아 통로 끝이라는 걸 보여준다
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(halfWidth * 2, 6),
    new THREE.MeshBasicMaterial({ color: 0x0d1020, side: THREE.DoubleSide }),
  );
  backdrop.position.set(0, 3, far);
  parent.add(backdrop);
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mat = o.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  }
}
