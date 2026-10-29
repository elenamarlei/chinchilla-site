const GLAZES = [
  { name: 'Cobalt', src: 'assets/cobalt.png', c1: '#9B77F4', c2: '#255AB4', accent: '#E6F27A', btn: ['#8FB8FF', '#2337C6'], tint: '#DCE8FA', stock: '12 left', title: 'Cobalt series —<br>12 pieces left' },
  { name: 'Rose', src: 'assets/rose.png', c1: '#F09CBD', c2: '#8E2F5B', accent: '#C4F5DE', btn: ['#F7C1D3', '#B4466E'], tint: '#FBE3EC', stock: '7 left', title: 'Rose series —<br>7 pieces left' },
  { name: 'Celadon', src: 'assets/celadon.png', c1: '#9ED1BD', c2: '#235B4B', accent: '#FAC6D9', btn: ['#B5E0CE', '#2E6956'], tint: '#E1F2EA', stock: '4 left', title: 'Celadon series —<br>4 pieces left' },
  { name: 'Amber', src: 'assets/amber.png', c1: '#F3BF6C', c2: '#A54C19', accent: '#BFE6FF', btn: ['#F8D395', '#B0551E'], tint: '#FBEBD3', stock: '2 left', title: 'Amber series —<br>last 2 pieces' },
];
const N = GLAZES.length;

const $ = (s) => document.querySelector(s);
const canvas = $('#gl'), stage = $('#stage'), figEl = $('#fig'), menu = $('#menu');
const peek = $('#peek'), cursor = $('#cursor');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/* ---------------- glaze picker ---------------- */
GLAZES.forEach((g, i) => {
  const li = document.createElement('li');
  li.innerHTML = `<button class="row" data-i="${i}" aria-label="${g.name} glaze">
    <span class="row__num">(${String(i + 1).padStart(2, '0')})</span>
    <span class="row__swatch" style="background-image:url(${g.src})"></span>
    <span class="row__name">${g.name}</span>
    <span class="row__stock">${g.stock}</span>
    <span class="row__bar"></span></button>`;
  menu.append(li);
});
const rows = [...menu.querySelectorAll('.row')];

/* ---------------- state ---------------- */
const S = {
  cur: -1,          // glaze on screen (-1 before the intro pour)
  prev: -1,         // glaze shown inside the lens
  R: 0, Rv: 0,      // lens / pour radius (css px) and its spring velocity
  lens: 1, ripple: 0, bounce: 0,
  trans: null,
  origin: { x: innerWidth / 2, y: innerHeight / 2 },
  goal: { x: innerWidth / 2, y: innerHeight / 2 },
  mouse: { x: innerWidth / 2, y: innerHeight / 2 },
  par: { x: 0, y: 0 },
  hoverRow: -1, overFig: false,
};
let figRect = figEl.getBoundingClientRect();
let stageRect = stage.getBoundingClientRect();
let DPR = Math.min(devicePixelRatio || 1, 1.75);
let gl = null, U = {}, tex = [], emptyTex, wordTex, curTex, hit = [];

/* ---------------- shader ---------------- */
const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;
const FRAG = `
precision highp float;
uniform vec2 uView, uOrigin, uPar;
uniform vec4 uRect, uStage;
uniform float uDpr, uScale, uR, uLens, uRipple, uBounce, uTime;
uniform vec3 uA1, uA2, uB1, uB2;
uniform sampler2D uTexA, uTexB, uWord;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * noise(p); p *= 2.03; a *= .5; } return s; }
float bell(float x){ return exp(-x * x); }

vec4 figure(sampler2D t, vec2 p){
  vec2 c = uRect.xy + uRect.zw * .5 + (uPar * vec2(16., 10.) + vec2(0., -22. * uBounce)) * uScale;
  float s = 1. + .006 * sin(uTime * 1.4) + .03 * uBounce;
  vec2 q = (p - c) / (uRect.zw * s) + .5;
  if (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) return vec4(0.);
  return texture2D(t, q);
}
vec4 word(vec2 p){
  vec2 q = (p + uPar * vec2(8., 5.) * uScale) / uView;
  if (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) return vec4(0.);
  return texture2D(uWord, q);
}
vec3 scene(vec3 c1, vec3 c2, sampler2D t, vec2 p, vec2 pg){
  vec3 col = mix(c1, c2, clamp((pg.y - uStage.y) / (uStage.w * .84), 0., 1.));
  vec4 w = word(p);  col = col * (1. - w.a) + w.rgb;
  vec4 f = figure(t, p); col = col * (1. - f.a) + f.rgb;
  return col;
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uView.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 d2 = p - uOrigin; float d = length(d2); vec2 dir = d2 / max(d, 1e-3);
  float on = step(.5, uR);

  // liquid glaze edge: slow wobble + a fibrous fringe like velvet pile
  float wob = (fbm(dir * 1.8 + uTime * .35) - .5) * (.28 * uR + 12. * uScale);
  float edgeS = uR + wob;
  float edge = edgeS + (hash(floor(p * .9)) - .5) * 9. * uScale;
  float m = on * smoothstep(edge + 1.2, edge - 1.2, d);

  // pressure wave pushed ahead of the pour
  float ring = on * bell((d - edgeS) / (46. * uScale + uR * .06));
  vec2 pa = p - dir * ring * 30. * uScale * uRipple;
  vec3 col = scene(uA1, uA2, uTexA, pa, pa);

  if (m > .001){
    float inner = clamp(1. - d / max(uR, 1.), 0., 1.);
    vec2 pb = uOrigin + d2 * (1. - .2 * uLens * inner);                 // drop magnifies
    float ca = (3. + 7. * ring) * uScale * max(uLens * (1. - inner) * 1.5, uRipple * ring);
    vec3 colB = vec3(
      scene(uB1, uB2, uTexB, pb + dir * ca, pb).r,
      scene(uB1, uB2, uTexB, pb, pb).g,
      scene(uB1, uB2, uTexB, pb - dir * ca, pb).b);
    col = mix(col, colB, m);
    col += m * uLens * .07 * inner * inner;                             // glassy core
  }
  float rim = on * bell((d - edgeS) / (1.8 * uScale + .6));
  col += rim * (.5 * uLens + .6 * uRipple);
  col *= 1. - on * (1. - m) * .18 * uLens * bell((d - edgeS - 14. * uScale) / (16. * uScale));
  col += (hash(p + fract(uTime * 7.) * 100.) - .5) * .04;               // live film grain
  gl_FragColor = vec4(col, 1.);
}`;

function initGL(images) {
  gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: true });
  if (!gl) throw new Error('no webgl');
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const { name } = gl.getActiveUniform(prog, i); U[name] = gl.getUniformLocation(prog, name); }
  gl.uniform1i(U.uTexA, 0); gl.uniform1i(U.uTexB, 1); gl.uniform1i(U.uWord, 2);

  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  // throws a SecurityError when opened via file:// — caught by the caller
  tex = images.map(makeTex);
  emptyTex = makeTex(null);
  wordTex = makeTex(null);
  curTex = emptyTex;
}

function makeTex(src) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return t;
}

/* ---------------- wordmark texture (sharp half + blurred, grainy half) ---------------- */
function drawWord(ctx, el) {
  const size = parseFloat(getComputedStyle(el).fontSize);
  const r = el.getBoundingClientRect();
  ctx.font = `${size}px "Instrument Serif"`;
  const m = ctx.measureText('Ch');
  // Figma sets Instrument Serif ~10% of the size lower than the browser's font metrics do
  const base = r.top + (size * .9 - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent + .1 * size;
  let x = r.left;
  for (const node of el.childNodes) {
    ctx.font = `${node.nodeName === 'EM' ? 'italic ' : ''}${size}px "Instrument Serif"`;
    for (const ch of node.textContent) { ctx.fillText(ch, x, base); x += ctx.measureText(ch).width - .05 * size; }
  }
}

function buildWord() {
  const c = document.createElement('canvas');
  c.width = Math.round(innerWidth * DPR); c.height = Math.round(innerHeight * DPR);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.scale(DPR, DPR); ctx.fillStyle = '#fff';
  drawWord(ctx, $('.wm__sharp'));

  const blurEl = $('.wm__blur');
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const octx = o.getContext('2d'); octx.scale(DPR, DPR); octx.fillStyle = '#fff';
  drawWord(octx, blurEl);
  const k = parseFloat(getComputedStyle(blurEl).fontSize) / 514.19;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = `blur(${17 * k * DPR}px)`; ctx.drawImage(o, 0, 0);
  ctx.restore();

  // ink specks inside the blurred letters, like the noise effect in the Figma file
  const br = blurEl.getBoundingClientRect(), pad = 70 * k;
  const x0 = Math.max(0, Math.floor((br.left - pad) * DPR)), y0 = Math.max(0, Math.floor((br.top - pad) * DPR));
  const x1 = Math.min(c.width, Math.ceil((br.right + pad) * DPR)), y1 = Math.min(c.height, Math.ceil((br.bottom + pad) * DPR));
  if (x1 > x0 && y1 > y0) {
    const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] && Math.random() < .4) { d[i] = d[i] * .7 + 5; d[i + 1] = d[i + 1] * .7 + 7; d[i + 2] = d[i + 2] * .7 + 17; }
    }
    ctx.putImageData(img, x0, y0);
  }
  gl.bindTexture(gl.TEXTURE_2D, wordTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
}

/* ---------------- hit testing on the fur ---------------- */
function hitMap(img) {
  const c = document.createElement('canvas'); c.width = 162; c.height = 165;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 162, 165);
  try { return ctx.getImageData(0, 0, 162, 165).data; } catch { return null; }
}
function overFigure(x, y) {
  const qx = (x - figRect.left) / figRect.width, qy = (y - figRect.top) / figRect.height;
  if (qx < 0 || qy < 0 || qx >= 1 || qy >= 1) return false;
  const map = hit[Math.max(S.cur, 0)];
  if (!map) return ((qx - .55) / .4) ** 2 + ((qy - .55) / .42) ** 2 < 1;
  return map[(Math.floor(qy * 165) * 162 + Math.floor(qx * 162)) * 4 + 3] > 90;
}
const bodyAnchor = () => ({ x: figRect.left + figRect.width * .55, y: figRect.top + figRect.height * .58 });

/* ---------------- UI sync ---------------- */
let thumbZ = 1;
function swapText(el, html) {
  if (el.innerHTML === html) return;
  el.classList.remove('swap-in'); el.classList.add('swap-out');
  setTimeout(() => {
    el.innerHTML = html; el.classList.remove('swap-out'); el.classList.add('swap-in');
  }, 340);
}
function applyUI(i) {
  const g = GLAZES[i], root = document.documentElement.style;
  root.setProperty('--c1', g.c1); root.setProperty('--c2', g.c2);
  root.setProperty('--accent', g.accent); root.setProperty('--tint', g.tint);
  root.setProperty('--btn1', g.btn[0]); root.setProperty('--btn2', g.btn[1]);
  rows.forEach((r, j) => r.classList.toggle('is-active', j === i));
  const bar = rows[i].querySelector('.row__bar');
  bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
  document.querySelectorAll('#thumb img').forEach((im, j) => {
    im.classList.toggle('is-on', j === i); if (j === i) im.style.zIndex = ++thumbZ;
  });
  document.querySelectorAll('.fig__img').forEach((im, j) => im.classList.toggle('is-on', j === i));
  swapText($('#card-title'), g.title);
  swapText($('#card-desc'), `Hand-painted in ${g.name.toLowerCase()}.<br>Each figurine is numbered.`);
  swapText($('#body-copy'), `Every chinchilla is flocked by hand, painted in ${g.name.toLowerCase()} and numbered — no two are alike`);
}

const GLYPHS = '░▒▓/\\<>*+#%';
function scramble(el) {
  const final = el.dataset.text || (el.dataset.text = el.textContent);
  let f = 0; cancelAnimationFrame(el._raf);
  const step = () => {
    f++;
    el.textContent = [...final].map((c, k) => (k < f / 2 ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
    if (f / 2 < final.length) el._raf = requestAnimationFrame(step); else el.textContent = final;
  };
  step();
}

/* ---------------- preview + pour ---------------- */
function setPreview(i, goal) {
  if (S.trans) return;
  if (i === S.cur) i = -1;
  if (i >= 0 && i !== S.prev) {
    if (S.R < 1) S.origin = { ...goal };
    else S.Rv -= S.R * .35;                       // little gulp when the glaze inside changes
    $('#peek-num').textContent = `(${String(i + 1).padStart(2, '0')})`;
    $('#peek-name').textContent = GLAZES[i].name;
  }
  S.prev = i;
  if (goal) S.goal = { ...goal };
  menu.classList.toggle('is-paused', i >= 0);
}

function go(i, from) {
  if (S.trans || i === S.cur) return;
  if (!gl) { S.cur = i; applyUI(i); return; }
  if (S.R < 1) S.origin = { ...(from || bodyAnchor()) };
  const { x, y } = S.origin;
  const Rmax = Math.max(Math.hypot(x, y), Math.hypot(innerWidth - x, y), Math.hypot(x, innerHeight - y), Math.hypot(innerWidth - x, innerHeight - y)) * 1.35 + 80;
  S.prev = i;
  S.trans = { to: i, t0: performance.now(), dur: reduceMotion ? 700 : 1600, R0: Math.max(S.R, 0), Rmax, lens0: S.R > 1 ? 1 : 0, ui: false };
  document.body.classList.add('is-glazing');
  peek.classList.remove('is-on');
  menu.classList.remove('is-paused');
}

/* ---------------- input ---------------- */
addEventListener('pointermove', (e) => {
  S.mouse = { x: e.clientX, y: e.clientY };
  cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  cursor.classList.toggle('is-link', !!e.target.closest('a, button'));
  if (S.hoverRow >= 0 || !gl) return;
  const onUI = !!e.target.closest('a, button, .card, .nav, .intro');
  S.overFig = !onUI && overFigure(e.clientX, e.clientY);
  cursor.classList.toggle('is-lens', S.overFig);
  if (S.overFig) setPreview((Math.max(S.cur, 0) + 1) % N, S.mouse);
  else if (S.prev >= 0) setPreview(-1);
});

rows.forEach((r, i) => {
  r.addEventListener('pointerenter', () => {
    S.hoverRow = i; scramble(r.querySelector('.row__name'));
    if (gl) setPreview(i, bodyAnchor());
  });
  r.addEventListener('pointerleave', () => { S.hoverRow = -1; setPreview(-1); });
  r.addEventListener('click', () => go(i, bodyAnchor()));
});

stage.addEventListener('click', (e) => {
  if (e.target.closest('a, button, .card')) return;
  if (overFigure(e.clientX, e.clientY)) go((Math.max(S.cur, 0) + 1) % N, { x: e.clientX, y: e.clientY });
});

menu.addEventListener('animationend', (e) => {
  if (e.animationName === 'fill' && S.prev < 0 && !document.hidden) go((S.cur + 1) % N, bodyAnchor());
});

let wheelLock = 0;
addEventListener('wheel', (e) => {
  const now = performance.now();
  if (Math.abs(e.deltaY) < 20 || now < wheelLock || S.trans) return;
  wheelLock = now + 1800;
  go((S.cur + (e.deltaY > 0 ? 1 : N - 1)) % N, bodyAnchor());
}, { passive: true });

addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go((S.cur + 1) % N, bodyAnchor());
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go((S.cur + N - 1) % N, bodyAnchor());
  if (e.key >= '1' && e.key <= String(N)) go(+e.key - 1, bodyAnchor());
});

function onResize() {
  DPR = Math.min(devicePixelRatio || 1, 1.75);
  figRect = figEl.getBoundingClientRect();
  stageRect = stage.getBoundingClientRect();
  if (!gl) return;
  canvas.width = Math.round(innerWidth * DPR); canvas.height = Math.round(innerHeight * DPR);
  gl.viewport(0, 0, canvas.width, canvas.height);
  buildWord();
}
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(onResize, 120); });

/* ---------------- loop ---------------- */
const easeInOutCubic = (k) => (k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

function tick(now) {
  const t = now / 1000;
  S.par.x += ((S.mouse.x / innerWidth - .5) * 2 - S.par.x) * .05;
  S.par.y += ((S.mouse.y / innerHeight - .5) * 2 - S.par.y) * .05;

  if (S.trans) {
    const tr = S.trans, k = Math.min(1, (now - tr.t0) / tr.dur), e = easeInOutCubic(k);
    S.R = tr.R0 + (tr.Rmax - tr.R0) * e;
    S.ripple = reduceMotion ? 0 : Math.sin(Math.PI * k);
    S.lens = tr.lens0 * (1 - e);
    S.bounce = reduceMotion ? 0 : Math.sin(Math.PI * k) ** 2;
    if (k > .3 && !tr.ui) { tr.ui = true; applyUI(tr.to); }
    if (k >= 1) {
      S.cur = tr.to; curTex = tex[tr.to];
      Object.assign(S, { trans: null, R: 0, Rv: 0, prev: -1, ripple: 0, bounce: 0, lens: 1 });
      document.body.classList.remove('is-glazing');
      if (S.hoverRow >= 0) setPreview(S.hoverRow, bodyAnchor());
    }
  } else {
    const target = S.prev >= 0 ? figRect.width * .135 : 0;
    S.Rv += (target - S.R) * .09; S.Rv *= .78; S.R += S.Rv;
    if (!target && S.R < .5) { S.R = 0; S.Rv = 0; }
    if (S.hoverRow >= 0) {
      const a = bodyAnchor();
      S.goal = { x: a.x + S.par.x * 40, y: a.y + S.par.y * 30 };
    }
    S.origin.x += (S.goal.x - S.origin.x) * .2;
    S.origin.y += (S.goal.y - S.origin.y) * .2;
  }

  // label riding the lens
  const showPeek = S.prev >= 0 && !S.trans && S.R > 30;
  peek.classList.toggle('is-on', showPeek);
  if (showPeek) {
    const r = Math.max(S.R, 0), w = peek.offsetWidth;
    let px = S.origin.x + r * .78, py = S.origin.y - r * .9 - 30;
    if (px + w > innerWidth - 20) px = S.origin.x - r * .78 - w;
    peek.style.transform = `translate(${px}px, ${py}px)`;
  }

  draw(t);
  requestAnimationFrame(tick);
}

function draw(t) {
  const A = GLAZES[Math.max(S.cur, 0)], bi = S.prev >= 0 ? S.prev : Math.max(S.cur, 0), B = GLAZES[bi];
  gl.uniform2f(U.uView, innerWidth, innerHeight);
  gl.uniform1f(U.uDpr, DPR);
  gl.uniform1f(U.uScale, figRect.width / 1296);
  gl.uniform4f(U.uRect, figRect.left, figRect.top, figRect.width, figRect.height);
  gl.uniform4f(U.uStage, stageRect.left, stageRect.top, stageRect.width, stageRect.height);
  gl.uniform2f(U.uOrigin, S.origin.x, S.origin.y);
  gl.uniform2f(U.uPar, S.par.x, S.par.y);
  gl.uniform1f(U.uR, Math.max(S.R, 0));
  gl.uniform1f(U.uLens, S.lens);
  gl.uniform1f(U.uRipple, S.ripple);
  gl.uniform1f(U.uBounce, S.bounce);
  gl.uniform1f(U.uTime, t);
  gl.uniform3fv(U.uA1, rgb(A.c1)); gl.uniform3fv(U.uA2, rgb(A.c2));
  gl.uniform3fv(U.uB1, rgb(B.c1)); gl.uniform3fv(U.uB2, rgb(B.c2));
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, curTex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex[bi]);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, wordTex);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/* ---------------- boot ---------------- */
async function boot() {
  const images = GLAZES.map((g) => { const im = new Image(); im.src = g.src; return im; });
  await Promise.all([
    ...images.map((im) => im.decode()),
    document.fonts.load('100px "Instrument Serif"'),
    document.fonts.load('italic 100px "Instrument Serif"'),
  ]);
  await document.fonts.ready;
  hit = images.map(hitMap);
  try {
    initGL(images);
    onResize();
    requestAnimationFrame(tick);
    // intro: the first glaze pours in from the chinchilla's belly
    setTimeout(() => go(0, bodyAnchor()), 250);
  } catch (err) {
    console.warn('WebGL glaze disabled:', err);
    gl = null;
    document.body.classList.add('no-gl');
    if (location.protocol === 'file:') $('#toast').hidden = false;
    S.cur = 0; applyUI(0);
  }
  document.body.classList.add('is-ready');
}
boot();
