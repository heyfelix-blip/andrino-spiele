// Run & Gun - Koop-Spiel fuer zwei Spieler, laeuft im Browser.
// Wird von der Seite des ShieldServers nachgeladen.
//
// Lockstep: Der Server schickt allen dieselbe Folge aus Eingaben (input) und
// Takten (tick). Jeder Browser rechnet damit exakt denselben Spielverlauf.
// Deshalb: nur ganze Zahlen, eigener Zufallsgenerator, keine Uhrzeit in der Logik.
//
// Schnittstelle (window.RG):
//   start(canvas, role, sendInput, sendEnd, msg)  role = "L", "R" oder "Z"
//   tick()                 ein Spielschritt (20 pro Sekunde)
//   input(who, bits)       Eingabe von Spieler "L" oder "R"
//   stop()                 aufraeumen
//   hash()                 Pruefsumme des Spielstands (zum Testen)
(function () {
  "use strict";

  var VW = 320, VH = 180;                // sichtbarer Ausschnitt
  var LEVEL_END = 2400;
  var GRAV = 2, JUMP = -15, RUN = 4, MAXFALL = 14;
  var PW = 10, PH = 20;
  var B_LEFT = 1, B_RIGHT = 2, B_UP = 4, B_DOWN = 8, B_JUMP = 16, B_FIRE = 32;

  // Boden-Stuecke [von, bis] und Plattformen [x, y, breite]
  var GROUND_Y = 150;
  var GROUND = [[0, 600], [648, 1100], [1148, 1700], [1748, LEVEL_END]];
  var PLATFORMS = [[300, 112, 80], [470, 88, 60], [800, 108, 100], [1000, 82, 60],
                   [1290, 104, 90], [1480, 86, 70], [1880, 104, 80], [2040, 80, 60]];
  var TURRETS = [[500, 72], [880, 132], [1030, 66], [1350, 88], [1520, 70], [1600, 132], [1920, 88]];
  var BOSS_X = 2296;

  var cv, g, myRole, sendInput, sendEnd, msg;
  var st, lastTickAt, myBits, sentBits, keys, ui, raf, endSent;

  // ---------- Zufall (deterministisch) ----------
  function rnd(n) {
    st.seed = (Math.imul(st.seed, 1103515245) + 12345) >>> 0;
    return (st.seed >>> 16) % n;
  }

  // ---------- Spielstand ----------
  function newPlayer(id, x) {
    return { id: id, x: x, y: 60, px: x, py: 60, vy: 0, face: 1, ground: false,
             bits: 0, cool: 0, lives: 5, dead: 0, inv: 40, out: false };
  }

  function newState() {
    var s = {
      seed: 12345, t: 0, camX: 0, score: 0, over: 0, won: false,
      p: [newPlayer("L", 40), newPlayer("R", 60)],
      shots: [], ebullets: [], enemies: [], spawnT: 40,
      boss: { hp: 40, cool: 40, hit: 0 }
    };
    for (var i = 0; i < TURRETS.length; i++) {
      s.enemies.push({ kind: "turret", x: TURRETS[i][0], y: TURRETS[i][1], px: TURRETS[i][0], py: TURRETS[i][1],
                       w: 14, h: 18, hp: 3, cool: 20 + i * 7, hit: 0 });
    }
    return s;
  }

  // ---------- Hilfen ----------
  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // Liefert die Oberkante, auf der etwas landet, das von oldFeet nach newFeet faellt, oder -1.
  function landing(x, w, oldFeet, newFeet) {
    var best = -1, i;
    for (i = 0; i < GROUND.length; i++) {
      if (x + w > GROUND[i][0] && x < GROUND[i][1] && oldFeet <= GROUND_Y && newFeet >= GROUND_Y) best = GROUND_Y;
    }
    for (i = 0; i < PLATFORMS.length; i++) {
      var pl = PLATFORMS[i];
      if (x + w > pl[0] && x < pl[0] + pl[2] && oldFeet <= pl[1] && newFeet >= pl[1]) {
        if (best < 0 || pl[1] < best) best = pl[1];
      }
    }
    return best;
  }

  function alivePlayers() {
    var r = [];
    for (var i = 0; i < 2; i++) if (!st.p[i].dead && !st.p[i].out) r.push(st.p[i]);
    return r;
  }

  function sgn(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }

  function killPlayer(pl) {
    if (pl.dead || pl.out || pl.inv > 0) return;
    pl.lives--;
    pl.dead = 30;                          // 1,5 s bis zum Wiedereinstieg
    if (pl.lives <= 0) pl.out = true;
  }

  // ---------- Ein Spielschritt ----------
  function step() {
    var s = st, i, j, pl, e, b;
    s.t++;
    if (s.over) { s.over++; return; }

    // Spieler
    for (i = 0; i < 2; i++) {
      pl = s.p[i];
      pl.px = pl.x; pl.py = pl.y;
      if (pl.out) continue;
      if (pl.dead) {
        if (--pl.dead === 0) {             // Wiedereinstieg von oben
          pl.x = s.camX + 40 + i * 20; pl.y = 0; pl.px = pl.x; pl.py = pl.y;
          pl.vy = 0; pl.inv = 50;
        }
        continue;
      }
      if (pl.inv > 0) pl.inv--;
      var dx = 0;
      if (pl.bits & B_LEFT) { dx -= RUN; pl.face = -1; }
      if (pl.bits & B_RIGHT) { dx += RUN; pl.face = 1; }
      pl.x += dx;
      if (pl.x < s.camX) pl.x = s.camX;
      if (pl.x > s.camX + VW - PW) pl.x = s.camX + VW - PW;
      if (pl.x > LEVEL_END - PW) pl.x = LEVEL_END - PW;

      if ((pl.bits & B_JUMP) && pl.ground) { pl.vy = JUMP; pl.ground = false; }
      pl.vy = Math.min(pl.vy + GRAV, MAXFALL);
      var oldFeet = pl.y + PH;
      pl.y += pl.vy;
      pl.ground = false;
      if (pl.vy >= 0) {
        var top = landing(pl.x, PW, oldFeet, pl.y + PH);
        if (top >= 0) { pl.y = top - PH; pl.vy = 0; pl.ground = true; }
      }
      if (pl.y > VH + 20) { pl.inv = 0; killPlayer(pl); continue; }

      // Schiessen
      if (pl.cool > 0) pl.cool--;
      if ((pl.bits & B_FIRE) && pl.cool === 0) {
        pl.cool = 4;
        var sx = pl.face, sy = 0;
        if (pl.bits & B_UP) { sy = -1; if (!(pl.bits & (B_LEFT | B_RIGHT))) sx = 0; }
        else if ((pl.bits & B_DOWN) && !pl.ground) { sy = 1; }
        var sp = sx !== 0 && sy !== 0 ? 7 : 10;
        s.shots.push({ x: pl.x + 4 + sx * 6, y: pl.y + 6 + sy * 6, px: pl.x + 4, py: pl.y + 6,
                       vx: sx * sp, vy: sy * sp, life: 34, owner: i });
      }
    }

    // Kamera folgt den Spielern, nur nach rechts
    var alive = alivePlayers();
    if (alive.length) {
      var lead = 0;
      for (i = 0; i < alive.length; i++) lead = Math.max(lead, alive[i].x);
      var want = Math.min(lead - 150, LEVEL_END - VW);
      if (want > s.camX) s.camX = Math.min(want, s.camX + RUN);
    }

    // Laeufer kommen von rechts
    if (s.camX < BOSS_X - VW - 40 && --s.spawnT <= 0) {
      s.spawnT = 22 + rnd(30);
      s.enemies.push({ kind: "runner", x: s.camX + VW + 4, y: 40 + rnd(60), px: s.camX + VW + 4, py: 60,
                       w: 10, h: 18, hp: 1, vy: 0, dir: -1, hit: 0 });
    }

    // Gegner
    for (i = 0; i < s.enemies.length; i++) {
      e = s.enemies[i];
      e.px = e.x; e.py = e.y;
      if (e.hit > 0) e.hit--;
      if (e.kind === "runner") {
        e.x += 3 * e.dir;
        var of = e.y + e.h;
        e.vy = Math.min(e.vy + GRAV, MAXFALL);
        e.y += e.vy;
        var tp = landing(e.x, e.w, of, e.y + e.h);
        if (tp >= 0) { e.y = tp - e.h; e.vy = 0; }
        if (e.y > VH + 30 || e.x < s.camX - 30) e.hp = 0;
      } else if (e.kind === "turret") {
        if (e.x > s.camX - 10 && e.x < s.camX + VW && --e.cool <= 0) {
          e.cool = 34;
          var tgt = nearest(e.x, e.y);
          if (tgt) shootAt(e.x + 7, e.y + 4, tgt, 5);
        }
      }
      // Beruehrung toetet
      for (j = 0; j < 2; j++) {
        pl = s.p[j];
        if (!pl.dead && !pl.out && overlap(pl.x, pl.y, PW, PH, e.x, e.y, e.w, e.h)) killPlayer(pl);
      }
    }

    // Boss: Wand mit Kern am Levelende
    var bs = s.boss;
    if (bs.hp > 0 && s.camX >= BOSS_X - VW - 20) {
      if (bs.hit > 0) bs.hit--;
      if (--bs.cool <= 0) {
        bs.cool = 26;
        var bt = nearest(BOSS_X + 20, 100);
        if (bt) {
          shootAt(BOSS_X + 4, 96, bt, 5);
          s.ebullets.push({ x: BOSS_X + 4, y: 90, px: BOSS_X + 4, py: 90, vx: -5, vy: -2, life: 60 });
          s.ebullets.push({ x: BOSS_X + 4, y: 102, px: BOSS_X + 4, py: 102, vx: -5, vy: 2, life: 60 });
        }
      }
    }

    // Spieler-Schuesse
    for (i = 0; i < s.shots.length; i++) {
      b = s.shots[i];
      b.px = b.x; b.py = b.y;
      b.x += b.vx; b.y += b.vy; b.life--;
      for (j = 0; j < s.enemies.length && b.life > 0; j++) {
        e = s.enemies[j];
        if (e.hp > 0 && overlap(b.x - 2, b.y - 2, 4, 4, e.x, e.y, e.w, e.h)) {
          b.life = 0; e.hp--; e.hit = 3;
          if (e.hp <= 0) s.score += e.kind === "turret" ? 50 : 10;
        }
      }
      if (b.life > 0 && bs.hp > 0 && overlap(b.x - 2, b.y - 2, 4, 4, BOSS_X, 84, 24, 24)) {
        b.life = 0; bs.hp--; bs.hit = 3;
        if (bs.hp <= 0) { s.score += 500; s.won = true; s.over = 1; }
      }
      if (b.x < s.camX - 10 || b.x > s.camX + VW + 10 || b.y < -10 || b.y > VH + 10) b.life = 0;
    }

    // Gegner-Schuesse
    for (i = 0; i < s.ebullets.length; i++) {
      b = s.ebullets[i];
      b.px = b.x; b.py = b.y;
      b.x += b.vx; b.y += b.vy; b.life--;
      for (j = 0; j < 2; j++) {
        pl = s.p[j];
        if (!pl.dead && !pl.out && overlap(b.x - 2, b.y - 2, 4, 4, pl.x + 1, pl.y + 2, PW - 2, PH - 2)) {
          killPlayer(pl); b.life = 0;
        }
      }
    }

    s.shots = s.shots.filter(function (x) { return x.life > 0; });
    s.ebullets = s.ebullets.filter(function (x) { return x.life > 0; });
    s.enemies = s.enemies.filter(function (x) { return x.hp > 0; });

    if (!s.over && s.p[0].out && s.p[1].out) s.over = 1;
  }

  function nearest(x, y) {
    var best = null, bd = 0, a = alivePlayers();
    for (var i = 0; i < a.length; i++) {
      var d = Math.abs(a[i].x - x) + Math.abs(a[i].y - y);
      if (!best || d < bd) { best = a[i]; bd = d; }
    }
    return best;
  }

  // Schuss in eine von 8 Richtungen auf das Ziel
  function shootAt(x, y, tgt, speed) {
    var dx = tgt.x + 5 - x, dy = tgt.y + 10 - y;
    var sx = Math.abs(dx) * 2 > Math.abs(dy) ? sgn(dx) : 0;
    var sy = Math.abs(dy) * 2 > Math.abs(dx) ? sgn(dy) : 0;
    var sp = sx !== 0 && sy !== 0 ? speed - 1 : speed;
    st.ebullets.push({ x: x, y: y, px: x, py: y, vx: sx * sp, vy: sy * sp, life: 70 });
  }

  // ---------- Zeichnen ----------
  function lerp(a, b, f) { return Math.round(a + (b - a) * f); }

  function draw() {
    raf = requestAnimationFrame(draw);
    if (!st) return;
    var s = st, f = Math.min(1, (performance.now() - lastTickAt) / 50), i, e, b, pl;
    var cam = s.camX;
    g.fillStyle = "#0b1030"; g.fillRect(0, 0, VW, VH);
    // Hintergrund: Berge mit Parallaxe
    g.fillStyle = "#1b2550";
    for (i = -1; i < 6; i++) {
      var mx = i * 90 - Math.floor(cam / 3) % 90;
      g.beginPath(); g.moveTo(mx, 150); g.lineTo(mx + 45, 70 + (i & 1) * 20); g.lineTo(mx + 90, 150); g.fill();
    }
    g.save(); g.translate(-cam, 0);
    // Boden
    for (i = 0; i < GROUND.length; i++) {
      g.fillStyle = "#3d6b2f"; g.fillRect(GROUND[i][0], GROUND_Y, GROUND[i][1] - GROUND[i][0], 6);
      g.fillStyle = "#5a3d24"; g.fillRect(GROUND[i][0], GROUND_Y + 6, GROUND[i][1] - GROUND[i][0], VH - GROUND_Y);
    }
    g.fillStyle = "#8a8f99";
    for (i = 0; i < PLATFORMS.length; i++) g.fillRect(PLATFORMS[i][0], PLATFORMS[i][1], PLATFORMS[i][2], 5);
    // Boss
    if (s.boss.hp > 0 || s.over) {
      g.fillStyle = "#444b5a"; g.fillRect(BOSS_X, 30, 40, GROUND_Y - 30);
      g.fillStyle = s.boss.hp <= 0 ? "#222" : s.boss.hit ? "#fff" : "#e0484f";
      g.fillRect(BOSS_X, 84, 24, 24);
    }
    // Gegner
    for (i = 0; i < s.enemies.length; i++) {
      e = s.enemies[i];
      var ex = lerp(e.px, e.x, f), ey = lerp(e.py, e.y, f);
      if (e.kind === "turret") {
        g.fillStyle = e.hit ? "#fff" : "#9a6bd6"; g.fillRect(ex, ey + 6, e.w, e.h - 6);
        g.fillStyle = "#c9a6ff"; g.fillRect(ex + 4, ey, 6, 8);
      } else {
        g.fillStyle = e.hit ? "#fff" : "#d6a24a"; g.fillRect(ex, ey, e.w, e.h);
        g.fillStyle = "#222"; g.fillRect(ex + 1, ey + 4, 3, 2);
      }
    }
    // Spieler
    var COL = ["#3fa7ff", "#ff5a5a"];
    for (i = 0; i < 2; i++) {
      pl = s.p[i];
      if (pl.out || pl.dead) continue;
      if (pl.inv > 0 && (s.t & 2)) continue;   // Blinken nach Wiedereinstieg
      var x = lerp(pl.px, pl.x, f), y = lerp(pl.py, pl.y, f);
      g.fillStyle = COL[i]; g.fillRect(x, y + 6, PW, PH - 6);
      g.fillStyle = "#f2c9a0"; g.fillRect(x + 2, y, 6, 6);
      g.fillStyle = "#ddd"; g.fillRect(pl.face > 0 ? x + PW : x - 5, y + 9, 5, 2);
      if ((i === 0 && myRole === "L") || (i === 1 && myRole === "R")) {
        g.fillStyle = "#fff"; g.fillRect(x + 3, y - 5, 4, 2);   // Markierung "das bist du"
      }
    }
    // Schuesse
    g.fillStyle = "#fff36b";
    for (i = 0; i < s.shots.length; i++) { b = s.shots[i]; g.fillRect(lerp(b.px, b.x, f) - 2, lerp(b.py, b.y, f) - 2, 4, 4); }
    g.fillStyle = "#ff7bd5";
    for (i = 0; i < s.ebullets.length; i++) { b = s.ebullets[i]; g.fillRect(lerp(b.px, b.x, f) - 2, lerp(b.py, b.y, f) - 2, 4, 4); }
    g.restore();

    // Anzeige oben
    g.font = "10px system-ui"; g.textAlign = "left";
    for (i = 0; i < 2; i++) {
      g.fillStyle = COL[i];
      g.fillText((i ? "P2 " : "P1 ") + (s.p[i].out ? "aus" : "\u2665".repeat(s.p[i].lives)), 6 + i * 70, 12);
    }
    g.fillStyle = "#fff"; g.textAlign = "right"; g.fillText("Punkte " + s.score, VW - 6, 12);
    if (s.boss.hp > 0 && s.camX >= BOSS_X - VW - 20) {
      g.fillStyle = "#400"; g.fillRect(110, 6, 100, 5);
      g.fillStyle = "#e0484f"; g.fillRect(110, 6, s.boss.hp * 100 / 40, 5);
    }
    if (s.over) {
      g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(0, 60, VW, 50);
      g.fillStyle = "#fff"; g.textAlign = "center"; g.font = "18px system-ui";
      g.fillText(s.won ? "Geschafft!" : "Game Over", VW / 2, 86);
      g.font = "11px system-ui"; g.fillText("Punkte: " + s.score, VW / 2, 102);
    }
  }

  // ---------- Steuerung: Tastatur und Touch-Knoepfe ----------
  var KEYMAP = { ArrowLeft: B_LEFT, a: B_LEFT, ArrowRight: B_RIGHT, d: B_RIGHT, ArrowUp: B_UP, w: B_UP,
                 ArrowDown: B_DOWN, s: B_DOWN, " ": B_JUMP, z: B_JUMP, k: B_JUMP, x: B_FIRE, j: B_FIRE };

  function onKey(e) {
    var b = KEYMAP[e.key];
    if (!b) return;
    e.preventDefault();
    if (e.type === "keydown") keys |= b; else keys &= ~b;
    pushInput();
  }

  function pushInput() {
    myBits = keys;
    if (ui) for (var i = 0; i < ui.btns.length; i++) if (ui.btns[i].down) myBits |= ui.btns[i].bit;
    if (myRole !== "L" && myRole !== "R") return;
    if (myBits !== sentBits) { sentBits = myBits; sendInput(String(myBits)); }
  }

  function makeButtons() {
    var wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;justify-content:space-between;max-width:800px;margin:8px auto;padding:0 16px;touch-action:none;user-select:none;-webkit-user-select:none";
    var left = document.createElement("div"), right = document.createElement("div");
    var btns = [];
    function mk(parent, label, bit) {
      var b = document.createElement("div");
      b.textContent = label;
      b.style.cssText = "display:inline-block;width:56px;height:56px;line-height:56px;margin:3px;border-radius:12px;background:#2a3038;color:#fff;font:bold 18px system-ui;text-align:center;touch-action:none";
      var o = { el: b, bit: bit, down: false };
      function set(v) { o.down = v; b.style.background = v ? "#2e7dff" : "#2a3038"; pushInput(); }
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); b.setPointerCapture(e.pointerId); set(true); });
      b.addEventListener("pointerup", function () { set(false); });
      b.addEventListener("pointercancel", function () { set(false); });
      b.addEventListener("lostpointercapture", function () { set(false); });
      parent.appendChild(b);
      btns.push(o);
    }
    mk(left, "\u25C0", B_LEFT); mk(left, "\u25B2", B_UP); mk(left, "\u25BC", B_DOWN); mk(left, "\u25B6", B_RIGHT);
    mk(right, "Spr.", B_JUMP); mk(right, "Feuer", B_FIRE);
    wrap.appendChild(left); wrap.appendChild(right);
    cv.parentNode.insertBefore(wrap, cv.nextSibling);
    return { wrap: wrap, btns: btns };
  }

  // ---------- Schnittstelle ----------
  window.RG = {
    start: function (canvas, role, sendIn, sendE, msgFn) {
      cv = canvas; g = cv.getContext("2d");
      cv.width = VW; cv.height = VH;
      cv.style.imageRendering = "pixelated";
      myRole = role; sendInput = sendIn; sendEnd = sendE; msg = msgFn;
      st = newState(); lastTickAt = performance.now();
      keys = 0; myBits = 0; sentBits = 0; endSent = false;
      if (role === "L" || role === "R") {
        ui = makeButtons();
        document.addEventListener("keydown", onKey);
        document.addEventListener("keyup", onKey);
        msg("Run & Gun: du bist " + (role === "L" ? "P1 (blau)" : "P2 (rot)") + ". Pfeile/WASD, Leertaste springt, X schiesst");
      } else {
        msg("Run & Gun: du schaust zu");
      }
      if (!raf) draw();
    },
    tick: function () {
      if (!st) return;
      step();
      lastTickAt = performance.now();
      // 3 s nach Spielende der Server-Bescheid, dann startet er eine neue Runde
      if (st.over === 60 && !endSent && (myRole === "L" || myRole === "R")) { endSent = true; sendEnd(); }
    },
    input: function (who, bits) {
      if (!st) return;
      var v = parseInt(bits, 10) | 0;
      if (who === "L") st.p[0].bits = v;
      else if (who === "R") st.p[1].bits = v;
    },
    stop: function () {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; st = null;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKey);
      if (ui && ui.wrap.parentNode) ui.wrap.parentNode.removeChild(ui.wrap);
      ui = null;
      if (cv) cv.style.imageRendering = "";
    },
    hash: function () {
      if (!st) return "";
      var s = st, h = [s.t, s.camX, s.score, s.seed, s.boss.hp, s.enemies.length, s.shots.length, s.ebullets.length];
      for (var i = 0; i < 2; i++) h.push(s.p[i].x, s.p[i].y, s.p[i].lives, s.p[i].dead);
      for (i = 0; i < s.enemies.length; i++) h.push(s.enemies[i].x, s.enemies[i].y);
      return h.join(",");
    }
  };
})();
