'use strict';
// « Pause café » : mini-jeu du dino de Coffile, affiché pendant les chargements de la Messagerie,
// en plein écran pendant la création d'un projet, et à la demande (bouton Jouer).
// Espace ou ↑ : sauter (appui long = saut plus haut), ↓ : redescendre vite, clic : sauter.
// 3 cœurs ; 5 grains de café = TURBO (plus vite, points ×2, mais on peut toujours se faire toucher).
// Record gardé avec sa couronne.
// Le jeu s'arrête tout seul quand son emplacement disparaît (chargement fini, plein écran fermé).
(() => {
  // ---------- Couleurs : nuances de café, caramel et orange ----------
  const PAL = {
    o: '#2a1a12', // contour expresso
    B: '#f2e3c9', // corps crème
    b: '#fbf3e4', // ventre
    s: '#e8772e', // crête orange
    e: '#ffffff',
    p: '#1a0f0a',
    k: '#efa07c', // joue
    C: '#7a4a2e', // gobelet
    c: '#e8772e', // manchon
    L: '#f3ece0', // couvercle
    g: '#b9773d', // plante caramel
    G: '#8a5230', // plante brune
    h: '#e3a866', // reflet
    f: '#f29a4a', // fleur orange clair
    y: '#f5c46a', // ambre
    r: '#d9622b', // orange brûlé
    R: '#a4441f',
    n: '#4a2e1e',
    N: '#9a6a42',
    t: '#d9a066', // terre cuite
    m: '#f6eee2',
    u: '#efe2c8', // ailes
    x: '#2a1a12',
    v: '#c4733a'
  };
  const HEART = '#e8602c';
  const GOLD = '#f5c46a';

  const DINO_TOP = [
    '..............ooooooo.........',
    '............ooBBBBBBBoo.......',
    '..........s.oBBBBBBBBBBo......',
    '.........ssoBBBBBBBBBeepo.....',
    '.........soBBBBBBBBBBeppBo....',
    '........ssoBBBBBBBBBBBBBBBo...',
    '........soBBBBBBBBBBBBBkkBo...',
    '.......ssoBBBBBBBBBBBBBBBBo...',
    '.......soBBBBBBBBBBoooooooo...',
    '......ssoBBBBBBBBBBBo.........',
    '.....ssoBBBBBBBBBBBBo....LLL..',
    '.....soBBBBBbbbbbBBBo...LLLLL.',
    '....ssoBBBBbbbbbbbBBo...CCCCC.',
    'o...soBBBBbbbbbbbbBBBoooBcccc.',
    'Bo.ssoBBBBbbbbbbbbBBBBBBBcccc.',
    'oBosoBBBBBbbbbbbbbBBoooo.CCCC.',
    '.oBBBBBBBBbbbbbbbbBBo.....CC..',
    '..ooBBBBBBBbbbbbbBBBo.........',
    '....ooBBBBBBbbbbBBBo..........'
  ];
  const LEGS = {
    stand: ['......oBBBBBBBBBBBo...........', '......oBBBoooooBBBo...........', '......oBBBo...oBBBo...........', '......oBBBBo..oBBBBo..........', '......oooooo..oooooo..........'],
    runA: ['......oBBBBBBBBBBBo...........', '......oBBBoooooBBBo...........', '.....oBBBo....oBBBo...........', '....oBBBo.....oBBBBo..........', '....oooo......oooooo..........'],
    runB: ['......oBBBBBBBBBBBo...........', '......oBBBoooooBBBo...........', '......oBBBo....oBBBo..........', '......oBBBBo....oBBBBo........', '......oooooo....oooooo........'],
    jump: ['......oBBBBBBBBBBBo...........', '......oBBBBooBBBBBo...........', '.......oBBBo.oBBBBo...........', '........ooo...oooo............', '..............................']
  };
  const setAt = (row, col, str) => row.slice(0, col) + str + row.slice(col + str.length);
  const blinkTop = DINO_TOP.slice();
  blinkTop[3] = setAt(blinkTop[3], 21, 'BBB');
  blinkTop[4] = setAt(blinkTop[4], 21, 'ppp');
  const hitTop = DINO_TOP.map((r, i) => (i >= 9 && i <= 17 ? r.slice(0, 25) + '.....' : r));
  hitTop[3] = setAt(hitTop[3], 21, 'pBp');
  hitTop[4] = setAt(hitTop[4], 21, 'BpB');
  const HEART_ROWS = ['.oo...oo.', 'orro.orro', 'ormrorrro', 'orrrrrrro', '.orrrrro.', '..orrro..', '...oro...', '....o....'];

  const ART = {
    stand: DINO_TOP.concat(LEGS.stand),
    blink: blinkTop.concat(LEGS.stand),
    runA: DINO_TOP.concat(LEGS.runA),
    runB: DINO_TOP.concat(LEGS.runB),
    jump: DINO_TOP.concat(LEGS.jump),
    hit: hitTop.concat(LEGS.stand),
    cup: ['.LLL.', 'LLLLL', 'CCCCC', 'cccc.', 'cccc.', 'CCCC.', '.CC..'],
    barrel: ['....ff......', '...fyyf.....', '....ffo.....', '..oooooooo..', '.oGgGgGgGgo.', 'oGgGgGgGgGgo', 'oGgGgGgGgGgo', 'oGgGgGgGgGgo', 'oGgGgGgGgGgo', 'oGgGgGgGgGgo', '.oGgGgGgGgo.', '..oooooooo..'],
    saguaro: [
      '......oooo......', '.....ohgGGo.....', '.....ohgGGo.....', '.....ohgGGo.....', '.oo..ohgGGo.....', 'ohGo.ohgGGo.....', 'ohGo.ohgGGo..oo.', 'ohGo.ohgGGo.ohGo',
      'ohGGoohgGGo.ohGo', '.ohGGGhgGGo.ohGo', '..oooohgGGooohGo', '.....ohgGGGGGhGo', '.....ohgGGGGGGo.', '.....ohgGGooooo.', '.....ohgGGo.....', '.....ohgGGo.....',
      '.....ohgGGo.....', '.....ohgGGo.....', '.....ohgGGo.....', '.....ohgGGo.....', '.....ohgGGo.....', '.....ohgGGo.....', '....oohgGGoo....', '....oooooooo....'
    ],
    opuntia: [
      '..r.....r........', '.oRo...oRo.......', '.ooooooooo.......', 'ogGgGgGgGgo......', 'ogyGgGgyGgo.oooo.', 'ogGgGgGgGgoogGgGo', 'ogGgGyGgGgoogyGgo', '.oGgGgGgGoooGgGgo',
      '..ooGgGgGo.oGgGgo', '....oGgGo..ooGgo.', '....oGgGoooGgGo..', '.....oGgGgGgGo...', '......oGgGgGo....', '.......oGgGo.....', '.......oGgGo.....', '......ooooooo....'
    ],
    agave: ['........o.........', '...o....ho....o...', '....o..ohgo..ho...', '..o..o.ohgo.hgo..o', '...ohgoohgoohgo.ho', '.o..ohgohgohgo.hgo', '..ohoohghgohgohgo.', '...ohgohghghgogo..', 'oooohghghghghgoooo', '.ooooooooooooooo..'],
    coffee: [
      '....oo....oo..', '...ogGo..oGgo.', '..ogGGGooGGgo.', '...ooGgGGgGo..', '.oo..oGgGo.oo.', 'ogGoooGgoooGgo', '.oGGrRgGgrRGo.', '..ooRrGgGRroo.', '....ooGgGoo...',
      '.....oGgo.....', '...oooooooo...', '..otttttttto..', '..oNNNNNNNNo..', '...ottttto....', '...otttttto...', '...otttttto...', '....oNNNNo....', '....oooooo....'
    ],
    sunflower: [
      '...oooo....', '..oyyyyo...', '.oyynnyyo..', 'oyynnnnyyo.', 'oyynnnnyyo.', '.oyynnyyo..', '..oyyyyo...', '...oGGo....', '....oGo....', '.oo.oGo....', 'oGgooGo....',
      '.oGgoGo....', '..ooGGo.oo.', '....oGoogGo', '....oGoGgo.', '....oGGoo..', '....oGo....', '....oGo....', '....oGo....', '....oGo....', '...ooGoo...', '...ooooo...'
    ],
    mushroom: ['....oooo....', '..oorrrroo..', '.orrmmrrrro.', 'orrrmmrrmmro', 'ormrrrrrmmro', 'orrrrmmrrrro', 'oooooooooooo', '....oLLo....', '....oLmo....', '....oLLo....', '...oLLLLo...', '...oooooo...'],
    tulips: [
      '..o.....o.......', '.ofo...ovo......', 'offfo.ovvvo.o...', 'offfo.ovvvoorRo.', '.oGo...ovo.orrro', '..oGo..oGo..oRo.', 'oo.oGo.oGo.oGo..', 'ogo.oGooGo.oGo..',
      '.oGooGooGooGo...', '..oGGGoGoGGo....', '...oGGGGGGo.....', '....oGGGGo......', '...oooooooo.....'
    ],
    bee1: ['.....oo.oo....', '....ouuouuo...', '....ouuouuo...', '.....ooooo....', '..oooooooooo..', '.oyyxxyyxxyyo.', 'opyyxxyyxxyyoo', '.oyyxxyyxxyyo.', '..oooooooooo..'],
    bee2: ['..............', '..............', '...ouuuuouuuo.', '....oooooooo..', '..oooooooooo..', '.oyyxxyyxxyyo.', 'opyyxxyyxxyyoo', '.oyyxxyyxxyyo.', '..oooooooooo..'],
    bean: ['..ooo..', '.oNNNo.', 'oNNnNNo', 'oNNnNNo', 'oNnNNNo', 'oNnNNNo', '.oNNNo.', '..ooo..'],
    heart: HEART_ROWS,
    heartL: HEART_ROWS.map((r) => r.slice(0, 5).padEnd(9, '.')),
    heartR: HEART_ROWS.map((r) => '.....' + r.slice(5)),
    heartPick: HEART_ROWS.map((r) => r.replace(/r/g, 'f')),
    crown: ['y...y...y', 'yy.yyy.yy', 'yyyyyyyyy', 'yRyyRyyRy', 'yyyyyyyyy']
  };
  const HEART_COLORS = { r: HEART, o: PAL.o, f: PAL.f, m: PAL.m };

  // Plantes, débloquées au fil du score.
  const PLANTS = [
    { kind: 'barrel', from: 0 },
    { kind: 'mushroom', from: 0 },
    { kind: 'tulips', from: 0 },
    { kind: 'agave', from: 0 },
    { kind: 'coffee', from: 120 },
    { kind: 'opuntia', from: 120 },
    { kind: 'sunflower', from: 220 },
    { kind: 'saguaro', from: 320 }
  ];

  const PX = 2; // un pixel de sprite = 2 unités
  const H = 170; // hauteur du terrain
  const GROUND = 148;
  const DINO_X = 34;
  const GRAVITY = 2300;
  const JUMP = 640;
  const BEANS_FOR_TURBO = 5;
  const TURBO_TIME = 5;
  const HI_KEY = 'coffile-dino-hi';

  // Chaque sprite est dessiné une fois dans un petit canvas (1 px par pixel), puis agrandi.
  // Les frames du dino ont aussi une version blanche (flash quand il est touché) et orange (TURBO).
  function paint(rows, colors, tint) {
    const w = Math.max(...rows.map((r) => r.length));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = rows.length;
    const g = c.getContext('2d');
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = colors[row[x]] || (row[x] !== '.' && PAL[row[x]]);
        if (!col) continue;
        g.fillStyle = tint || col;
        g.fillRect(x, y, 1, 1);
      }
    });
    return { c, w: w * PX, h: rows.length * PX };
  }
  const IMG = {};
  for (const [name, rows] of Object.entries(ART)) {
    const colors = /^heart/.test(name) ? HEART_COLORS : {};
    IMG[name] = paint(rows, colors);
    if (['stand', 'runA', 'runB', 'jump', 'hit'].includes(name)) {
      IMG[`${name}_white`] = paint(rows, colors, '#ffffff');
      IMG[`${name}_glow`] = paint(rows, colors, '#e8772e');
    }
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const hitBox = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
  const CONFETTI = [GOLD, PAL.s, PAL.f, PAL.B, PAL.r];

  function readHi() {
    try {
      return Number(localStorage.getItem(HI_KEY)) || 0;
    } catch {
      return 0;
    }
  }
  function saveHi(v) {
    try {
      localStorage.setItem(HI_KEY, String(v));
    } catch {}
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  class DinoGame {
    constructor() {
      this.el = document.createElement('div');
      this.el.className = 'dino-game';
      this.canvas = document.createElement('canvas');
      this.el.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.running = false;
      this.hi = readHi();
      this.width = 0;
      this.cssWidth = 0;
      this.cssHeight = 0;
      this.scale = 1;
      this.dpr = 1;
      this.loop = this.loop.bind(this);
      this.canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.press();
      });
      this.canvas.addEventListener('pointerup', () => this.release());
      // Collines du fond : deux couches de vagues.
      this.hills = [0, 1].map((layer) => Array.from({ length: 4 }, () => ({ a: rand(6, 16) * (layer + 1), f: rand(0.004, 0.012), p: rand(0, 6) })));
      this.reset();
    }

    reset() {
      this.state = 'idle'; // idle | play | over
      this.y = 0;
      this.vy = 0;
      this.buffered = 0;
      this.held = false;
      this.points = 0;
      this.hearts = 3;
      this.beans = 0;
      this.turbo = 0;
      this.invuln = 0;
      this.speed = 300;
      this.dist = 0;
      this.bonus = 0;
      this.score = 0;
      this.t = 0;
      this.overAt = 0;
      this.startHi = this.hi;
      this.recordShown = false;
      this.obstacles = [];
      this.items = [];
      this.parts = [];
      this.popups = [];
      this.trail = [];
      this.lines = [];
      this.gap = 320;
      this.itemGap = 200;
      this.nextHeart = 700;
      this.dustT = 0;
      // Effets
      this.hitstop = 0;
      this.timeScale = 1;
      this.shakeT = 0;
      this.shakeAmp = 0;
      this.flashT = 0;
      this.vignetteT = 0;
      this.squash = 0; // >0 écrasé (atterrissage), <0 étiré (saut)
      this.zoom = 0;
      this.scorePop = 0;
      this.beanPop = [0, 0, 0, 0, 0];
      this.heartBreak = null;
      this.banner = null;
      this.overShown = 0;
      this.clouds = [
        { x: 120, y: 50, s: 1 },
        { x: 380, y: 68, s: 0.7 },
        { x: 620, y: 44, s: 1.2 }
      ];
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.reset();
      this.colors = this.readColors();
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      cancelAnimationFrame(this.raf);
      if (this.state === 'play') this.saveScore();
    }

    readColors() {
      const css = getComputedStyle(document.documentElement);
      const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
      return { font: v('--font', 'sans-serif'), mono: v('--mono', 'monospace') };
    }

    // ---------- Commandes ----------
    press() {
      if (!this.running) return;
      if (this.state === 'over') {
        if (this.t - this.overAt < 0.7) return;
        this.reset();
        this.state = 'play';
        return;
      }
      if (this.state === 'idle') this.state = 'play';
      // Un seul saut (pas de double saut). Un appui juste avant d'atterrir est gardé un instant.
      if (this.y === 0) this.jump();
      else this.buffered = 0.12;
    }

    jump() {
      this.vy = JUMP;
      this.held = true;
      this.buffered = 0;
      this.squash = -1;
      this.dust(DINO_X + 22, GROUND, 6);
    }

    release() {
      this.held = false;
      this.buffered = 0;
      if (this.vy > 280) this.vy = 280;
    }

    drop() {
      if (this.state === 'play' && this.y > 0) this.vy = Math.min(this.vy, -800);
    }

    saveScore() {
      if (this.score > this.hi) {
        this.hi = this.score;
        saveHi(this.hi);
      }
    }

    // Taille : le terrain garde ~620 de large ; l'emplacement donne l'agrandissement maximal
    // (data-scale-max) et, en plein écran, la hauteur disponible (data-fit="height").
    resize() {
      const slot = this.el.parentElement;
      const css = Math.max(240, Math.round(this.el.clientWidth || 0));
      const max = slot && slot.dataset.scaleMax ? Number(slot.dataset.scaleMax) : 1.4;
      let scale = css >= 520 ? css / 620 : 1;
      if (slot && slot.dataset.fit === 'height') scale = Math.min(scale, (slot.clientHeight - 8) / H);
      scale = clamp(scale, 1, max);
      const dpr = window.devicePixelRatio || 1;
      const cssH = Math.round(H * scale);
      if (css === this.cssWidth && cssH === this.cssHeight && dpr === this.dpr) return;
      this.cssWidth = css;
      this.cssHeight = cssH;
      this.dpr = dpr;
      this.scale = scale;
      this.width = css / scale;
      this.canvas.width = Math.round(css * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.canvas.style.width = `${css}px`;
      this.canvas.style.height = `${cssH}px`;
    }

    // ---------- Apparitions ----------
    spawnObstacle() {
      const W = this.width;
      if (this.score > 150 && Math.random() < 0.24) {
        const high = Math.random() < 0.45;
        this.obstacles.push({ kind: 'bee', x: W + 10, w: IMG.bee1.w, h: IMG.bee1.h, lift: high ? 66 : 12, phase: rand(0, 6) });
        return;
      }
      const pool = PLANTS.filter((p) => this.score >= p.from);
      const n = this.score > 400 && Math.random() < 0.35 ? 2 : 1;
      let x = W + 10;
      for (let i = 0; i < n; i++) {
        const kind = pick(pool.filter((p) => n === 1 || p.kind !== 'saguaro')).kind;
        const im = IMG[kind];
        this.obstacles.push({ kind, x, w: im.w, h: im.h, lift: 0 });
        x += im.w + 2;
      }
    }

    spawnItem() {
      const W = this.width;
      if (this.hearts < 3 && this.score >= this.nextHeart) {
        this.nextHeart = this.score + 700;
        this.items.push({ kind: 'heartPick', x: W + 10, lift: 70 });
        return;
      }
      const arc = Math.random() < 0.5;
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const lift = arc ? 26 + Math.sin((i / (n - 1)) * Math.PI) * 50 : 10;
        this.items.push({ kind: 'bean', x: W + 10 + i * 22, lift });
      }
    }

    // ---------- Effets ----------
    burst(x, y, colors, count, speed = 160, opts = {}) {
      for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2);
        const v = rand(speed * 0.3, speed);
        this.parts.push({
          x, y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - (opts.up || 60),
          life: rand(0.45, 0.9),
          max: 0.9,
          size: rand(opts.min || 2, opts.max || 4),
          color: Array.isArray(colors) ? pick(colors) : colors,
          gravity: opts.gravity !== false,
          spin: opts.spin ? rand(-12, 12) : 0,
          rot: 0
        });
      }
    }

    dust(x, y, n) {
      for (let i = 0; i < n; i++) {
        this.parts.push({ x: x + rand(-10, 10), y: y - rand(0, 3), vx: rand(-90, 30), vy: -rand(10, 50), life: rand(0.25, 0.45), max: 0.45, size: rand(2, 4), color: 'rgba(217, 160, 102, 0.7)' });
      }
    }

    shake(amp, time) {
      this.shakeAmp = Math.max(this.shakeAmp * (this.shakeT > 0 ? 1 : 0), amp);
      this.shakeT = Math.max(this.shakeT, time);
      this.shakeDur = Math.max(this.shakeT, time);
    }

    popup(text, x, y, color, big) {
      this.popups.push({ text, x, y, life: 1, max: 1, color, big });
    }

    showBanner(text, color, sub) {
      this.banner = { text, sub, color, t: 0 };
    }

    dinoBoxes() {
      const top = GROUND - IMG.stand.h - this.y;
      return [
        { x: DINO_X + 24, y: top + 2, w: 26, h: 14 },
        { x: DINO_X + 10, y: top + 18, w: 32, h: 26 }
      ];
    }

    // Coup reçu : arrêt sur image, tremblement, flash, et le cœur perdu se brise en grand.
    hurt() {
      if (this.invuln > 0) return;
      this.hearts--;
      this.invuln = 1.5;
      this.hitstop = this.hearts <= 0 ? 0.32 : 0.16;
      this.timeScale = 0.25;
      this.shake(this.hearts <= 0 ? 9 : 6, 0.45);
      this.flashT = 0.16;
      this.vignetteT = 0.5;
      this.burst(DINO_X + 52, GROUND - IMG.stand.h - this.y + 26, [PAL.C, PAL.N, PAL.n], 18, 230);
      this.heartBreak = { i: this.hearts, t: 0 };
      this.turbo = 0;
      this.trail = [];
      if (this.hearts <= 0) {
        this.state = 'over';
        this.overAt = this.t;
        this.newRecord = this.score > this.startHi && this.score > 0;
        this.saveScore();
        this.vy = 380; // petit saut de surprise
        if (this.newRecord) setTimeout(() => this.running && this.burst(this.width / 2, 40, CONFETTI, 60, 260, { up: 120, spin: true }), 450);
      }
    }

    // ---------- Mise à jour ----------
    update(dt) {
      // Effets en temps réel (ils continuent pendant l'arrêt sur image).
      this.shakeT = Math.max(0, this.shakeT - dt);
      this.flashT = Math.max(0, this.flashT - dt);
      this.vignetteT = Math.max(0, this.vignetteT - dt);
      this.scorePop = Math.max(0, this.scorePop - dt * 3);
      this.zoom = Math.max(0, this.zoom - dt * 2.5);
      this.beanPop = this.beanPop.map((v) => Math.max(0, v - dt * 3));
      if (this.heartBreak && (this.heartBreak.t += dt) > 1.15) this.heartBreak = null;
      if (this.banner && (this.banner.t += dt) > 1.8) this.banner = null;
      if (this.hitstop > 0) {
        this.hitstop -= dt;
        return;
      }
      // Ralenti après un coup, qui revient vite à la normale.
      this.timeScale = Math.min(1, this.timeScale + dt * 1.8);
      const sdt = dt * this.timeScale;
      this.t += sdt;
      this.squash *= Math.pow(0.0005, sdt);
      for (const p of this.parts) {
        p.life -= sdt;
        p.x += p.vx * sdt;
        p.y += p.vy * sdt;
        if (p.gravity) p.vy += 900 * sdt;
        if (p.spin) p.rot += p.spin * sdt;
      }
      this.parts = this.parts.filter((p) => p.life > 0);
      for (const p of this.popups) {
        p.life -= sdt;
        p.y -= 34 * sdt;
      }
      this.popups = this.popups.filter((p) => p.life > 0);
      for (const l of this.lines) l.x -= l.v * sdt;
      this.lines = this.lines.filter((l) => l.x + l.w > 0);

      if (this.state === 'over') {
        this.overShown = Math.min(1, this.overShown + sdt * 1.6);
        if (this.y > 0 || this.vy > 0) {
          this.y = Math.max(0, this.y + this.vy * sdt);
          this.vy -= GRAVITY * sdt;
          if (this.y === 0) this.vy = 0;
        }
        return;
      }
      if (this.state !== 'play') {
        for (const c of this.clouds) c.x -= 10 * sdt;
        return;
      }
      this.turbo = Math.max(0, this.turbo - sdt);
      this.invuln = Math.max(0, this.invuln - sdt);
      this.speed = Math.min(820, this.speed + 8 * sdt);
      const speed = this.speed * (this.turbo > 0 ? 1.4 : 1);
      this.dist += speed * sdt;
      this.buffered = Math.max(0, this.buffered - sdt);
      // Points à la distance, doublés pendant le TURBO.
      this.points += speed * sdt * 0.025 * (this.turbo > 0 ? 2 : 1);
      const score = Math.floor(this.points) + this.bonus;
      if (Math.floor(score / 100) > Math.floor(this.score / 100)) {
        this.scorePop = 1;
        this.burst(this.width - 40, 22, [GOLD, PAL.f], 10, 120, { up: 40 });
      }
      this.score = score;
      if (!this.recordShown && this.startHi > 0 && this.score > this.startHi) {
        this.recordShown = true;
        this.showBanner('NOUVEAU RECORD !', GOLD, 'continue comme ça');
        this.burst(this.width / 2, 50, CONFETTI, 40, 240, { up: 100, spin: true });
      }
      // Saut, atterrissage (écrasement + poussière)
      if (this.y > 0 || this.vy > 0) {
        this.y += this.vy * sdt;
        this.vy -= GRAVITY * sdt;
        const ceiling = GROUND - IMG.stand.h - 6;
        if (this.y > ceiling) {
          this.y = ceiling;
          this.vy = Math.min(this.vy, 0);
        }
        if (this.y <= 0) {
          this.y = 0;
          this.vy = 0;
          this.squash = 1;
          this.dust(DINO_X + 24, GROUND, 8);
          if (this.buffered > 0) this.jump();
        }
      } else if ((this.dustT -= sdt) <= 0) {
        this.dustT = 0.09;
        this.dust(DINO_X + 14, GROUND, 1);
      }
      // Défilement
      for (const o of this.obstacles) o.x -= speed * sdt;
      for (const it of this.items) it.x -= speed * sdt;
      this.obstacles = this.obstacles.filter((o) => o.x + o.w > -10 && !o.gone);
      this.items = this.items.filter((it) => it.x > -20 && !it.taken);
      this.gap -= speed * sdt;
      if (this.gap <= 0) {
        this.spawnObstacle();
        const min = this.speed * 0.62 + 170;
        this.gap = min + Math.random() * min * 0.8;
        this.itemGap = this.gap * rand(0.35, 0.6);
      }
      if (this.itemGap > 0) {
        this.itemGap -= speed * sdt;
        if (this.itemGap <= 0 && Math.random() < 0.55) this.spawnItem();
      }
      for (const c of this.clouds) {
        c.x -= speed * 0.12 * sdt;
        if (c.x < -80) {
          c.x = this.width + rand(0, 200);
          c.y = rand(44, 80);
          c.s = rand(0.6, 1.3);
        }
      }
      // TURBO : traînée du dino et lignes de vitesse
      if (this.turbo > 0) {
        this.trail.unshift({ y: this.y, t: this.t });
        this.trail = this.trail.slice(0, 6);
        if (Math.random() < 0.5) this.lines.push({ x: this.width + 10, y: rand(30, GROUND - 6), w: rand(20, 70), v: speed * rand(1.6, 2.4) });
      } else this.trail = [];
      // Collisions
      const dino = this.dinoBoxes();
      for (const it of this.items) {
        const im = IMG[it.kind];
        const box = { x: it.x - 4, y: GROUND - im.h - it.lift - 4, w: im.w + 8, h: im.h + 8 };
        if (!dino.some((b) => hitBox(b, box))) continue;
        it.taken = true;
        if (it.kind === 'heartPick') {
          this.hearts = Math.min(3, this.hearts + 1);
          this.popup('+1 ♥', it.x, box.y, PAL.f, true);
          this.burst(it.x + 7, box.y + 6, [PAL.f, HEART], 14);
          continue;
        }
        const gain = this.turbo > 0 ? 20 : 10;
        this.bonus += gain;
        this.popup(`+${gain}`, it.x, box.y, GOLD);
        this.burst(it.x + 7, box.y + 8, [GOLD, PAL.L], 8, 130, { min: 1.5, max: 3 });
        if (this.turbo <= 0) {
          this.beanPop[this.beans] = 1;
          if (++this.beans >= BEANS_FOR_TURBO) {
            this.beans = 0;
            this.turbo = TURBO_TIME;
            this.zoom = 1;
            this.shake(3, 0.2);
            this.showBanner('TURBO CAFÉ !', PAL.s, 'plus vite · points ×2');
          }
        }
      }
      for (const o of this.obstacles) {
        const box = { x: o.x + 3, y: GROUND - o.h - o.lift + 3, w: o.w - 6, h: o.h - 6 };
        if (!dino.some((b) => hitBox(b, box))) continue;
        // Pas d'invincibilité en TURBO : un coup arrête le TURBO et coûte un cœur.
        this.hurt();
        if (this.state === 'over') break;
      }
    }

    // ---------- Dessin ----------
    snap(v) {
      const k = this.dpr * this.scale;
      return Math.round(v * k) / k;
    }

    image(name, x, y, alpha = 1) {
      const im = IMG[name];
      const ctx = this.ctx;
      if (alpha !== 1) ctx.globalAlpha = alpha;
      ctx.drawImage(im.c, this.snap(x), this.snap(y), im.w, im.h);
      if (alpha !== 1) ctx.globalAlpha = 1;
    }

    // Sprite agrandi autour d'un point (cœur qui se brise, couronne…).
    imageAt(name, cx, cy, scale, alpha = 1, rot = 0) {
      const im = IMG[name];
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      if (rot) ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.drawImage(im.c, -im.w / 2, -im.h / 2, im.w, im.h);
      ctx.restore();
    }

    drawSky() {
      const ctx = this.ctx;
      const W = this.width;
      const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
      sky.addColorStop(0, 'rgba(232, 119, 46, 0)');
      sky.addColorStop(1, 'rgba(232, 119, 46, 0.07)');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, GROUND);
      for (const c of this.clouds) {
        const s = c.s;
        ctx.fillStyle = 'rgba(242, 227, 201, 0.07)';
        ctx.beginPath();
        for (const [dx, dy, r] of [[0, 6, 9], [13, 0, 13], [28, 5, 10]]) {
          ctx.moveTo(c.x + (dx + r) * s, c.y + dy * s);
          ctx.arc(c.x + dx * s, c.y + dy * s, r * s, 0, Math.PI * 2);
        }
        ctx.rect(c.x, c.y + 6 * s, 28 * s, 9 * s);
        ctx.fill('nonzero');
      }
      this.hills.forEach((waves, layer) => {
        const off = this.dist * (layer ? 0.12 : 0.05);
        ctx.fillStyle = layer ? 'rgba(138, 82, 48, 0.16)' : 'rgba(185, 119, 61, 0.08)';
        ctx.beginPath();
        ctx.moveTo(0, GROUND);
        for (let x = 0; x <= W; x += 6) {
          let h = layer ? 14 : 30;
          for (const w of waves) h += Math.sin((x + off) * w.f + w.p) * w.a * 0.5;
          ctx.lineTo(x, GROUND - Math.max(4, h));
        }
        ctx.lineTo(W, GROUND);
        ctx.fill();
      });
    }

    drawGround() {
      const ctx = this.ctx;
      const W = this.width;
      const soil = ctx.createLinearGradient(0, GROUND, 0, H);
      soil.addColorStop(0, 'rgba(122, 74, 46, 0.45)');
      soil.addColorStop(1, 'rgba(122, 74, 46, 0.1)');
      ctx.fillStyle = soil;
      ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.fillStyle = 'rgba(227, 168, 102, 0.55)';
      ctx.fillRect(0, GROUND, W, 1.5);
      const off = this.dist % 61;
      for (let x = -off; x < W + 61; x += 61) {
        ctx.fillStyle = 'rgba(154, 106, 66, 0.7)';
        ctx.fillRect(x + 6, GROUND + 6, 4, 2);
        ctx.fillRect(x + 31, GROUND + 13, 3, 2);
        ctx.fillStyle = 'rgba(185, 119, 61, 0.6)';
        ctx.fillRect(x + 48, GROUND - 3, 1, 3);
        ctx.fillRect(x + 50, GROUND - 4, 1, 4);
        ctx.fillRect(x + 52, GROUND - 2, 1, 2);
      }
    }

    drawSteam(cupX, cupY) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(243, 236, 224, 0.45)';
      for (let i = 0; i < 3; i++) {
        const ph = (this.t * 1.6 + i / 3) % 1;
        ctx.globalAlpha = 1 - ph;
        ctx.fillRect(cupX + 2 + i * 3 + Math.sin(ph * 6 + i) * 2, cupY - ph * 16, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    drawDino() {
      const ctx = this.ctx;
      let frame;
      if (this.state === 'over') frame = 'hit';
      else if (this.state === 'idle') frame = this.t % 3 < 0.15 ? 'blink' : 'stand';
      else if (this.y > 0) frame = 'jump';
      else frame = Math.floor(this.t * 12) % 2 ? 'runA' : 'runB';
      const im = IMG[frame];
      const top = GROUND - im.h - this.y + (this.state === 'idle' && Math.floor(this.t * 2) % 2 ? 1 : 0);
      // Traînée orange du TURBO
      this.trail.forEach((p, i) => {
        if (i % 2) return;
        this.image(`${frame === 'blink' ? 'stand' : frame}_glow`, DINO_X - (i + 1) * 9, GROUND - im.h - p.y, 0.32 - i * 0.05);
      });
      if (this.turbo > 0) {
        const g = ctx.createRadialGradient(DINO_X + 28, top + 26, 4, DINO_X + 28, top + 26, 46);
        g.addColorStop(0, `rgba(232, 119, 46, ${0.28 + Math.sin(this.t * 20) * 0.06})`);
        g.addColorStop(1, 'rgba(232, 119, 46, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(DINO_X - 20, top - 20, 100, 90);
      }
      // Ombre au sol
      ctx.fillStyle = `rgba(42, 26, 18, ${0.35 - Math.min(0.25, this.y / 400)})`;
      ctx.beginPath();
      ctx.ellipse(DINO_X + 24, GROUND + 1, 18 - Math.min(8, this.y / 12), 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Écrasement / étirement autour des pieds
      const sq = this.squash;
      const sy = 1 - sq * 0.16;
      const sx = 1 + sq * 0.14;
      const hurtBlink = this.invuln > 0 && this.state === 'play' && Math.floor(this.invuln * 14) % 2;
      ctx.save();
      ctx.translate(DINO_X + im.w / 2, top + im.h);
      ctx.scale(sx, sy);
      ctx.globalAlpha = hurtBlink ? 0.4 : 1;
      ctx.drawImage(im.c, -im.w / 2, -im.h, im.w, im.h);
      if (this.flashT > 0 && IMG[`${frame}_white`]) {
        ctx.globalAlpha = Math.min(1, this.flashT / 0.1);
        ctx.drawImage(IMG[`${frame}_white`].c, -im.w / 2, -im.h, im.w, im.h);
      }
      ctx.restore();
      if (frame === 'hit') this.image('cup', DINO_X + 66, GROUND - IMG.cup.h);
      else this.drawSteam(DINO_X + 48, top + 18);
    }

    drawHud() {
      const ctx = this.ctx;
      const col = this.colors;
      const W = this.width;
      // Cœurs (celui qui vient d'être perdu se brise)
      for (let i = 0; i < 3; i++) {
        const lost = i >= this.hearts;
        const breaking = this.heartBreak && this.heartBreak.i === i;
        if (breaking) continue;
        const beat = !lost && this.hearts === 1 ? 1 + Math.max(0, Math.sin(this.t * 9)) * 0.18 : 1;
        this.imageAt('heart', 20 + i * 22, 19, beat, lost ? 0.2 : 1);
      }
      // Grains / jauge TURBO
      if (this.turbo > 0) {
        roundRect(ctx, 86, 14, 80, 10, 5);
        ctx.fillStyle = 'rgba(232, 119, 46, 0.2)';
        ctx.fill();
        roundRect(ctx, 86, 14, Math.max(10, 80 * (this.turbo / TURBO_TIME)), 10, 5);
        ctx.fillStyle = PAL.s;
        ctx.fill();
        ctx.font = `800 9px ${col.font}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = PAL.s;
        ctx.fillText('TURBO ×2', 172, 19.5);
      } else {
        for (let i = 0; i < BEANS_FOR_TURBO; i++) this.imageAt('bean', 92 + i * 15, 19, 1 + this.beanPop[i] * 0.7, i < this.beans ? 1 : 0.22);
      }
      // Record (couronne, en jaune) et score
      const pad = (n) => String(n).padStart(5, '0');
      const hiNow = Math.max(this.hi, this.score);
      const beating = this.state === 'play' && this.startHi > 0 && this.score > this.startHi;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.font = `700 12px ${col.mono}`;
      ctx.fillStyle = GOLD;
      ctx.fillText(pad(hiNow), W - 70, 18.5);
      const crownBob = beating ? Math.sin(this.t * 10) * 1.5 : 0;
      this.imageAt('crown', W - 70 - ctx.measureText(pad(hiNow)).width - 13, 17 + crownBob, beating ? 1.15 : 1);
      ctx.save();
      ctx.translate(W - 10, 18.5);
      const sp = 1 + this.scorePop * 0.35;
      ctx.scale(sp, sp);
      ctx.font = `800 13px ${col.mono}`;
      ctx.fillStyle = this.scorePop > 0 ? GOLD : '#f2e3c9';
      ctx.fillText(pad(this.score), 0, 0);
      ctx.restore();
    }

    drawHeartBreak() {
      const hb = this.heartBreak;
      if (!hb) return;
      const ctx = this.ctx;
      const t = hb.t;
      const fromX = 20 + hb.i * 22;
      const fromY = 19;
      const cx = this.width / 2;
      const cy = 64;
      // 1) le cœur grossit et vient au centre, 2) il tremble et se fissure, 3) il éclate en deux.
      if (t < 0.22) {
        const k = easeOutBack(t / 0.22);
        this.imageAt('heart', fromX + (cx - fromX) * k, fromY + (cy - fromY) * k, 1 + 3.2 * k);
      } else if (t < 0.5) {
        const j = (t - 0.22) / 0.28;
        const sx = cx + (Math.random() - 0.5) * 6 * j;
        this.imageAt('heart', sx, cy, 4.2);
        ctx.strokeStyle = PAL.o;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const pts = [[0, -11], [-3, -5], [3, 0], [-2, 6], [1, 12]];
        pts.slice(0, 1 + Math.ceil(j * (pts.length - 1))).forEach(([px, py], i) => (i ? ctx.lineTo(sx + px, cy + py) : ctx.moveTo(sx + px, cy + py)));
        ctx.stroke();
      } else {
        const j = (t - 0.5) / 0.65;
        if (!hb.shards) {
          hb.shards = true;
          this.burst(cx, cy, [HEART, PAL.r, PAL.o], 22, 260, { spin: true });
        }
        const a = Math.max(0, 1 - j);
        this.imageAt('heartL', cx - 4 - j * 46, cy + j * j * 70, 4.2, a, -j * 1.4);
        this.imageAt('heartR', cx + 4 + j * 46, cy + j * j * 70, 4.2, a, j * 1.4);
      }
    }

    drawPopups() {
      const ctx = this.ctx;
      const col = this.colors;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const p of this.popups) {
        const age = p.max - p.life;
        const s = Math.min(1, easeOutBack(Math.min(1, age / 0.18)));
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life * 2.5);
        ctx.translate(p.x + 8, p.y);
        ctx.scale(s, s);
        ctx.font = `800 ${p.big ? 13 : 11}px ${col.font}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(42, 26, 18, 0.8)';
        ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      }
    }

    drawBanner() {
      const b = this.banner;
      if (!b) return;
      const ctx = this.ctx;
      const col = this.colors;
      const inK = easeOutBack(Math.min(1, b.t / 0.3));
      const alpha = b.t > 1.4 ? Math.max(0, 1 - (b.t - 1.4) / 0.4) : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.width / 2, 52);
      ctx.scale(inK, inK);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 20px ${col.font}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(42, 26, 18, 0.9)';
      ctx.strokeText(b.text, 0, 0);
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, 0, 0);
      if (b.sub) {
        ctx.font = `600 10.5px ${col.font}`;
        ctx.fillStyle = '#f2e3c9';
        ctx.fillText(b.sub, 0, 18);
      }
      ctx.restore();
    }

    drawIdle() {
      const ctx = this.ctx;
      const col = this.colors;
      const W = this.width;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 14px ${col.font}`;
      ctx.fillStyle = '#f2e3c9';
      const pulse = 1 + Math.sin(this.t * 4) * 0.03;
      ctx.save();
      ctx.translate(W / 2 + 30, 60);
      ctx.scale(pulse, pulse);
      ctx.fillText('Espace ou ↑ pour sauter · ↓ pour redescendre', 0, 0);
      ctx.restore();
      ctx.font = `500 11px ${col.font}`;
      ctx.fillStyle = 'rgba(242, 227, 201, 0.6)';
      ctx.fillText('Évite les plantes et les abeilles · 5 grains de café = TURBO (points ×2)', W / 2 + 30, 82);
    }

    // Fin de partie : score, et comparaison au record (nouveau record ou pourcentage).
    drawOver() {
      const ctx = this.ctx;
      const col = this.colors;
      const W = this.width;
      const k = easeOutBack(this.overShown);
      const pw = 250;
      const ph = 96;
      ctx.save();
      ctx.translate(W / 2, 74);
      ctx.scale(k, k);
      roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 12);
      ctx.fillStyle = 'rgba(30, 19, 13, 0.92)';
      ctx.fill();
      ctx.strokeStyle = this.newRecord ? GOLD : 'rgba(232, 119, 46, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 17px ${col.font}`;
      ctx.fillStyle = PAL.s;
      ctx.fillText('PLUS DE CAFÉ !', 0, -30);
      const shown = Math.round(this.score * Math.min(1, this.overShown * 1.3));
      ctx.font = `800 22px ${col.mono}`;
      ctx.fillStyle = '#f2e3c9';
      ctx.fillText(String(shown), 0, -6);
      if (this.newRecord) {
        const text = this.startHi > 0 ? `NOUVEAU RECORD ! (+${this.score - this.startHi})` : 'PREMIER RECORD !';
        ctx.font = `900 13px ${col.font}`;
        const left = -(ctx.measureText(text).width + 30) / 2;
        this.imageAt('crown', left + 11, 20 + Math.sin(this.t * 8) * 1.5, 1.4);
        ctx.textAlign = 'left';
        ctx.fillStyle = GOLD;
        ctx.fillText(text, left + 30, 20.5);
        ctx.textAlign = 'center';
      } else {
        const pct = this.startHi ? Math.min(99, Math.floor((this.score / this.startHi) * 100)) : 0;
        const fill = (pct / 100) * Math.min(1, this.overShown * 1.3);
        roundRect(ctx, -90, 14, 180, 7, 3.5);
        ctx.fillStyle = 'rgba(245, 196, 106, 0.15)';
        ctx.fill();
        roundRect(ctx, -90, 14, Math.max(7, 180 * fill), 7, 3.5);
        ctx.fillStyle = GOLD;
        ctx.fill();
        this.imageAt('crown', 101, 17, 1.1);
        ctx.font = `600 10.5px ${col.font}`;
        ctx.fillStyle = GOLD;
        ctx.fillText(`${pct} % de ton record (${this.startHi})`, 0, 31);
      }
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.font = `500 11px ${col.font}`;
      ctx.fillStyle = `rgba(242, 227, 201, ${this.t - this.overAt > 0.7 ? 0.55 + Math.sin(this.t * 5) * 0.25 : 0})`;
      ctx.fillText('Espace pour rejouer', W / 2, 132);
    }

    draw() {
      const ctx = this.ctx;
      const W = this.width;
      const k = this.dpr * this.scale;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, W, H);
      // Monde (avec tremblement et petit zoom au TURBO)
      const amp = this.shakeT > 0 ? this.shakeAmp * (this.shakeT / (this.shakeDur || 1)) : 0;
      ctx.save();
      ctx.translate(rand(-amp, amp), rand(-amp, amp) * 0.6);
      if (this.zoom > 0) {
        const z = 1 + this.zoom * 0.05;
        ctx.translate(DINO_X + 30, GROUND);
        ctx.scale(z, z);
        ctx.translate(-(DINO_X + 30), -GROUND);
      }
      this.drawSky();
      ctx.fillStyle = 'rgba(242, 227, 201, 0.35)';
      for (const l of this.lines) ctx.fillRect(l.x, l.y, l.w, 1);
      this.drawGround();
      for (const it of this.items) {
        const im = IMG[it.kind];
        const y = GROUND - im.h - it.lift + Math.sin(this.t * 5 + it.x * 0.05) * 2;
        const g = ctx.createRadialGradient(it.x + im.w / 2, y + im.h / 2, 1, it.x + im.w / 2, y + im.h / 2, 13);
        g.addColorStop(0, it.kind === 'bean' ? 'rgba(245, 196, 106, 0.35)' : 'rgba(242, 154, 74, 0.4)');
        g.addColorStop(1, 'rgba(245, 196, 106, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(it.x - 10, y - 10, im.w + 20, im.h + 20);
        this.image(it.kind, it.x, y);
      }
      for (const o of this.obstacles) {
        if (o.kind === 'bee') {
          const frame = Math.floor(this.t * 14) % 2 ? 'bee1' : 'bee2';
          this.image(frame, o.x, GROUND - o.h - o.lift + Math.sin(this.t * 8 + o.phase) * 3);
        } else this.image(o.kind, o.x, GROUND - o.h);
      }
      this.drawDino();
      for (const p of this.parts) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
        ctx.fillStyle = p.color;
        if (p.spin) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        } else ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      this.drawPopups();
      ctx.restore();
      // Flash et vignette quand on est touché
      if (this.vignetteT > 0) {
        const a = this.vignetteT / 0.5;
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.6);
        g.addColorStop(0, 'rgba(232, 96, 44, 0)');
        g.addColorStop(1, `rgba(232, 96, 44, ${0.35 * a})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      this.drawHud();
      this.drawBanner();
      if (this.state === 'idle') this.drawIdle();
      if (this.state === 'over') this.drawOver();
      this.drawHeartBreak();
    }

    loop(now) {
      if (!this.running) return;
      if (!this.el.isConnected || this.el.offsetParent === null) return this.stop();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.resize();
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  // Une seule partie, placée dans l'emplacement [data-dino] visible
  // (le plein écran d'abord, sinon le premier chargement affiché).
  const game = new DinoGame();
  const visible = (s) => s.offsetParent !== null || (s.closest('.dino-full') && !s.closest('.hidden'));

  function mount() {
    const slots = Array.from(document.querySelectorAll('[data-dino]')).filter(visible);
    const slot = slots.find((s) => s.dataset.dino === 'play') || slots[0];
    if (!slot) {
      if (game.el.isConnected) game.el.remove();
      game.stop();
      return;
    }
    if (game.el.parentNode !== slot) slot.appendChild(game.el);
    game.start();
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      mount();
    });
  };

  const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  document.addEventListener(
    'keydown',
    (e) => {
      if (!game.running || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!e.repeat) game.press();
      } else if (e.key === 'ArrowDown' && game.state === 'play') {
        e.preventDefault();
        game.drop();
      }
    },
    true
  );
  document.addEventListener(
    'keyup',
    (e) => {
      if (!game.running || typing(e.target)) return;
      if (e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        game.release();
      }
    },
    true
  );

  window.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    schedule();
  });

  // Petite image du dino pour le bouton « Jouer ».
  function icon() {
    const im = IMG.stand;
    const c = document.createElement('canvas');
    c.width = im.c.width * 2;
    c.height = im.c.height * 2;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(im.c, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  window.Dino = { mount, game, icon };
})();
