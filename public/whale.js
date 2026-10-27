let stop = () => {};

const BLUE = [77 / 255, 107 / 255, 254 / 255];
const ICE = [0.95, 0.96, 1];
const FIN = [0.34, 0.48, 0.99];
const PUPIL = [0.05, 0.09, 0.2];
const WHITE = [1, 1, 1];

function smooth(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function bodyColor(belly) {
  return mix(BLUE, ICE, smooth((belly - 0.08) / 0.82));
}

function ident() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mul(a, b) {
  const o = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      o[col * 4 + row] = sum;
    }
  }
  return o;
}

function rotX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const m = ident();
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

function rotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const m = ident();
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

function rotZ(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const m = ident();
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  return m;
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function lookAt(eye, target, up) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len;
  zy /= len;
  zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len;
  xy /= len;
  xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx;
  m[1] = yx;
  m[2] = zx;
  m[4] = xy;
  m[5] = yy;
  m[6] = zy;
  m[8] = xz;
  m[9] = yz;
  m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

function mat3(m4) {
  return new Float32Array([
    m4[0], m4[1], m4[2],
    m4[4], m4[5], m4[6],
    m4[8], m4[9], m4[10],
  ]);
}

function spine(u, time) {
  const tail = (1 - u) ** 1.65;
  const phase = time * 2.05 - u * 6.4;
  const wave = Math.sin(phase);
  return [
    -1.2 + u * 2.38,
    Math.sin(time * 0.85) * 0.035 + wave * 0.05 * tail,
    wave * 0.4 * tail,
  ];
}

function basis(u, time) {
  const p = spine(u, time);
  const q = spine(Math.min(0.992, u + 0.01), time);
  let tx = q[0] - p[0];
  let ty = q[1] - p[1];
  let tz = q[2] - p[2];
  let len = Math.hypot(tx, ty, tz) || 1;
  tx /= len;
  ty /= len;
  tz /= len;
  let sx = -tz;
  let sy = 0;
  let sz = tx;
  len = Math.hypot(sx, sy, sz);
  if (len < 1e-4) {
    sx = 0;
    sy = 0;
    sz = 1;
    len = 1;
  }
  sx /= len;
  sy /= len;
  sz /= len;
  const ux = sy * tz - sz * ty;
  const uy = sz * tx - sx * tz;
  const uz = sx * ty - sy * tx;
  return { p, t: [tx, ty, tz], s: [sx, sy, sz], u: [ux, uy, uz] };
}

function radii(u) {
  if (u < 0.15) {
    const k = smooth(u / 0.15);
    return { ry: 0.038 + k * 0.1, rz: 0.032 + k * 0.075, drop: k * 0.01 };
  }
  if (u < 0.74) {
    const k = (u - 0.15) / 0.59;
    const bell = Math.sin(k * Math.PI);
    return {
      ry: 0.138 + bell * 0.2,
      rz: 0.108 + bell * 0.125,
      drop: bell * 0.045,
    };
  }
  const k = (u - 0.74) / 0.26;
  let ry = 0.2 + Math.sin(Math.min(k, 0.55) / 0.55 * Math.PI) * 0.06;
  let rz = 0.15 + Math.sin(Math.min(k, 0.55) / 0.55 * Math.PI) * 0.035;
  if (k > 0.58) {
    const s = (k - 0.58) / 0.42;
    const tap = 1 - s * s * 0.82;
    ry *= tap;
    rz *= tap;
  }
  return { ry, rz, drop: 0.03 * (1 - k) };
}

function place(b, x, y, z) {
  return {
    x: b.p[0] + b.t[0] * x + b.u[0] * y + b.s[0] * z,
    y: b.p[1] + b.t[1] * x + b.u[1] * y + b.s[1] * z,
    z: b.p[2] + b.t[2] * x + b.u[2] * y + b.s[2] * z,
  };
}

function createMesh() {
  const pos = [];
  const nrm = [];
  const col = [];
  const alp = [];
  const idx = [];
  return {
    get count() {
      return pos.length / 3;
    },
    push(x, y, z, nx, ny, nz, rgb, a = 1) {
      const len = Math.hypot(nx, ny, nz) || 1;
      pos.push(x, y, z);
      nrm.push(nx / len, ny / len, nz / len);
      col.push(rgb[0], rgb[1], rgb[2]);
      alp.push(a);
    },
    tri(a, b, c) {
      idx.push(a, b, c);
    },
    upload() {
      const data = new Float32Array(pos.length / 3 * 10);
      const n = pos.length / 3;
      for (let i = 0; i < n; i += 1) {
        const o = i * 10;
        data[o] = pos[i * 3];
        data[o + 1] = pos[i * 3 + 1];
        data[o + 2] = pos[i * 3 + 2];
        data[o + 3] = nrm[i * 3];
        data[o + 4] = nrm[i * 3 + 1];
        data[o + 5] = nrm[i * 3 + 2];
        data[o + 6] = col[i * 3];
        data[o + 7] = col[i * 3 + 1];
        data[o + 8] = col[i * 3 + 2];
        data[o + 9] = alp[i];
      }
      return { data, indices: new Uint16Array(idx) };
    },
  };
}

function addSurface(mesh, nu, nv, sample, color) {
  const base = mesh.count;
  const pts = [];
  for (let i = 0; i <= nu; i += 1) {
    for (let j = 0; j <= nv; j += 1) pts.push(sample(i / nu, j / nv));
  }
  const cols = nv + 1;
  const at = (i, j) => pts[Math.max(0, Math.min(nu, i)) * cols + Math.max(0, Math.min(nv, j))];
  for (let i = 0; i <= nu; i += 1) {
    for (let j = 0; j <= nv; j += 1) {
      const p = at(i, j);
      const dr = at(i + 1, j);
      const dl = at(i - 1, j);
      const db = at(i, j + 1);
      const dt = at(i, j - 1);
      const ux = dr.x - dl.x;
      const uy = dr.y - dl.y;
      const uz = dr.z - dl.z;
      const vx = db.x - dt.x;
      const vy = db.y - dt.y;
      const vz = db.z - dt.z;
      mesh.push(
        p.x, p.y, p.z,
        uy * vz - uz * vy,
        uz * vx - ux * vz,
        ux * vy - uy * vx,
        color,
        1,
      );
    }
  }
  for (let i = 0; i < nu; i += 1) {
    for (let j = 0; j < nv; j += 1) {
      const a = base + i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      mesh.tri(a, c, b);
      mesh.tri(b, c, d);
    }
  }
}

function addBody(mesh, time) {
  const rings = 48;
  const segs = 28;
  const base = mesh.count;
  const cols = segs + 1;
  for (let i = 0; i <= rings; i += 1) {
    const u = i / rings;
    const b = basis(u, time);
    const rad = radii(u);
    for (let j = 0; j <= segs; j += 1) {
      const ang = (j / segs) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const oy = ca * rad.ry - rad.drop;
      const oz = sa * rad.rz;
      const p = place(b, 0, oy, oz);
      const c = place(b, 0, -rad.drop, 0);
      const belly = Math.max(0, -ca) ** 0.75;
      mesh.push(p.x, p.y, p.z, p.x - c.x, p.y - c.y, p.z - c.z, bodyColor(belly), 1);
    }
  }
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < segs; j += 1) {
      const a = base + i * cols + j;
      mesh.tri(a, a + cols, a + 1);
      mesh.tri(a + 1, a + cols, a + cols + 1);
    }
  }
  for (const end of [0, 1]) {
    const u = end;
    const b = basis(u, time);
    const rad = radii(u);
    const sign = end === 1 ? 1 : -1;
    const center = place(b, 0.035 * sign, -rad.drop * 0.2, 0);
    const hub = mesh.count;
    mesh.push(center.x, center.y, center.z, b.t[0] * sign, b.t[1] * sign, b.t[2] * sign, bodyColor(0.15), 1);
    const ring = mesh.count;
    for (let j = 0; j <= segs; j += 1) {
      const ang = (j / segs) * Math.PI * 2;
      const p = place(b, 0, Math.cos(ang) * rad.ry - rad.drop, Math.sin(ang) * rad.rz);
      mesh.push(p.x, p.y, p.z, b.t[0] * sign, b.t[1] * sign, b.t[2] * sign, bodyColor(Math.max(0, -Math.cos(ang))), 1);
    }
    for (let j = 0; j < segs; j += 1) {
      if (sign > 0) mesh.tri(hub, ring + j, ring + j + 1);
      else mesh.tri(hub, ring + j + 1, ring + j);
    }
  }
}

function addFlukes(mesh, time) {
  const b = basis(0.035, time);
  const wag = 0.18 + Math.sin(time * 2.05) * 0.1;
  for (const side of [1, -1]) {
    for (const layer of [1, -1]) {
      addSurface(mesh, 10, 4, (span, chord) => {
        const reach = Math.sin(span * Math.PI * 0.5);
        const z = side * (0.03 + reach * 0.4);
        const width = 0.08 + Math.sin(span * Math.PI) * 0.22 + reach * 0.08;
        const x = -span * 0.18 - chord * width;
        const thick = Math.sin(Math.PI * chord) * 0.026 * (1 - span * 0.65) * layer;
        const c = Math.cos(wag);
        const s = Math.sin(wag);
        return place(b, x * c - thick * s, x * s + thick * c, z);
      }, FIN);
    }
  }
}

function addPectorals(mesh, time) {
  const flap = Math.sin(time * 1.45) * 0.16;
  for (const side of [1, -1]) {
    const b0 = basis(0.62, time);
    const rad = radii(0.62);
    const shoulder = place(b0, -0.02, -rad.ry * 0.2, side * rad.rz * 0.78);
    const b = { ...b0, p: [shoulder.x, shoulder.y, shoulder.z] };
    for (const layer of [1, -1]) {
      addSurface(mesh, 8, 3, (span, chord) => {
        const y = -span * 0.1;
        const x = -span * 0.34 - chord * (0.03 + span * 0.12);
        const z = side * span * 0.02;
        const thick = Math.sin(Math.PI * chord) * 0.016 * (1 - span * 0.45) * layer;
        const c = Math.cos(flap * side);
        const s = Math.sin(flap * side);
        return place(b, x, y * c - z * s + thick, y * s + z * c);
      }, FIN);
    }
  }
}

function addDorsal(mesh, time) {
  const b0 = basis(0.46, time);
  const rad = radii(0.46);
  const root = place(b0, 0.02, rad.ry * 0.82, 0);
  const b = { ...b0, p: [root.x, root.y, root.z] };
  for (const layer of [1, -1]) {
    addSurface(mesh, 6, 2, (span, chord) => {
      const x = -span * 0.16 - (chord - 0.5) * (0.04 + span * 0.12);
      const y = Math.sin(span * Math.PI) * 0.2;
      const z = (chord - 0.5) * 0.025 * (1 - span) + layer * 0.008 * (1 - span);
      return place(b, x, y, z);
    }, FIN);
  }
}

function addSphere(mesh, center, radius, color, lats, lons) {
  const base = mesh.count;
  for (let i = 0; i <= lats; i += 1) {
    const phi = (i / lats) * Math.PI;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let j = 0; j <= lons; j += 1) {
      const theta = (j / lons) * Math.PI * 2;
      const nx = sp * Math.cos(theta);
      const ny = cp;
      const nz = sp * Math.sin(theta);
      mesh.push(center.x + nx * radius, center.y + ny * radius, center.z + nz * radius, nx, ny, nz, color, 1);
    }
  }
  const cols = lons + 1;
  for (let i = 0; i < lats; i += 1) {
    for (let j = 0; j < lons; j += 1) {
      const a = base + i * cols + j;
      mesh.tri(a, a + cols, a + 1);
      mesh.tri(a + 1, a + cols, a + cols + 1);
    }
  }
}

function addEyes(mesh, time) {
  for (const side of [1, -1]) {
    const b = basis(0.8, time);
    const rad = radii(0.8);
    const center = place(b, 0.03, rad.ry * 0.22, side * (rad.rz + 0.012));
    addSphere(mesh, center, 0.046, WHITE, 7, 10);
    const pupil = place(b, 0.055, rad.ry * 0.25, side * (rad.rz + 0.046));
    addSphere(mesh, pupil, 0.02, PUPIL, 5, 8);
    const glint = place(b, 0.05, rad.ry * 0.3, side * (rad.rz + 0.058));
    addSphere(mesh, glint, 0.008, WHITE, 3, 5);
  }
}

function addShadow(mesh) {
  const n = 48;
  const hub = mesh.count;
  const color = [0.28, 0.4, 0.92];
  mesh.push(0.05, -0.72, 0, 0, 1, 0, color, 0.3);
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    mesh.push(0.05 + Math.cos(a) * 1.2, -0.72, Math.sin(a) * 0.38, 0, 1, 0, color, 0);
  }
  for (let i = 0; i < n; i += 1) mesh.tri(hub, hub + 1 + i, hub + 2 + i);
}

function buildWhale(time) {
  const whale = createMesh();
  addBody(whale, time);
  addFlukes(whale, time);
  addPectorals(whale, time);
  addDorsal(whale, time);
  addEyes(whale, time);
  const shadow = createMesh();
  addShadow(shadow);
  return { whale: whale.upload(), shadow: shadow.upload() };
}

const VERT = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aCol;
attribute float aAlpha;
uniform mat4 uMvp;
uniform mat3 uN;
varying vec3 vN;
varying vec3 vCol;
varying float vA;
void main() {
  vN = uN * aNrm;
  vCol = aCol;
  vA = aAlpha;
  gl_Position = uMvp * vec4(aPos, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec3 vN;
varying vec3 vCol;
varying float vA;
uniform vec3 uLight;
uniform vec3 uView;
uniform float uLit;
void main() {
  vec3 n = normalize(vN);
  if (dot(n, uLight) < 0.0) n = -n;
  float wrap = clamp(dot(n, uLight) * 0.62 + 0.38, 0.0, 1.0);
  float ndl = clamp(dot(n, uLight), 0.0, 1.0);
  vec3 h = normalize(uLight + uView);
  float spec = pow(clamp(dot(n, h), 0.0, 1.0), 28.0) * (0.4 + 0.6 * ndl);
  float rim = pow(1.0 - clamp(dot(n, uView), 0.0, 1.0), 2.4);
  vec3 lit = vCol * (0.5 + 0.68 * wrap) + spec * vec3(1.0) * 0.9 + rim * vec3(0.72, 0.82, 1.0) * 0.3;
  vec3 col = mix(vCol, lit, uLit);
  gl_FragColor = vec4(col * vA, vA);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function mountWhale(canvas) {
  stop();
  if (!canvas) return;
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    depth: true,
  });
  if (!gl) return;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.bindAttribLocation(program, 1, "aNrm");
  gl.bindAttribLocation(program, 2, "aCol");
  gl.bindAttribLocation(program, 3, "aAlpha");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

  const whaleBuf = gl.createBuffer();
  const whaleIdx = gl.createBuffer();
  const shadowBuf = gl.createBuffer();
  const shadowIdx = gl.createBuffer();
  const mvpLoc = gl.getUniformLocation(program, "uMvp");
  const nLoc = gl.getUniformLocation(program, "uN");
  const lightLoc = gl.getUniformLocation(program, "uLight");
  const viewLoc = gl.getUniformLocation(program, "uView");
  const litLoc = gl.getUniformLocation(program, "uLit");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer = { x: 0, y: 0 };
  const smoothPtr = { x: 0, y: 0 };
  const started = performance.now();
  let alive = true;
  let raf = 0;

  function onMove(event) {
    pointer.x = event.clientX / Math.max(1, window.innerWidth) * 2 - 1;
    pointer.y = event.clientY / Math.max(1, window.innerHeight) * 2 - 1;
  }
  window.addEventListener("pointermove", onMove, { passive: true });

  function bindMesh(buffer, indexBuffer, packed) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, packed.data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, packed.indices, gl.DYNAMIC_DRAW);
    const stride = 40;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36);
    return packed.indices.length;
  }

  function resize() {
    const width = canvas.clientWidth || 680;
    const height = canvas.clientHeight || 260;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw(now) {
    if (!alive || !canvas.isConnected) {
      cleanup();
      return;
    }
    resize();
    const t = reduce ? 0.55 : (now - started) / 1000;
    smoothPtr.x += (pointer.x - smoothPtr.x) * 0.08;
    smoothPtr.y += (pointer.y - smoothPtr.y) * 0.08;
    const yaw = (reduce ? 0.72 : 0.46 + Math.sin(t * 0.42) * 0.42) + smoothPtr.x * 0.28;
    const pitch = 0.08 + Math.sin(t * 0.7) * 0.035 - smoothPtr.y * 0.08;
    const roll = Math.sin(t * 0.36) * 0.06;
    const bob = Math.sin(t * 0.85) * 0.03;
    const built = buildWhale(reduce ? 0.55 : t);
    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = perspective(0.5, aspect, 0.1, 30);
    const view = lookAt([smoothPtr.x * 0.12, 0.42 + smoothPtr.y * 0.06, 4.55], [0, 0.06, 0], [0, 1, 0]);
    const model = mul(rotY(yaw), mul(rotZ(pitch), rotX(roll)));
    model[13] += bob + 0.06;
    const vp = mul(proj, view);
    const mvp = mul(vp, model);
    const light = [ -0.35, 0.86, 0.42 ];
    const llen = Math.hypot(...light);
    const viewDir = [0, 0.42, 4.55];
    const vlen = Math.hypot(...viewDir);

    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(mvpLoc, false, mvp);
    gl.uniformMatrix3fv(nLoc, false, mat3(model));
    gl.uniform3f(lightLoc, light[0] / llen, light[1] / llen, light[2] / llen);
    gl.uniform3f(viewLoc, viewDir[0] / vlen, viewDir[1] / vlen, viewDir[2] / vlen);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.uniform1f(litLoc, 0);
    const shadowCount = bindMesh(shadowBuf, shadowIdx, built.shadow);
    gl.drawElements(gl.TRIANGLES, shadowCount, gl.UNSIGNED_SHORT, 0);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.uniform1f(litLoc, 1);
    const whaleCount = bindMesh(whaleBuf, whaleIdx, built.whale);
    gl.drawElements(gl.TRIANGLES, whaleCount, gl.UNSIGNED_SHORT, 0);

    if (!reduce && alive) raf = requestAnimationFrame(draw);
  }

  function cleanup() {
    if (!alive) return;
    alive = false;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onMove);
  }

  stop = cleanup;
  draw(performance.now());
}
