'use strict';
/* ============================================================================
   Atom Forge — the WebGL layer of the renderer
   The things drawn by the thousand — atoms (balls), their glows and the bonds between them — are drawn with WebGL 2 in
   one draw call each (instanced quads shaded in the fragment shader: the same radial-gradient ball as the Canvas 2D
   sprite, the same capsule as a round-capped stroke, the same glow falloff), on a canvas of its own (#cvgl) that sits
   between two Canvas 2D ones: #cvbg below it (background, grid, fields, box, tracks, chip packages) and #cv above it
   (everything else: labels, badges, Bohr and orbital views, chips, rays, zones, overlays — transparent where nothing is
   drawn). The browser composites the three; nothing is copied. Without WebGL 2 (or when GL.on is false) render.js draws
   everything on #cv as before.
   ========================================================================== */
const GL = { ok: false, tried: false, on: true, cv: null, gl: null, w: 0, h: 0, note: '', calls: 0, balls: 0, glows: 0, segs: 0, shown: null, slots: 0, bondVerts: 0 };
const GL_V = { ball: null, glow: null, seg: null, slot: null, bond: null }; // programs
const GL_B = { ball: null, glow: null, seg: null }; // instance buffers: { ab, f32, u8, n, cap, vao, buf }
/* The slot textures: every store slot's position (RG32F), its colour (RGBA8, alpha 0 = not a ball) and its ball style
   (RGBA32F: radius in Å, the smallest and largest radius in pixels it is drawn at). The atoms and the bonds are drawn
   from these by the GPU: the positions are uploaded each frame straight from the store (no per-atom JavaScript), the
   style and colours only when something about them changed, and the bonds' vertices only when the bonding changed. */
const GL_TW = 2048; // texels a row: slot i is texel (i & 2047, i >> 11)
const GL_T = { rows: 0, pos: null, col: null, sty: null, posA: null, colA: null, styA: null };
const GL_BD = { vao: null, buf: null, n: 0, gen: -1, nb: -1 }; // the bonds' vertex buffer: 4 vertices a half-bond lane
const GL_BALL_STRIDE = 16, GL_SEG_STRIDE = 28; // bytes per vertex

const GL_OV = 64; // CSS px the WebGL canvas reaches beyond the view on each side: point sprites whose centre is just off the view still show
const GL_VS_POINT = `#version 300 es
layout(location=0) in vec2 a_pos;      // centre, CSS pixels of the view
layout(location=1) in float a_rad;     // radius, CSS pixels
layout(location=2) in vec4 a_col;      // colour (and alpha for glows)
uniform vec2 u_res;                    // the canvas, CSS pixels (the view plus the overscan)
uniform float u_dpr;
out float v_r; out vec4 v_col;
void main() {
  vec2 p = a_pos + vec2(${GL_OV}.0);
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  gl_PointSize = 2.0 * (a_rad + 1.0) * u_dpr;
  v_r = a_rad; v_col = a_col;
}`;
/* The ball: Canvas 2D's radial gradient from the circle (c0 = (-0.35r, -0.4r), r0 = 0.08r) to (0, r), colour+90 at 0,
   the colour at 0.45, 0.45·colour at 1 — the parameter t of a point is the largest root of |P − C(t)| = r(t) with
   r(t) ≥ 0. gl_PointCoord runs from the sprite's top left, as the sprite's own coordinates do. */
const GL_FS_BALL = `#version 300 es
precision highp float;
in float v_r; in vec4 v_col;
out vec4 o;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * 2.0 * (v_r + 1.0);
  float d = length(q);
  float a = clamp(v_r + 0.5 - d, 0.0, 1.0);
  if (a <= 0.0) discard;
  vec2 c0 = vec2(-0.35, -0.4) * v_r; float r0 = 0.08 * v_r, dr = v_r - r0;
  vec2 D = -c0, Q = q - c0;
  float qa = dot(D, D) - dr * dr, qb = -2.0 * (dot(Q, D) + r0 * dr), qc = dot(Q, Q) - r0 * r0;
  float t;
  if (abs(qa) < 1e-6) t = -qc / qb;
  else { float sq = sqrt(max(0.0, qb * qb - 4.0 * qa * qc)); float t1 = (-qb + sq) / (2.0 * qa), t2 = (-qb - sq) / (2.0 * qa); t = max(t1, t2); if (r0 + t * dr < 0.0) t = min(t1, t2); }
  t = clamp(t, 0.0, 1.0);
  vec3 c = v_col.rgb, hi = min(c + vec3(90.0 / 255.0), vec3(1.0)), lo = c * 0.45;
  vec3 col = t < 0.45 ? mix(hi, c, t / 0.45) : mix(c, lo, (t - 0.45) / 0.55);
  o = vec4(col * a, a);
}`;
/* The glow: alpha 0.9 at the centre, 0.45 at a quarter, 0 at the edge (the sprite's stops), times the instance's. */
const GL_FS_GLOW = `#version 300 es
precision highp float;
in float v_r; in vec4 v_col;
out vec4 o;
void main() {
  float t = length(gl_PointCoord - 0.5) * 2.0 * (v_r + 1.0) / v_r;
  if (t >= 1.0) discard;
  float a = (t < 0.25 ? mix(0.9, 0.45, t / 0.25) : mix(0.45, 0.0, (t - 0.25) / 0.75)) * v_col.a;
  o = vec4(v_col.rgb * a, a);
}`;
/* Every slot as a point sprite, by gl_VertexID: nothing is sent per atom but the position texture. */
const GL_VS_SLOT = `#version 300 es
uniform sampler2D u_pos; uniform sampler2D u_sty; uniform sampler2D u_col;
uniform vec3 u_view;                   // cx, cy (Å), s (pixels per Å)
uniform vec2 u_half;                   // half the view, CSS pixels
uniform vec2 u_res; uniform float u_dpr;
out float v_r; out vec4 v_col;
void main() {
  ivec2 t = ivec2(gl_VertexID & ${GL_TW - 1}, gl_VertexID >> 11);
  vec4 sty = texelFetch(u_sty, t, 0); vec4 col = texelFetch(u_col, t, 0);
  float r = max(sty.y, sty.x * u_view.z);
  if (col.a <= 0.0 || r > sty.z) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 0.0; v_r = 0.0; v_col = vec4(0.0); return; }
  vec2 w = texelFetch(u_pos, t, 0).xy;
  vec2 p = vec2((w.x - u_view.x) * u_view.z + u_half.x, (u_view.y - w.y) * u_view.z + u_half.y) + vec2(${GL_OV}.0);
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  gl_PointSize = 2.0 * (r + 1.0) * u_dpr;
  v_r = r; v_col = vec4(col.rgb, 1.0);
}`;
/* A half-bond lane as a quad: the two atoms' positions and the atom's colour come from the slot textures, so the
   vertex buffer holds only slots, the corner, the lane and the bond's rest length (static until the bonding changes).
   Each half is capped round at its atom and cut flat at the middle, where the other half meets it. */
const GL_VS_BOND = `#version 300 es
layout(location=0) in vec2 a_ab;       // the two slots
layout(location=1) in vec4 a_q;        // half (0: from a, 1: to b), corner (0–3), lane (−1, 0, 1 …), width factor
layout(location=2) in vec2 a_r;        // the bond's rest length and the stretch over which it fades (Å)
uniform sampler2D u_pos; uniform sampler2D u_col;
uniform vec3 u_view; uniform vec2 u_half; uniform vec2 u_res;
uniform vec3 u_box;                    // half the box (Å), periodic (1) or not
uniform vec3 u_bond;                   // half the stroke width (px), the lane offset (px), the opacity factor
out vec2 v_lc; out vec2 v_dim; out vec4 v_col; out vec2 v_caps;
void main() {
  int ia = int(a_ab.x), ib = int(a_ab.y);
  vec2 pa = texelFetch(u_pos, ivec2(ia & ${GL_TW - 1}, ia >> 11), 0).xy, pb = texelFetch(u_pos, ivec2(ib & ${GL_TW - 1}, ib >> 11), 0).xy;
  vec2 d = pb - pa;
  if (u_box.z > 0.5 && (abs(d.x) > u_box.x || abs(d.y) > u_box.y)) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); v_col = vec4(0.0); v_lc = vec2(0.0); v_dim = vec2(1.0); v_caps = vec2(0.0); return; }
  float s = u_view.z;
  vec2 A = vec2((pa.x - u_view.x) * s + u_half.x, (u_view.y - pa.y) * s + u_half.y), B = vec2((pb.x - u_view.x) * s + u_half.x, (u_view.y - pb.y) * s + u_half.y), M = (A + B) * 0.5;
  bool first = a_q.x < 0.5;
  vec2 P0 = first ? A : M, P1 = first ? M : B, dd = P1 - P0;
  float L = length(dd); vec2 u = L > 0.0 ? dd / L : vec2(1.0, 0.0), n = vec2(-u.y, u.x);
  float hw = u_bond.x * a_q.w, e = hw + 1.0;
  int c = int(a_q.y + 0.5);
  float along = c < 2 ? -e : L + e, across = (c == 0 || c == 2) ? -e : e;
  vec2 p = P0 + u * along + n * (across + a_q.z * u_bond.y) + vec2(${GL_OV}.0);
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  v_lc = vec2(along, across); v_dim = vec2(L, hw);
  float stretch = clamp((length(d) - a_r.x) / a_r.y, 0.0, 1.0);
  int ic = first ? ia : ib;
  vec4 col = texelFetch(u_col, ivec2(ic & ${GL_TW - 1}, ic >> 11), 0);
  v_col = vec4(col.rgb, (0.95 - stretch * 0.6) * u_bond.z);
  v_caps = first ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
}`;
const GL_FS_BOND = `#version 300 es
precision highp float;
in vec2 v_lc; in vec2 v_dim; in vec4 v_col; in vec2 v_caps;
out vec4 o;
void main() {
  if (v_col.a <= 0.0) discard;
  if (v_caps.x < 0.5 && v_lc.x < 0.0) discard;
  if (v_caps.y < 0.5 && v_lc.x > v_dim.x) discard;
  float x = clamp(v_lc.x, 0.0, v_dim.x);
  float d = length(vec2(v_lc.x - x, v_lc.y));
  float a = clamp(v_dim.y + 0.5 - d, 0.0, 1.0) * v_col.a;
  if (a <= 0.0) discard;
  o = vec4(v_col.rgb * a, a);
}`;
/* A segment with round caps (a stroke with lineCap round): a quad covering the capsule, four vertices with their place
   along and across the segment; the distance to the segment gives the edge. */
const GL_VS_SEG = `#version 300 es
layout(location=0) in vec2 a_pos;      // the vertex, CSS pixels of the view
layout(location=1) in vec2 a_lc;       // along, across the segment (pixels)
layout(location=2) in vec2 a_dim;      // the segment's length, half the width
layout(location=3) in vec4 a_col;
uniform vec2 u_res;
out vec2 v_lc; out vec2 v_dim; out vec4 v_col;
void main() {
  vec2 p = a_pos + vec2(${GL_OV}.0);
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  v_lc = a_lc; v_dim = a_dim; v_col = a_col;
}`;
const GL_FS_SEG = `#version 300 es
precision highp float;
in vec2 v_lc; in vec2 v_dim; in vec4 v_col;
out vec4 o;
void main() {
  float x = clamp(v_lc.x, 0.0, v_dim.x);
  float d = length(vec2(v_lc.x - x, v_lc.y));
  float a = clamp(v_dim.y + 0.5 - d, 0.0, 1.0) * v_col.a;
  if (a <= 0.0) discard;
  o = vec4(v_col.rgb * a, a);
}`;

function glCompile(gl, vs, fs) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = (n) => gl.getUniformLocation(p, n);
  return { p, u_res: u('u_res'), u_dpr: u('u_dpr'), u_pos: u('u_pos'), u_sty: u('u_sty'), u_col: u('u_col'), u_view: u('u_view'), u_half: u('u_half'), u_box: u('u_box'), u_bond: u('u_bond') };
}
/* A vertex buffer with its vertex array: interleaved attributes, one vertex per ball or glow (points), four per segment
   (quads, drawn with a shared index buffer). */
function glBuffer(gl, stride, layout, perItem) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (const [loc, size, type, norm, off] of layout) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, norm, stride, off); }
  if (perItem === 4) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, GL.quadIdx);
  gl.bindVertexArray(null);
  const cap = 4096, ab = new ArrayBuffer(cap * stride * perItem);
  return { ab, f32: new Float32Array(ab), u8: new Uint8Array(ab), n: 0, cap, stride, perItem, vao, buf };
}
function glGrow(b, need) {
  if (need <= b.cap) return;
  let cap = b.cap; while (cap < need) cap *= 2;
  const ab = new ArrayBuffer(cap * b.stride * b.perItem); new Uint8Array(ab).set(b.u8.subarray(0, b.n * b.stride * b.perItem));
  b.ab = ab; b.f32 = new Float32Array(ab); b.u8 = new Uint8Array(ab); b.cap = cap;
  if (b.perItem === 4) glQuadIndices(cap);
}
/* The index buffer shared by the quads: 0 1 2, 2 1 3 for each, for as many quads as any buffer holds. */
function glQuadIndices(nq) {
  if (GL.quadIdxN >= nq) return;
  const gl = GL.gl, idx = new Uint32Array(nq * 6);
  for (let q = 0, k = 0, v = 0; q < nq; q++, v += 4) { idx[k++] = v; idx[k++] = v + 1; idx[k++] = v + 2; idx[k++] = v + 2; idx[k++] = v + 1; idx[k++] = v + 3; }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, GL.quadIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  GL.quadIdxN = nq;
}
function glInit() {
  if (GL.tried) return GL.ok;
  GL.tried = true;
  try {
    if (typeof document === 'undefined') throw new Error('no document');
    const cv = document.getElementById('cvgl') || document.createElement('canvas');
    const gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 unavailable');
    GL.cv = cv; GL.gl = gl;
    GL.quadIdx = gl.createBuffer(); GL.quadIdxN = 0; glQuadIndices(4096);
    GL_V.ball = glCompile(gl, GL_VS_POINT, GL_FS_BALL); GL_V.glow = glCompile(gl, GL_VS_POINT, GL_FS_GLOW); GL_V.seg = glCompile(gl, GL_VS_SEG, GL_FS_SEG);
    GL_V.slot = glCompile(gl, GL_VS_SLOT, GL_FS_BALL); GL_V.bond = glCompile(gl, GL_VS_BOND, GL_FS_BOND);
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    GL_T.pos = tex(); GL_T.col = tex(); GL_T.sty = tex(); GL_T.rows = 0; GL_BD.gen = -1; GL_BD.nb = -1; GL_BD.n = 0;
    GL_BD.vao = gl.createVertexArray(); gl.bindVertexArray(GL_BD.vao); GL_BD.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, GL_BD.buf);
    for (const [loc, size, off] of [[0, 2, 0], [1, 4, 8], [2, 2, 24]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 32, off); }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, GL.quadIdx); gl.bindVertexArray(null);
    const ballLayout = [[0, 2, gl.FLOAT, false, 0], [1, 1, gl.FLOAT, false, 8], [2, 4, gl.UNSIGNED_BYTE, true, 12]];
    GL_B.ball = glBuffer(gl, GL_BALL_STRIDE, ballLayout, 1); GL_B.glow = glBuffer(gl, GL_BALL_STRIDE, ballLayout, 1);
    GL_B.seg = glBuffer(gl, GL_SEG_STRIDE, [[0, 2, gl.FLOAT, false, 0], [1, 2, gl.FLOAT, false, 8], [2, 2, gl.FLOAT, false, 16], [3, 4, gl.UNSIGNED_BYTE, true, 24]], 4);
    if (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] < 256) throw new Error('point sprites too small');
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); GL.ok = false; GL.note = 'context lost'; }, false);
    cv.addEventListener('webglcontextrestored', () => { GL.tried = false; glInit(); }, false);
    GL.ok = true; GL.note = 'WebGL 2';
  } catch (e) { GL.ok = false; GL.note = 'Canvas 2D (' + (e.message || e) + ')'; GL.gl = null; }
  return GL.ok;
}
function glReady() { return GL.on && (GL.ok || (!GL.tried && glInit())); }
/* The WebGL canvas follows the 2D canvas's size; cleared to transparent for the frame. */
function glBegin() {
  const gl = GL.gl, w = Math.round((R.w + 2 * GL_OV) * R.dpr), h = Math.round((R.h + 2 * GL_OV) * R.dpr);
  if (GL.w !== w || GL.h !== h) {
    GL.cv.width = w; GL.cv.height = h; GL.cv.style.width = (R.w + 2 * GL_OV) + 'px'; GL.cv.style.height = (R.h + 2 * GL_OV) + 'px';
    GL.cv.style.left = -GL_OV + 'px'; GL.cv.style.top = -GL_OV + 'px'; GL.w = w; GL.h = h;
  }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  GL_B.ball.n = 0; GL_B.glow.n = 0; GL_B.seg.n = 0;
}
/* The WebGL canvas shows only while the layer is in use (else its last frame would sit under the 2D drawing). */
function glShow(on) { if (GL.cv && GL.shown !== on) { GL.cv.style.visibility = on ? '' : 'hidden'; GL.shown = on; } }
/* Items: positions and radii in CSS pixels of the view, colours as [r, g, b] 0–255. */
function glBall(x, y, r, c) {
  const b = GL_B.ball; if (b.n >= b.cap) glGrow(b, b.n + 1);
  const o = b.n * 4, u = b.n * 16; b.f32[o] = x; b.f32[o + 1] = y; b.f32[o + 2] = r; b.u8[u + 12] = c[0]; b.u8[u + 13] = c[1]; b.u8[u + 14] = c[2]; b.u8[u + 15] = 255; b.n++;
}
function glGlow(x, y, r, c, alpha) {
  const b = GL_B.glow; if (b.n >= b.cap) glGrow(b, b.n + 1);
  const o = b.n * 4, u = b.n * 16; b.f32[o] = x; b.f32[o + 1] = y; b.f32[o + 2] = r; b.u8[u + 12] = c[0]; b.u8[u + 13] = c[1]; b.u8[u + 14] = c[2]; b.u8[u + 15] = Math.round(alpha * 255); b.n++;
}
function glSeg(x0, y0, x1, y1, hw, c, alpha) {
  const b = GL_B.seg; if (b.n >= b.cap) glGrow(b, b.n + 1);
  const dx = x1 - x0, dy = y1 - y0, L = Math.sqrt(dx * dx + dy * dy), ux = L > 0 ? dx / L : 1, uy = L > 0 ? dy / L : 0, nx = -uy, ny = ux, e = hw + 1;
  const F = b.f32, U = b.u8, A = Math.round(alpha * 255);
  let o = b.n * 28, u = b.n * 112; // (7 floats a vertex, 4 vertices: 0 = start left, 1 = start right, 2 = end left, 3 = end right)
  const put = (along, across) => {
    F[o] = x0 + ux * along + nx * across; F[o + 1] = y0 + uy * along + ny * across; F[o + 2] = along; F[o + 3] = across; F[o + 4] = L; F[o + 5] = hw;
    U[u + 24] = c[0]; U[u + 25] = c[1]; U[u + 26] = c[2]; U[u + 27] = A; o += 7; u += 28;
  };
  put(-e, -e); put(-e, e); put(L + e, -e); put(L + e, e);
  b.n++;
}
function glDrawBuf(prog, b, additive) {
  if (!b.n) return;
  const gl = GL.gl;
  gl.useProgram(prog.p); gl.uniform2f(prog.u_res, R.w + 2 * GL_OV, R.h + 2 * GL_OV); if (prog.u_dpr) gl.uniform1f(prog.u_dpr, R.dpr);
  gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(b.vao); gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
  gl.bufferData(gl.ARRAY_BUFFER, b.u8.subarray(0, b.n * b.stride * b.perItem), gl.DYNAMIC_DRAW);
  if (b.perItem === 4) gl.drawElements(gl.TRIANGLES, b.n * 6, gl.UNSIGNED_INT, 0);
  else gl.drawArrays(gl.POINTS, 0, b.n);
  gl.bindVertexArray(null);
  GL.calls++;
}
/* ---- the slot textures and what is drawn from them */
function glSlotRows(hi) {
  const gl = GL.gl, rows = Math.max(1, Math.ceil(hi / GL_TW));
  if (rows > GL_T.rows) {
    const n = rows * GL_TW;
    const posA = new Float32Array(n * 2), colA = new Uint8Array(n * 4), styA = new Float32Array(n * 4);
    if (GL_T.posA) { posA.set(GL_T.posA); colA.set(GL_T.colA); styA.set(GL_T.styA); }
    GL_T.posA = posA; GL_T.colA = colA; GL_T.styA = styA; GL_T.rows = rows;
    gl.bindTexture(gl.TEXTURE_2D, GL_T.pos); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, GL_TW, rows, 0, gl.RG, gl.FLOAT, null);
    gl.bindTexture(gl.TEXTURE_2D, GL_T.col); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GL_TW, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, GL_T.sty); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, GL_TW, rows, 0, gl.RGBA, gl.FLOAT, null);
  }
  return rows;
}
/* The positions of slots 0 ≤ i < hi, from the store, into the texture (every frame). */
function glSlotPositions(hi) {
  const gl = GL.gl, rows = glSlotRows(hi), A = GL_T.posA, X = S.x, Y = S.y;
  for (let i = 0; i < hi; i++) { A[2 * i] = X[i]; A[2 * i + 1] = Y[i]; }
  gl.bindTexture(gl.TEXTURE_2D, GL_T.pos); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GL_TW, rows, gl.RG, gl.FLOAT, A.subarray(0, rows * GL_TW * 2));
}
/* The style and colour arrays (filled by render.js) into their textures (when they changed). */
function glSlotStyle(hi) {
  const gl = GL.gl, rows = glSlotRows(hi);
  gl.bindTexture(gl.TEXTURE_2D, GL_T.col); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GL_TW, rows, gl.RGBA, gl.UNSIGNED_BYTE, GL_T.colA.subarray(0, rows * GL_TW * 4));
  gl.bindTexture(gl.TEXTURE_2D, GL_T.sty); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GL_TW, rows, gl.RGBA, gl.FLOAT, GL_T.styA.subarray(0, rows * GL_TW * 4));
}
function glBindSlotTex(prog, withStyle) {
  const gl = GL.gl;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, GL_T.pos); gl.uniform1i(prog.u_pos, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, GL_T.col); gl.uniform1i(prog.u_col, 1);
  if (withStyle) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, GL_T.sty); gl.uniform1i(prog.u_sty, 2); }
  gl.activeTexture(gl.TEXTURE0);
}
function glViewUniforms(prog) {
  const gl = GL.gl;
  gl.uniform2f(prog.u_res, R.w + 2 * GL_OV, R.h + 2 * GL_OV); if (prog.u_dpr) gl.uniform1f(prog.u_dpr, R.dpr);
  gl.uniform3f(prog.u_view, R.cx, R.cy, R.s); gl.uniform2f(prog.u_half, R.w / 2, R.h / 2);
}
/* All the slots' balls in one draw call (the position texture must be current). */
function glDrawSlots(hi) {
  if (!hi) return;
  const gl = GL.gl, prog = GL_V.slot;
  gl.useProgram(prog.p); glViewUniforms(prog); glBindSlotTex(prog, true);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(null);
  gl.drawArrays(gl.POINTS, 0, hi);
  GL.calls++; GL.slots += hi;
}
/* The bonds' vertices (when the bonding changed): a quad for each half of each lane of each bond. */
function glBondsBuild(bonds, gen) {
  const gl = GL.gl, nb = bonds.length;
  if (GL_BD.gen === gen && GL_BD.nb === nb) return;
  let nv = 0; for (let k = 0; k < nb; k++) nv += (bonds[k].arom ? 2 : bonds[k].order) * 8;
  const F = new Float32Array(nv * 8); let o = 0;
  for (let k = 0; k < nb; k++) {
    const bd = bonds[k], ia = bd.a.i, ib = bd.b.i, ar = !!bd.arom, n = ar ? 2 : bd.order, wm = n > 1 ? 0.7 : 1, r0 = bd.r0, rb = bd.rb || 1.5;
    for (let q = 0; q < n; q++) {
      const lane = q - (n - 1) / 2, wq = ar && q === 1 ? 0.7 * clamp((bd.fo || 1.5) - 1, 0.1, 1) : wm; // (resonating: a full lane and a thinner one, as thick as its share of a second bond)
      for (let h = 0; h < 2; h++) for (let c = 0; c < 4; c++) { F[o] = ia; F[o + 1] = ib; F[o + 2] = h; F[o + 3] = c; F[o + 4] = lane; F[o + 5] = wq; F[o + 6] = r0; F[o + 7] = rb; o += 8; }
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, GL_BD.buf); gl.bufferData(gl.ARRAY_BUFFER, F, gl.STATIC_DRAW);
  glQuadIndices(nv / 4);
  GL_BD.n = nv / 4; GL_BD.gen = gen; GL_BD.nb = nb; GL.bondVerts = nv;
}
function glDrawBonds(hw, off, aMul, wrap, hbw, hbh) {
  if (!GL_BD.n) return;
  const gl = GL.gl, prog = GL_V.bond;
  gl.useProgram(prog.p); glViewUniforms(prog); glBindSlotTex(prog, false);
  gl.uniform3f(prog.u_box, hbw, hbh, wrap ? 1 : 0); gl.uniform3f(prog.u_bond, hw, off, aMul);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(GL_BD.vao);
  gl.drawElements(gl.TRIANGLES, GL_BD.n * 6, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);
  GL.calls++; GL.segs += GL_BD.n;
}
/* Draw what has been queued: segments, then glows additively, then balls. */
function glFlush() {
  if (GL_B.seg.n) { glDrawBuf(GL_V.seg, GL_B.seg, false); GL.segs += GL_B.seg.n; }
  if (GL_B.glow.n) { glDrawBuf(GL_V.glow, GL_B.glow, true); GL.glows += GL_B.glow.n; }
  if (GL_B.ball.n) { glDrawBuf(GL_V.ball, GL_B.ball, false); GL.balls += GL_B.ball.n; }
  GL_B.ball.n = 0; GL_B.glow.n = 0; GL_B.seg.n = 0;
}
if (typeof module !== 'undefined') module.exports = { GL, glInit, glReady };
