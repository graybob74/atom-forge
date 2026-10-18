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
const GL = { ok: false, tried: false, on: true, cv: null, gl: null, w: 0, h: 0, note: '', calls: 0, balls: 0, glows: 0, segs: 0, shown: null };
const GL_V = { ball: null, glow: null, seg: null }; // programs
const GL_B = { ball: null, glow: null, seg: null }; // instance buffers: { ab, f32, u8, n, cap, vao, buf }
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
  return { p, u_res: gl.getUniformLocation(p, 'u_res'), u_dpr: gl.getUniformLocation(p, 'u_dpr') };
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
/* Draw what has been queued: segments, then glows additively, then balls. */
function glFlush() {
  if (GL_B.seg.n) { glDrawBuf(GL_V.seg, GL_B.seg, false); GL.segs += GL_B.seg.n; }
  if (GL_B.glow.n) { glDrawBuf(GL_V.glow, GL_B.glow, true); GL.glows += GL_B.glow.n; }
  if (GL_B.ball.n) { glDrawBuf(GL_V.ball, GL_B.ball, false); GL.balls += GL_B.ball.n; }
  GL_B.ball.n = 0; GL_B.glow.n = 0; GL_B.seg.n = 0;
}
if (typeof module !== 'undefined') module.exports = { GL, glInit, glReady };
