import * as THREE from 'three';

const NO_RED = 0xba0c2f;
const NO_BLUE = 0x00205b;
const NO_WHITE = 0xf4f6fb;
const WOOD_DARK = 0x5a3a22;
const WOOD_MID = 0x7a5230;
const WOOD_LIGHT = 0x99693e;

function woodMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.05 });
}

// ---- Flag texture (canvas): Norway or Sweden ----
function makeFlagTexture(team = 'norway') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 186;
  const g = c.getContext('2d');
  if (team === 'sweden') {
    g.fillStyle = '#005ba0'; g.fillRect(0, 0, 256, 186);
    g.fillStyle = '#fecc02';
    g.fillRect(64, 0, 40, 186); g.fillRect(0, 73, 256, 40);
  } else {
    g.fillStyle = '#ba0c2f'; g.fillRect(0, 0, 256, 186);
    g.fillStyle = '#ffffff';
    g.fillRect(58, 0, 52, 186); g.fillRect(0, 67, 256, 52);
    g.fillStyle = '#00205b';
    g.fillRect(71, 0, 26, 186); g.fillRect(0, 80, 256, 26);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- Sail texture: team colors + emblem ----
function makeSailTexture(team = 'norway') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const stripeA = team === 'sweden' ? '#fecc02' : '#c8102e';
  const stripeB = team === 'sweden' ? '#0072ce' : '#f2f2f2';
  const bandCol = team === 'sweden' ? '#005ba0' : '#00205b';
  const teamName = team === 'sweden' ? 'SVERIGE' : 'NORGE';
  // base layer: stripes + middle band (repainted before the shield overlay)
  const paintBase = () => {
    g.fillStyle = stripeA;
    g.fillRect(0, 0, 512, 512);
    const stripe = 512 / 7;
    for (let i = 0; i < 7; i++) {
      g.fillStyle = i % 2 === 0 ? stripeA : stripeB;
      g.fillRect(i * stripe, 0, stripe, 512);
    }
    g.fillStyle = bandCol;
    g.fillRect(0, 200, 512, 112);
  };
  paintBase();
  // football in the middle
  const cx = 256, cy = 256, r = 88;
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#111111';
  // center pentagon
  const pent = (cxx, cyy, rr, rot = 0) => {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2 - Math.PI / 2;
      const x = cxx + Math.cos(a) * rr, y = cyy + Math.sin(a) * rr;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath(); g.fill();
  };
  pent(cx, cy, 26);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    pent(cx + Math.cos(a) * 62, cy + Math.sin(a) * 62, 16, a);
  }
  g.strokeStyle = '#111'; g.lineWidth = 5;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  // team name text
  g.fillStyle = team === 'sweden' ? '#fecc02' : '#ffffff';
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
  g.font = '900 54px "Avenir Next", system-ui, sans-serif';
  g.textAlign = 'center';
  g.strokeText(teamName, 256, 120); g.fillText(teamName, 256, 120);
  g.strokeText('⚽ 2026 ⚽', 256, 430); g.fillText('⚽ 2026 ⚽', 256, 430);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  // Norway's sail carries the NORGE shield emblem. The ship is built
  // synchronously, so the procedural sail above is the immediate (and
  // fallback) look; when the PNG arrives we repaint base + shield.
  if (team === 'norway') {
    const img = new Image();
    img.onload = () => {
      paintBase(); // wipe the football/text, keep stripes + band
      const sh = 512 * 0.58;
      const sw = sh * (img.width / img.height);
      g.drawImage(img, (512 - sw) / 2, (512 - sh) / 2, sw, sh);
      tex.needsUpdate = true;
    };
    img.onerror = () => { /* PNG missing → keep today's procedural sail */ };
    img.src = '/norge-skjold.png';
  }
  return tex;
}

// ---- Hull built from lofted cross-sections ----
function buildHull() {
  const group = new THREE.Group();

  // Hull via lathe-like custom geometry: series of ribs from bow to stern
  const L = 16; // half-length reach
  const segs = 34;
  const ringPts = 9;
  const positions = [];
  const indices = [];

  // hull profile: width & depth vary along length; dramatic upswept bow/stern
  const prof = (t) => {
    // t in [0,1] bow->stern
    const s = Math.sin(t * Math.PI); // 0 at ends, 1 middle
    const width = 2.5 * Math.pow(s, 0.62);
    const depth = 1.45 * Math.pow(s, 0.5) + 0.12;
    const sweep = Math.pow(Math.abs(t - 0.5) * 2, 3.2) * 3.4; // ends curve up
    return { width, depth, sweep };
  };

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = (t - 0.5) * 2 * L;
    const { width, depth, sweep } = prof(t);
    for (let j = 0; j <= ringPts; j++) {
      const a = (j / ringPts) * Math.PI; // half circle, port->starboard
      const x = Math.cos(a) * width;
      const y = -Math.sin(a) * depth + sweep;
      positions.push(x, y, z);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < ringPts; j++) {
      const a = i * (ringPts + 1) + j;
      const b = a + ringPts + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  hullGeo.setIndex(indices);
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: WOOD_MID, roughness: 0.8, side: THREE.DoubleSide }));
  hull.castShadow = true;
  group.add(hull);

  // plank stripes (thin boxes along the hull sides for that clinker look)
  const plankMat = woodMat(WOOD_DARK);
  for (const side of [-1, 1]) {
    for (let p = 0; p < 3; p++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, L * 2 * 0.82), plankMat);
      plank.position.set(side * (2.32 - p * 0.28), -0.15 - p * 0.42, 0);
      plank.rotation.z = side * (0.35 + p * 0.16);
      group.add(plank);
    }
  }

  // gunwale rail
  const railMat = woodMat(WOOD_LIGHT);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, L * 2 * 0.8), railMat);
    rail.position.set(side * 2.42, 0.28, 0);
    group.add(rail);
  }

  // deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, L * 2 * 0.78), woodMat(WOOD_LIGHT));
  deck.position.y = -0.28;
  group.add(deck);

  // dragon head (bow) — stylized with cones/spheres
  const dragon = new THREE.Group();
  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.2, -L * 0.97),
    new THREE.Vector3(0, 2.6, -L * 1.04),
    new THREE.Vector3(0, 3.8, -L * 0.98),
    new THREE.Vector3(0, 4.4, -L * 0.86),
  ]);
  const neck = new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 12, 0.34, 8), woodMat(WOOD_DARK));
  dragon.add(neck);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.5, 8), woodMat(WOOD_DARK));
  head.position.set(0, 4.5, -L * 0.78);
  head.rotation.x = Math.PI / 2.3;
  dragon.add(head);
  // eyes — hot emissive so the bloom pass makes them burn at dusk
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd25e, emissive: 0xffa500, emissiveIntensity: 2.2 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), eyeMat);
    eye.position.set(s * 0.22, 4.62, -L * 0.83);
    dragon.add(eye);
  }
  // horns
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 6), woodMat(WOOD_LIGHT));
    horn.position.set(s * 0.24, 4.95, -L * 0.88);
    horn.rotation.z = -s * 0.5;
    dragon.add(horn);
  }
  group.add(dragon);

  // stern tail spiral
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.2, L * 0.97),
    new THREE.Vector3(0, 2.7, L * 1.03),
    new THREE.Vector3(0, 3.7, L * 0.94),
    new THREE.Vector3(0, 3.9, L * 0.82),
  ]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 10, 0.28, 8), woodMat(WOOD_DARK));
  group.add(tail);

  return { group, L };
}

// ---- Shields along the gunwale: alternating Norway colors ----
function addShields(group, L, team = 'norway') {
  const shieldGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.1, 16);
  shieldGeo.rotateZ(Math.PI / 2);
  const bossGeo = new THREE.SphereGeometry(0.13, 8, 8);
  const colors = team === 'sweden' ? [0xfecc02, 0x0072ce, 0x005ba0] : [NO_RED, NO_WHITE, NO_BLUE];
  const bossMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd6, metalness: 0.8, roughness: 0.35 });
  const mats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 }));
  const n = 7;
  for (let i = 0; i < n; i++) {
    const z = ((i / (n - 1)) - 0.5) * L * 1.35;
    for (const side of [-1, 1]) {
      const sh = new THREE.Mesh(shieldGeo, mats[(i + (side > 0 ? 1 : 0)) % 3]);
      sh.position.set(side * 2.52, 0.42, z);
      group.add(sh);
      const boss = new THREE.Mesh(bossGeo, bossMat);
      boss.position.set(side * 2.62, 0.42, z);
      group.add(boss);
    }
  }
}

// ---- One rower in Norway football kit; returns group + animatable parts ----
function buildRower(kitMats) {
  const g = new THREE.Group();
  const { shirt, shorts, skin, sock } = kitMats;

  // torso (red shirt)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.42, 4, 8), shirt);
  torso.position.y = 0.78;
  g.add(torso);
  // head + helmet-ish hair band (viking football hybrid: red headband)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), skin);
  head.position.y = 1.38;
  g.add(head);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.045, 6, 12), shorts);
  band.position.y = 1.45;
  band.rotation.x = Math.PI / 2.4;
  g.add(band);
  // tiny horns on the headband — viking touch
  const hornMat = new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.5 });
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 6), hornMat);
    horn.position.set(s * 0.17, 1.52, 0);
    horn.rotation.z = -s * 0.7;
    g.add(horn);
  }

  // legs (white shorts + blue socks) — static, seated forward
  for (const s of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 4, 6), shorts);
    thigh.position.set(s * 0.15, 0.42, -0.22);
    thigh.rotation.x = Math.PI / 2.2;
    g.add(thigh);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.3, 4, 6), sock);
    shin.position.set(s * 0.15, 0.22, -0.42);
    shin.rotation.x = 0.25;
    g.add(shin);
  }

  // arms — two pivots at the shoulders so they can swing with the oar
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.28, 1.05, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.42, 4, 6), shirt);
    arm.position.set(0, -0.05, -0.3);
    arm.rotation.x = Math.PI / 2.1;
    pivot.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), skin);
    hand.position.set(0, -0.08, -0.56);
    pivot.add(hand);
    g.add(pivot);
    arms.push(pivot);
  }

  return { group: g, arms, torso };
}

const TEAM_KITS = {
  norway: { shirt: NO_RED, shorts: NO_WHITE, sock: NO_BLUE },
  sweden: { shirt: 0xfecc02, shorts: 0x0072ce, sock: 0xfecc02 },
};

// ---- The full ship ----
export function buildShip(team = 'norway') {
  const ship = new THREE.Group();
  const { group: hullGroup, L } = buildHull();
  ship.add(hullGroup);
  addShields(hullGroup, L, team);

  // mast + sail + flag
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 9.4, 8), woodMat(WOOD_DARK));
  mast.position.y = 4.4;
  ship.add(mast);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 7.6, 8), woodMat(WOOD_DARK));
  yard.rotation.z = Math.PI / 2;
  yard.position.y = 7.6;
  ship.add(yard);

  // sail — slightly curved plane, raised high so the view ahead stays clear
  const sailGeo = new THREE.PlaneGeometry(6.6, 3.2, 16, 8);
  const sailPos = sailGeo.attributes.position;
  for (let i = 0; i < sailPos.count; i++) {
    const x = sailPos.getX(i), y = sailPos.getY(i);
    sailPos.setZ(i, Math.sin((x / 6.6 + 0.5) * Math.PI) * 0.7 * (0.4 + 0.6 * (0.5 - y / 3.2)));
  }
  sailGeo.computeVertexNormals();
  const sail = new THREE.Mesh(
    sailGeo,
    new THREE.MeshStandardMaterial({ map: makeSailTexture(team), side: THREE.DoubleSide, roughness: 0.9 })
  );
  sail.position.y = 6.0; // hangs from the yard, readable from the chase camera
  ship.add(sail);

  // flag at masthead
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.95, 10, 4),
    new THREE.MeshStandardMaterial({ map: makeFlagTexture(team), side: THREE.DoubleSide, roughness: 0.9 })
  );
  flag.position.set(0.72, 9.4, 0);
  ship.add(flag);

  // ---- rowers + oars ----
  const kit = TEAM_KITS[team] || TEAM_KITS.norway;
  const kitMats = {
    shirt: new THREE.MeshStandardMaterial({ color: kit.shirt, roughness: 0.7 }),
    shorts: new THREE.MeshStandardMaterial({ color: kit.shorts, roughness: 0.7 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xe8b58f, roughness: 0.8 }),
    sock: new THREE.MeshStandardMaterial({ color: kit.sock, roughness: 0.7 }),
  };
  const oarMat = woodMat(WOOD_LIGHT);
  const bladeMat = new THREE.MeshStandardMaterial({ color: kit.shirt, roughness: 0.6 });

  const rowers = [];
  const oars = [];
  const N_PER_SIDE = 4;
  for (let i = 0; i < N_PER_SIDE; i++) {
    const z = (i - (N_PER_SIDE - 1) / 2) * 3.1 + 0.8;
    for (const side of [-1, 1]) {
      const r = buildRower(kitMats);
      r.group.position.set(side * 1.15, -0.2, z);
      r.group.rotation.y = 0; // face bow (-z)? rowers face stern traditionally; keep facing bow for looks
      ship.add(r.group);
      rowers.push({ ...r, side, phase: i * 0.0 });

      // oar: pivot at the gunwale
      const oarPivot = new THREE.Group();
      oarPivot.position.set(side * 2.45, 0.35, z);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 4.6, 6), oarMat);
      shaft.rotation.z = Math.PI / 2;
      shaft.position.x = side * 2.0;
      oarPivot.add(shaft);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.34), bladeMat);
      blade.position.x = side * 4.2;
      oarPivot.add(blade);
      ship.add(oarPivot);
      oars.push({ pivot: oarPivot, side });
    }
  }

  // lanterns fore and aft — warm glow against the dusk (bloom picks these up)
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffc46b, emissive: 0xff9540, emissiveIntensity: 2.6,
  });
  const lanternCageMat = woodMat(WOOD_DARK);
  for (const lz of [-L * 0.7, L * 0.7]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6), lanternCageMat);
    post.position.set(0, 1.6, lz);
    ship.add(post);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), lanternMat);
    lamp.position.set(0, 2.25, lz);
    ship.add(lamp);
  }

  // ---- stern figure: HAALAND on the drum (Norway) / plain captain (others) ----
  let haaland = null;
  if (team === 'norway') {
    const h = buildRower(kitMats);
    h.group.position.set(0, 0.15, L * 0.62);
    h.group.scale.setScalar(1.45); // unmistakably the big man
    ship.add(h.group);
    // blond mop of hair
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.215, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xf2dc8a, roughness: 0.85 })
    );
    hair.position.y = 1.5;
    hair.scale.y = 0.7;
    h.group.add(hair);
    // war drum in front of him
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.62, 0.72, 12), woodMat(WOOD_DARK));
    drum.position.set(0, 0.78, L * 0.62 - 1.6);
    ship.add(drum);
    const drumTop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.57, 0.57, 0.06, 12),
      new THREE.MeshStandardMaterial({ color: 0xf4e9d2, roughness: 0.9 })
    );
    drumTop.position.set(0, 1.17, L * 0.62 - 1.6);
    ship.add(drumTop);
    // name plate that always faces the camera
    const nc = document.createElement('canvas');
    nc.width = 512; nc.height = 112;
    const ng = nc.getContext('2d');
    ng.fillStyle = 'rgba(186, 12, 47, 0.92)';
    ng.beginPath();
    ng.roundRect(8, 10, 496, 92, 22);
    ng.fill();
    ng.lineWidth = 6;
    ng.strokeStyle = '#ffffff';
    ng.stroke();
    ng.font = '900 58px "Avenir Next", system-ui, sans-serif';
    ng.textAlign = 'center';
    ng.textBaseline = 'middle';
    ng.fillStyle = '#ffffff';
    ng.fillText('HAALAND  9', 256, 58);
    const nameTex = new THREE.CanvasTexture(nc);
    nameTex.colorSpace = THREE.SRGBColorSpace;
    const namePlate = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTex, transparent: true, depthWrite: false }));
    namePlate.scale.set(4.6, 1.0, 1);
    namePlate.position.set(0, 3.9, L * 0.62);
    ship.add(namePlate);
    haaland = { group: h.group, arms: h.arms, drumTop };
  } else {
    const captain = buildRower(kitMats);
    captain.group.position.set(0, 0.1, L * 0.62);
    captain.group.scale.setScalar(1.15);
    ship.add(captain.group);
  }
  const football = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
  );
  football.position.set(0.7, 0.35, L * 0.52);
  ship.add(football);

  return { ship, rowers, oars, flag, sail, L, haaland };
}

// Convert a continuous cycle phase (0..1) into a rowing pose.
// Drive (blades buried) is the first 42% of the cycle, recovery the rest.
export function cyclePose(phase) {
  if (phase < 0.42) {
    const k = phase / 0.42;
    const kk = k * k * (3 - 2 * k);
    return { reach: -1 + 2 * kk, dip: Math.pow(Math.sin(k * Math.PI), 0.7) };
  }
  const k = (phase - 0.42) / 0.58;
  return { reach: 1 - 2 * (k * k * (3 - 2 * k)), dip: 0 };
}

// Pose crew and oars directly, ALL oars in unison like a real crew:
// reach: -1 = catch (blades swung toward the bow) .. +1 = finish (astern)
// dip:    0 = blades high on the recovery .. 1 = buried in the water
export function poseStroke({ rowers, oars, flag }, reach, dip, t) {
  for (let i = 0; i < oars.length; i++) {
    const { pivot, side } = oars[i];
    pivot.rotation.y = side * -reach * 0.62;          // fore-aft sweep, both sides together
    pivot.rotation.z = side * (0.16 - dip * 0.58);    // 0.16 = clear of the water, -0.42 = buried
  }
  for (let i = 0; i < rowers.length; i++) {
    const r = rowers[i];
    // body swings: forward at the catch, laying back through the finish
    r.group.rotation.x = reach * 0.32;
    for (const arm of r.arms) {
      arm.rotation.x = -0.35 + reach * 0.5;
    }
  }
  if (flag) {
    // flag flutter
    const pos = flag.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(x * 4.5 - t * 9) * 0.09 * (x + 0.7));
    }
    pos.needsUpdate = true;
  }
}
