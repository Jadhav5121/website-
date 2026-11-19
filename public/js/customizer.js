// 3D tee customiser. Loaded on demand from the Customise page.
// Three.js is loaded as a full module URL because the Content Security Policy blocks inline import maps.
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const S = 0.013; // SVG units to scene units
// Tee outline, taken from the storefront's SVG garment (viewBox 200 x 190).
const OUTLINE = [[62, 16], [22, 38], [5, 78], [38, 90], [46, 74], [46, 172], [154, 172], [154, 74], [162, 90], [195, 78], [178, 38], [138, 16]];
const toXY = (x, y) => [(x - 100) * S, (95 - y) * S];

function buildTeeGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(...toXY(...OUTLINE[0]));
  for (const p of OUTLINE.slice(1)) shape.lineTo(...toXY(...p));
  // Neck curve back to the start point.
  shape.quadraticCurveTo(...toXY(100, 36), ...toXY(62, 16));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4, curveSegments: 14,
  });
  geo.center();
  return geo;
}

function luminance(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function printTexture(text, font, ink) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (text) {
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const family = font === 'sans' ? 'Inter, Arial, sans-serif' : '"Cormorant Garamond", Georgia, serif';
    // Shrink the type until it fits the print area.
    let size = 280;
    do {
      ctx.font = `700 ${size}px ${family}`;
      size -= 8;
    } while (ctx.measureText(text).width > canvas.width * 0.86 && size > 40);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 10);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export async function createCustomiser(host) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    throw new Error('WebGL is not available on this device.');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.insertBefore(renderer.domElement, host.firstChild);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.1, 6.2);

  scene.add(new THREE.HemisphereLight(0xfff6e6, 0x2a2118, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xf2d68f, 0.8);
  rim.position.set(-3, 1, -3);
  scene.add(rim);

  const geometry = buildTeeGeometry();
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xd6a24a, roughness: 0.88, metalness: 0, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff),
  });
  const tee = new THREE.Mesh(geometry, material);

  // Print decal: a plane that sits just off the chest (front) or back of the tee.
  const printMat = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const print = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.475), printMat);
  print.position.set(0, 0.42, 0.07);

  const pivot = new THREE.Group();
  pivot.add(tee, print);
  scene.add(pivot);

  // Drag to rotate. Auto-rotate gently until the first interaction.
  let auto = true;
  let dragging = false;
  let lastX = 0;
  let velocity = 0;
  let yaw = 0;
  const pointer = {
    down(e) { dragging = true; auto = false; lastX = e.clientX; host.setPointerCapture?.(e.pointerId); },
    move(e) { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; velocity = dx * 0.01; yaw += velocity; },
    up() { dragging = false; },
  };
  host.addEventListener('pointerdown', pointer.down);
  host.addEventListener('pointermove', pointer.move);
  window.addEventListener('pointerup', pointer.up);
  host.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.position.z = THREE.MathUtils.clamp(camera.position.z + e.deltaY * 0.004, 4.2, 8);
  }, { passive: false });

  const resize = () => {
    const w = host.clientWidth || 600;
    const h = host.clientHeight || w;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let running = true;
  let raf = 0;
  const tick = () => {
    if (!running) return;
    if (auto) yaw += 0.004;
    else if (!dragging) { velocity *= 0.92; yaw += velocity; }
    pivot.rotation.y = yaw;
    pivot.rotation.x = Math.sin(performance.now() / 1400) * 0.04;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible && !running) { running = true; tick(); }
    if (!visible) { running = false; cancelAnimationFrame(raf); }
  });
  io.observe(host);
  tick();

  let lastPrint = '';
  return {
    setTee(hex) {
      material.color.set(hex);
      printMat.needsUpdate = true;
    },
    setPrint({ text = '', font = 'serif', place = 'front', tee: hex = '#d6a24a' }) {
      const key = `${text}|${font}|${place}|${hex}`;
      if (key !== lastPrint) {
        lastPrint = key;
        const ink = luminance(hex) > 0.5 ? '#0b0a08' : '#f2d68f';
        if (printMat.map) printMat.map.dispose();
        printMat.map = printTexture(text, font, ink);
        printMat.needsUpdate = true;
      }
      const back = place === 'back';
      print.position.set(0, 0.42, back ? -0.07 : 0.07);
      print.rotation.y = back ? Math.PI : 0;
      print.visible = Boolean(text);
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
