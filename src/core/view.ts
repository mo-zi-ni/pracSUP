import * as THREE from 'three';

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
  /** 아레나를 주어진 반지름으로 다시 만들고 카메라를 맞춘다 */
  setArena(radius: number): void;
  resize(): void;
  render(): void;
}

/** 로아 시점에 가까운 각도. 45도 회전 + 약 52도 내려다보기. */
export const CAMERA_YAW = Math.PI / 4;
const CAMERA_PITCH = THREE.MathUtils.degToRad(52);

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

  function setArena(radius: number) {
    clearGroup(arena);
    buildArena(arena, radius);

    viewSize = radius * 1.35;
    const dist = radius * 3;
    camera.position.set(
      Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH) * dist,
      Math.sin(CAMERA_PITCH) * dist,
      Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH) * dist,
    );
    camera.lookAt(0, 0, 0);
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

function buildArena(parent: THREE.Group, radius: number): void {
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
