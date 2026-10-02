// K\u00F6nigreiche \u2013 Echtzeit-Strategie f\u00FCr zwei Spieler (eigenes Spiel im Stil klassischer Aufbau-Strategiespiele)
// Wird von app.js nachgeladen und meldet sich als window.GAMES.A an.
//
// Lockstep: Der Server schickt allen dieselbe Folge aus Befehlen (input) und Takten (tick).
// Jeder Browser rechnet damit exakt dieselbe Simulation. Darum gilt in der Simulation:
// nur ganze Zahlen, eigener Zufallsgenerator, feste Reihenfolgen, nichts aus der Anzeige.
//
// Befehle (nach "i|", max. 62 Zeichen, IDs in Basis 36 mit "." getrennt):
//   m,tx,ty,ids     laufen            g,tx,ty,ids     Rohstoff sammeln
//   a,id,ids        Ziel: angreifen / mitbauen / Farm / abliefern
//   b,typ,tx,ty,ids Geb\u00E4ude setzen     t,bid,typ       ausbilden
//   c,bid           letzte Ausbildung abbrechen        r,bid,tx,ty  Sammelpunkt
//   u,bid           Zeitalter-Aufstieg                 k,ids        stopp
//   s               aufgeben
(function () {
  "use strict";

  // ======================================================================
  // Spielregeln
  // ======================================================================
  var T = 64;                       // Welt-Einheiten pro Feld
  var MW = 40, MH = 40, N = MW * MH;
  var RES_NAMES = ["", "Holz", "Nahrung", "Gold", "Stein"];
  var R_WOOD = 1, R_FOOD = 2, R_GOLD = 3, R_STONE = 4;
  var RES_KEY = ["", "w", "f", "g", "s"];
  var GATHER_RATE = [0, 14, 12, 16, 18];   // Takte pro Einheit
  var CARRY = 10;

  var UNITS = {
    vil: { name: "Dorfbewohner", icon: "\uD83D\uDC77", hp: 25, atk: 3, arm: 0, rng: 0, spd: 4, cd: 20, sight: 4, cost: { f: 50 }, time: 200 },
    swd: { name: "Schwertk\u00E4mpfer", icon: "\uD83D\uDDE1\uFE0F", hp: 60, atk: 7, arm: 1, rng: 0, spd: 4, cd: 20, sight: 5, cost: { f: 60, g: 20 }, time: 240, bld: 4 },
    spr: { name: "Speertr\u00E4ger", icon: "\uD83D\uDD31", hp: 45, atk: 4, arm: 0, rng: 0, spd: 4, cd: 20, sight: 5, cost: { f: 35, w: 25 }, time: 200, vsCav: 12 },
    arc: { name: "Bogensch\u00FCtze", icon: "\uD83C\uDFF9", hp: 30, atk: 4, arm: 0, rng: 5, spd: 4, cd: 30, sight: 6, cost: { w: 25, g: 45 }, time: 240 },
    cav: { name: "Reiter", icon: "\uD83D\uDC0E", hp: 100, atk: 8, arm: 2, rng: 0, spd: 6, cd: 22, sight: 6, cost: { f: 80, g: 70 }, time: 300, age: 2, vsArc: 6 }
  };
  var BUILDS = {
    tc:  { name: "Dorfzentrum", icon: "\uD83C\uDFF0", size: 3, hp: 1500, pop: 5, drop: "fwgs", trains: ["vil"], atk: 5, rng: 6, cd: 30, sight: 7 },
    hou: { name: "Haus", icon: "\uD83C\uDFE0", size: 2, hp: 300, pop: 5, cost: { w: 30 }, time: 200, sight: 3 },
    lag: { name: "Lager", icon: "\uD83D\uDCE6", size: 2, hp: 400, drop: "wgs", cost: { w: 100 }, time: 300, sight: 3 },
    mil: { name: "M\u00FChle", icon: "\uD83C\uDF3E", size: 2, hp: 400, drop: "f", cost: { w: 100 }, time: 300, sight: 3 },
    frm: { name: "Farm", icon: "\uD83C\uDF31", size: 2, hp: 150, cost: { w: 60 }, time: 200, sight: 1, walk: true, food: 450 },
    bar: { name: "Kaserne", icon: "\u2694\uFE0F", size: 3, hp: 800, trains: ["swd", "spr"], cost: { w: 150 }, time: 400, sight: 3 },
    rng: { name: "Schie\u00DFstand", icon: "\uD83C\uDFAF", size: 3, hp: 700, trains: ["arc"], cost: { w: 150 }, time: 400, sight: 3 },
    stb: { name: "Stall", icon: "\uD83D\uDC34", size: 3, hp: 700, trains: ["cav"], cost: { w: 150 }, time: 400, sight: 3, age: 2 },
    tow: { name: "Turm", icon: "\uD83D\uDDFC", size: 2, hp: 700, cost: { w: 50, s: 125 }, time: 500, atk: 7, rng: 7, cd: 25, sight: 8, age: 2 }
  };
  var BUILD_ORDER = ["hou", "frm", "mil", "lag", "bar", "rng", "stb", "tow"];
  var AGE_COST = { f: 400, g: 150 }, AGE_TIME = 600;
  var START_RES = { f: 200, w: 200, g: 100, s: 100 };
  var POP_MAX = 100;

  // ======================================================================
  // Simulation
  // ======================================================================
  var S = null;             // Spielstand
  var terrain, res, amt, occ;

  function rnd(n) {
    S.seed = (Math.imul(S.seed, 1103515245) + 12345) >>> 0;
    return (S.seed >>> 16) % n;
  }
  function idx(x, y) { return y * MW + x; }
  function inMap(x, y) { return x >= 0 && y >= 0 && x < MW && y < MH; }
  function blocked(t) {
    if (terrain[t] === 1 || res[t] !== 0) return true;
    var b = occ[t];
    return b !== 0 && !S.E[b].walk;
  }

  // ---------- Karte ----------
  function genMap() {
    terrain = new Uint8Array(N); res = new Uint8Array(N); amt = new Int16Array(N); occ = new Int32Array(N);
    var HALF = MH / 2, x, y, i, k;
    function put(x, y, r, a) { if (inMap(x, y) && y < HALF && terrain[idx(x, y)] === 0) { res[idx(x, y)] = r; amt[idx(x, y)] = a; } }
    function blob(cx, cy, rad, r, a, dens) {
      for (y = cy - rad; y <= cy + rad; y++) for (x = cx - rad; x <= cx + rad; x++) {
        var d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d <= rad * rad && rnd(100) < dens) put(x, y, r, a);
      }
    }
    // Waldrand am Kartenrand
    for (x = 0; x < MW; x++) for (y = 0; y < HALF; y++) {
      var edge = Math.min(x, y, MW - 1 - x);
      if (edge === 0 && rnd(100) < 85) put(x, y, R_WOOD, 100);
      else if (edge === 1 && rnd(100) < 45) put(x, y, R_WOOD, 100);
    }
    // W\u00E4lder
    for (k = 0; k < 8; k++) {
      var fx = 2 + rnd(MW - 4), fy = 2 + rnd(HALF - 3);
      if (Math.abs(fx - 6) + Math.abs(fy - 6) < 9) continue;
      blob(fx, fy, 2 + rnd(2), R_WOOD, 100, 80);
    }
    // ein See
    var lx = 14 + rnd(12), ly = 13 + rnd(4);
    for (y = ly - 2; y <= ly + 2; y++) for (x = lx - 3; x <= lx + 3; x++) {
      if (inMap(x, y) && y < HALF && ((x - lx) * (x - lx) * 4 + (y - ly) * (y - ly) * 9) <= 40) { terrain[idx(x, y)] = 1; res[idx(x, y)] = 0; }
    }
    // feste Rohstoffe am eigenen Dorf (Dorfzentrum bei 5..7 / 5..7)
    for (i = 0; i < 6; i++) put(11 + (i % 3), 4 + ((i / 3) | 0), R_FOOD, 175);   // Beeren
    for (i = 0; i < 5; i++) put(3 + (i % 3), 11 + ((i / 3) | 0), R_GOLD, 300);   // Gold
    for (i = 0; i < 4; i++) put(11 + (i % 2), 11 + ((i / 2) | 0), R_STONE, 250); // Stein
    for (y = 13; y <= 15; y++) for (x = 6; x <= 9; x++) if (rnd(100) < 85) put(x, y, R_WOOD, 100);  // W\u00E4ldchen
    // weitere Rohstoffe in der Mitte
    blob(18 + rnd(5), 6 + rnd(4), 1, R_GOLD, 400, 90);
    blob(26 + rnd(6), 3 + rnd(4), 1, R_STONE, 300, 80);
    blob(4 + rnd(6), 17 + rnd(2), 1, R_FOOD, 175, 85);
    // Dorfplatz freir\u00E4umen
    for (y = 2; y <= 10; y++) for (x = 2; x <= 10; x++) if ((x - 6) * (x - 6) + (y - 6) * (y - 6) <= 17) { res[idx(x, y)] = 0; terrain[idx(x, y)] = 0; }
    // obere H\u00E4lfte punktsymmetrisch spiegeln (faire Karte)
    for (y = 0; y < HALF; y++) for (x = 0; x < MW; x++) {
      var a = idx(x, y), b = idx(MW - 1 - x, MH - 1 - y);
      terrain[b] = terrain[a]; res[b] = res[a]; amt[b] = amt[a];
    }
  }

  // ---------- Entit\u00E4ten ----------
  function newEnt(e) { e.id = S.nextId++; S.E[e.id] = e; S.list.push(e); return e; }

  function addBuilding(own, type, tx, ty, done) {
    var d = BUILDS[type];
    var b = newEnt({ kind: "b", own: own, type: type, tx: tx, ty: ty, size: d.size, walk: !!d.walk,
      hp: done ? d.hp : Math.max(1, (d.hp / 10) | 0), maxhp: d.hp, done: !!done, prog: 0,
      queue: [], qprog: 0, rally: -1, cool: 0, research: 0, food: d.food || 0, worker: 0 });
    for (var y = ty; y < ty + d.size; y++) for (var x = tx; x < tx + d.size; x++) occ[idx(x, y)] = b.id;
    if (!d.walk) displaceUnits(b);
    return b;
  }

  function addUnit(own, type, x, y) {
    var d = UNITS[type];
    return newEnt({ kind: "u", own: own, type: type, x: x, y: y, px: x, py: y, hp: d.hp, maxhp: d.hp,
      o: { k: "idle" }, path: null, pi: 0, cool: 0, carryR: 0, carryN: 0, timer: 0, repath: 0, lastTile: -1 });
  }

  function footprintFree(tx, ty, size) {
    for (var y = ty; y < ty + size; y++) for (var x = tx; x < tx + size; x++) {
      if (!inMap(x, y)) return false;
      var t = idx(x, y);
      if (terrain[t] === 1 || res[t] !== 0 || occ[t] !== 0) return false;
    }
    return true;
  }

  // n\u00E4chstes freies Feld (Ringe um das Rechteck, feste Reihenfolge)
  function freeTileNear(tx, ty, w, h, maxR) {
    for (var r = 0; r <= (maxR || 6); r++) {
      for (var y = ty - r; y < ty + h + r; y++) for (var x = tx - r; x < tx + w + r; x++) {
        if (r > 0 && y > ty - r && y < ty + h + r - 1 && x > tx - r && x < tx + w + r - 1) continue;
        if (inMap(x, y) && !blocked(idx(x, y))) return idx(x, y);
      }
    }
    return -1;
  }

  function displaceUnits(b) {
    for (var i = 0; i < S.list.length; i++) {
      var u = S.list[i];
      if (u.kind !== "u" || u.hp <= 0) continue;
      var t = idx((u.x / T) | 0, (u.y / T) | 0);
      if (occ[t] === b.id) {
        var f = freeTileNear(b.tx, b.ty, b.size, b.size, 4);
        if (f >= 0) { u.x = (f % MW) * T + 32; u.y = ((f / MW) | 0) * T + 32; u.px = u.x; u.py = u.y; u.path = null; }
      }
    }
  }

  function tileOf(u) { return idx((u.x / T) | 0, (u.y / T) | 0); }

  // ---------- Wegsuche (A*, deterministisch) ----------
  var gS = new Int32Array(N), came = new Int32Array(N), stamp = new Int32Array(N), closed = new Int32Array(N), curStamp = 0;
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function astar(start, isGoal, hx, hy) {
    if (isGoal(start)) return [];
    curStamp++;
    var heap = [], seq = 0, expanded = 0;
    function hcost(t) {
      var dx = Math.abs((t % MW) - hx), dy = Math.abs(((t / MW) | 0) - hy);
      return 10 * Math.max(dx, dy) + 4 * Math.min(dx, dy);
    }
    function less(a, b) { return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2]; }
    function push(n) {
      heap.push(n); var i = heap.length - 1;
      while (i > 0) { var p = (i - 1) >> 1; if (less(heap[i], heap[p])) { var tmp = heap[i]; heap[i] = heap[p]; heap[p] = tmp; i = p; } else break; }
    }
    function pop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; var i = 0;
        for (;;) {
          var l = 2 * i + 1, r = l + 1, m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          var tmp = heap[i]; heap[i] = heap[m]; heap[m] = tmp; i = m;
        }
      }
      return top;
    }
    stamp[start] = curStamp; gS[start] = 0; came[start] = -1;
    push([hcost(start), hcost(start), seq++, start]);
    while (heap.length && expanded < 2500) {
      var cur = pop()[3];
      if (closed[cur] === curStamp) continue;
      closed[cur] = curStamp; expanded++;
      if (isGoal(cur)) {
        var path = [];
        for (var c = cur; c !== start; c = came[c]) path.push(c);
        path.reverse();
        return path;
      }
      var cx = cur % MW, cy = (cur / MW) | 0;
      for (var d = 0; d < 8; d++) {
        var nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (!inMap(nx, ny)) continue;
        var nt = idx(nx, ny);
        if (blocked(nt) || closed[nt] === curStamp) continue;
        if (d >= 4 && (blocked(idx(cx + DIRS[d][0], cy)) || blocked(idx(cx, cy + DIRS[d][1])))) continue;
        var ng = gS[cur] + (d < 4 ? 10 : 14);
        if (stamp[nt] !== curStamp || ng < gS[nt]) {
          stamp[nt] = curStamp; gS[nt] = ng; came[nt] = cur;
          var hc = hcost(nt);
          push([ng + hc, hc, seq++, nt]);
        }
      }
    }
    return null;
  }

  function chebRect(t, rx, ry, w, h) {
    var x = t % MW, y = (t / MW) | 0;
    var dx = x < rx ? rx - x : x >= rx + w ? x - (rx + w - 1) : 0;
    var dy = y < ry ? ry - y : y >= ry + h ? y - (ry + h - 1) : 0;
    return Math.max(dx, dy);
  }

  function pathToTile(u, goal) {
    return astar(tileOf(u), function (t) { return t === goal; }, goal % MW, (goal / MW) | 0);
  }
  function pathAdjRect(u, rx, ry, w, h) {
    return astar(tileOf(u), function (t) { return chebRect(t, rx, ry, w, h) === 1; }, rx + (w >> 1), ry + (h >> 1));
  }
  function pathInRect(u, rx, ry, w, h) {
    return astar(tileOf(u), function (t) { return chebRect(t, rx, ry, w, h) === 0; }, rx + (w >> 1), ry + (h >> 1));
  }

  // l\u00E4uft entlang des Pfads, true = angekommen
  function moveAlong(u) {
    if (!u.path) return true;
    if (u.pi >= u.path.length) return true;
    var t = u.path[u.pi];
    if (blocked(t) && occ[t] === 0) { u.path = null; return false; }   // Weg verbaut -> neu suchen
    if (blocked(t)) { u.path = null; return false; }
    var tx = (t % MW) * T + 32, ty = ((t / MW) | 0) * T + 32;
    var dx = tx - u.x, dy = ty - u.y, sp = UNITS[u.type].spd;
    if (dx !== 0 && dy !== 0) sp = (sp * 181) >> 8 || 1;
    if (Math.abs(dx) <= sp && Math.abs(dy) <= sp) { u.x = tx; u.y = ty; u.pi++; return u.pi >= u.path.length; }
    u.x += dx > 0 ? Math.min(sp, dx) : -Math.min(sp, -dx);
    u.y += dy > 0 ? Math.min(sp, dy) : -Math.min(sp, -dy);
    return false;
  }

  function setPath(u, p) { u.path = p; u.pi = 0; return p !== null; }

  // ---------- Kampf ----------
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  function inRange(u, e, rngTiles) {
    var r = rngTiles ? rngTiles * T : 0;
    if (e.kind === "u") { var rr = r || 84; return dist2(u.x, u.y, e.x, e.y) <= rr * rr; }
    var x0 = e.tx * T, y0 = e.ty * T, x1 = x0 + e.size * T, y1 = y0 + e.size * T;
    var cx = u.x < x0 ? x0 : u.x > x1 ? x1 : u.x, cy = u.y < y0 ? y0 : u.y > y1 ? y1 : u.y;
    var rb = r || 48;
    return dist2(u.x, u.y, cx, cy) <= rb * rb;
  }

  function damage(attType, target) {
    var a = UNITS[attType] || BUILDS[attType];
    var dmg = a.atk;
    if (target.kind === "u") {
      if (a.vsCav && target.type === "cav") dmg += a.vsCav;
      if (a.vsArc && target.type === "arc") dmg += a.vsArc;
      dmg -= UNITS[target.type].arm;
    } else {
      if (a.bld) dmg += a.bld;
      if (a.rng) dmg = dmg >> 1;
    }
    return Math.max(1, dmg);
  }

  function hit(att, target, attType, fromX, fromY) {
    target.hp -= damage(attType, target);
    var tx = target.kind === "u" ? target.x : (target.tx * T + target.size * 32), ty = target.kind === "u" ? target.y : (target.ty * T + target.size * 32);
    if ((UNITS[attType] && UNITS[attType].rng) || BUILDS[attType]) S.ev.push({ k: "shot", x0: fromX, y0: fromY, x1: tx, y1: ty });
    S.ev.push({ k: "hit", own: target.own, x: tx, y: ty });
    if (target.kind === "u" && target.o.k === "idle" && target.type !== "vil" && att) target.o = { k: "atk", t: att.id };
  }

  function nearestEnemy(own, x, y, maxD, unitsOnly) {
    var best = null, bd = 0, m2 = maxD * maxD;
    for (var i = 0; i < S.list.length; i++) {
      var e = S.list[i];
      if (e.own === own || e.hp <= 0) continue;
      if (unitsOnly && e.kind !== "u") continue;
      var ex = e.kind === "u" ? e.x : e.tx * T + e.size * 32, ey = e.kind === "u" ? e.y : e.ty * T + e.size * 32;
      var d = dist2(x, y, ex, ey);
      if (e.kind === "b") d += 4 * T * T;              // Einheiten zuerst
      if (d <= m2 && (!best || d < bd)) { best = e; bd = d; }
    }
    return best;
  }

  // ---------- Rohstoffe ----------
  function findDrop(own, r, x, y) {
    var key = RES_KEY[r], best = null, bd = 0;
    for (var i = 0; i < S.list.length; i++) {
      var b = S.list[i];
      if (b.kind !== "b" || b.own !== own || !b.done || b.hp <= 0) continue;
      var d = BUILDS[b.type].drop;
      if (!d || d.indexOf(key) < 0) continue;
      var dd = dist2(x, y, b.tx * T + b.size * 32, b.ty * T + b.size * 32);
      if (!best || dd < bd) { best = b; bd = dd; }
    }
    return best;
  }

  function findRes(r, t, maxR) {
    var cx = t % MW, cy = (t / MW) | 0;
    for (var d = 0; d <= maxR; d++) {
      for (var y = cy - d; y <= cy + d; y++) for (var x = cx - d; x <= cx + d; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== d || !inMap(x, y)) continue;
        if (res[idx(x, y)] === r) return idx(x, y);
      }
    }
    return -1;
  }

  // ---------- Einheiten-Logik ----------
  function goIdle(u) { u.o = { k: "idle" }; u.path = null; }

  function unitStep(u) {
    var d = UNITS[u.type], o = u.o, e;
    u.px = u.x; u.py = u.y;
    if (u.cool > 0) u.cool--;

    switch (o.k) {
      case "idle":
        if (u.type !== "vil" && (S.t + u.id) % 10 === 0) {
          e = nearestEnemy(u.own, u.x, u.y, d.sight * T, false);
          if (e) u.o = { k: "atk", t: e.id, auto: 1 };
        }
        return;

      case "move":
        if (!u.path && !setPath(u, pathToTile(u, o.t))) { goIdle(u); return; }
        if (moveAlong(u) && u.path) goIdle(u);
        return;

      case "atk":
        e = S.E[o.t];
        if (!e || e.hp <= 0) {
          var back = o.back ? S.E[o.back] : null;          // nach dem Abwehren: zur\u00FCck zum Geb\u00E4ude
          if (back && back.hp > 0) { u.o = { k: "atk", t: back.id }; u.path = null; } else goIdle(u);
          return;
        }
        // Wer ein Geb\u00E4ude angreift, wehrt sich zuerst gegen nahe Gegner
        if (e.kind === "b" && u.type !== "vil" && (S.t + u.id) % 10 === 0) {
          var foe = nearestEnemy(u.own, u.x, u.y, Math.max(3, d.rng) * T, true);
          if (foe) { u.o = { k: "atk", t: foe.id, back: e.id }; u.path = null; return; }
        }
        if (o.auto && dist2(u.x, u.y, e.kind === "u" ? e.x : e.tx * T, e.kind === "u" ? e.y : e.ty * T) > (d.sight + 4) * (d.sight + 4) * T * T) { goIdle(u); return; }
        if (inRange(u, e, d.rng)) {
          u.path = null;
          if (u.cool === 0) { u.cool = d.cd; hit(u, e, u.type, u.x, u.y); }
          return;
        }
        if (!u.path || --u.repath <= 0) {
          u.repath = 12;
          var ok = e.kind === "u" ? setPath(u, astar(tileOf(u), function (t) { return Math.max(Math.abs((t % MW) - ((e.x / T) | 0)), Math.abs(((t / MW) | 0) - ((e.y / T) | 0))) <= 1; }, (e.x / T) | 0, (e.y / T) | 0))
                                  : setPath(u, pathAdjRect(u, e.tx, e.ty, e.size, e.size));
          if (!ok) { goIdle(u); return; }
        }
        moveAlong(u);
        return;

      case "gat": return gatherStep(u, o);
      case "farm": return farmStep(u, o);
      case "bld": return buildStep(u, o);
    }
  }

  function gatherStep(u, o) {
    if (u.carryN > 0 && u.carryR !== o.r) u.carryN = 0;
    if (o.ph === "go") {
      if (res[o.t] !== o.r) {
        var nt = findRes(o.r, o.t, 8);
        if (nt < 0) { if (u.carryN > 0) { o.ph = "ret"; u.path = null; } else goIdle(u); return; }
        o.t = nt; u.path = null;
      }
      var tx = o.t % MW, ty = (o.t / MW) | 0;
      if (chebRect(tileOf(u), tx, ty, 1, 1) === 1) { o.ph = "work"; u.path = null; u.timer = 0; return; }
      if (!u.path && !setPath(u, pathAdjRect(u, tx, ty, 1, 1))) { goIdle(u); return; }
      moveAlong(u);
      return;
    }
    if (o.ph === "work") {
      if (res[o.t] !== o.r) { o.ph = u.carryN >= CARRY ? "ret" : "go"; u.path = null; return; }
      u.lastTile = o.t;
      if (++u.timer >= GATHER_RATE[o.r]) {
        u.timer = 0; u.carryR = o.r; u.carryN++;
        if (--amt[o.t] <= 0) { res[o.t] = 0; amt[o.t] = 0; S.mapVer++; }
        if (u.carryN >= CARRY) { o.ph = "ret"; u.path = null; }
      }
      return;
    }
    // ph === "ret": zum Lager
    var b = o.d ? S.E[o.d] : null;
    if (!b || b.hp <= 0 || !b.done) { b = findDrop(u.own, o.r, u.x, u.y); o.d = b ? b.id : 0; u.path = null; }
    if (!b) { if ((S.t + u.id) % 20 === 0) o.d = 0; return; }        // kein Lager: warten
    if (chebRect(tileOf(u), b.tx, b.ty, b.size, b.size) <= 1) {
      S.p[u.own][RES_KEY[u.carryR]] += u.carryN; u.carryN = 0; u.path = null;
      if (o.once) { goIdle(u); return; }
      o.ph = "go";
      return;
    }
    if (!u.path && !setPath(u, pathAdjRect(u, b.tx, b.ty, b.size, b.size))) { goIdle(u); return; }
    moveAlong(u);
  }

  function farmStep(u, o) {
    var f = S.E[o.b];
    if (!f || f.hp <= 0 || !f.done) {
      if (u.carryN > 0) { u.o = { k: "gat", t: -1, r: R_FOOD, ph: "ret", once: true }; u.path = null; } else goIdle(u);
      return;
    }
    if (u.carryN > 0 && u.carryR !== R_FOOD) u.carryN = 0;
    if (o.ph === "ret") {
      var b = findDrop(u.own, R_FOOD, u.x, u.y);
      if (!b) return;
      if (chebRect(tileOf(u), b.tx, b.ty, b.size, b.size) <= 1) { S.p[u.own].f += u.carryN; u.carryN = 0; o.ph = "go"; u.path = null; return; }
      if (!u.path && !setPath(u, pathAdjRect(u, b.tx, b.ty, b.size, b.size))) { goIdle(u); return; }
      moveAlong(u); return;
    }
    if (f.worker !== u.id) {
      var w = S.E[f.worker];
      if (w && w.hp > 0 && w.o.k === "farm" && w.o.b === f.id) { goIdle(u); return; }   // Farm schon besetzt
      f.worker = u.id;
    }
    if (chebRect(tileOf(u), f.tx, f.ty, f.size, f.size) === 0) {
      u.path = null;
      if (++u.timer >= 16) {
        u.timer = 0; u.carryR = R_FOOD; u.carryN++;
        if (--f.food <= 0) f.hp = 0;                                       // Farm ersch\u00F6pft
        if (u.carryN >= CARRY) { o.ph = "ret"; u.path = null; }
      }
      return;
    }
    if (!u.path && !setPath(u, pathInRect(u, f.tx, f.ty, f.size, f.size))) { goIdle(u); return; }
    moveAlong(u);
  }

  function buildStep(u, o) {
    var b = S.E[o.b];
    if (!b || b.hp <= 0) { goIdle(u); return; }
    if (b.done) { afterBuild(u, b); return; }
    if (chebRect(tileOf(u), b.tx, b.ty, b.size, b.size) <= 1) {
      u.path = null;
      var d = BUILDS[b.type];
      b.prog++;
      b.hp = Math.min(b.maxhp, b.hp + Math.ceil(b.maxhp * 9 / 10 / d.time));
      if (b.prog >= d.time) {
        b.done = true; b.hp = Math.max(b.hp, (b.maxhp * 9 / 10) | 0);
        S.ev.push({ k: "done", own: b.own, type: b.type });
        afterBuild(u, b);
      }
      return;
    }
    if (!u.path && !setPath(u, pathAdjRect(u, b.tx, b.ty, b.size, b.size))) { goIdle(u); return; }
    moveAlong(u);
  }

  function afterBuild(u, b) {
    if (b.type === "frm") { u.o = { k: "farm", b: b.id, ph: "go" }; u.path = null; return; }
    var d = BUILDS[b.type].drop;
    if (d && b.type !== "tc") {
      var want = b.type === "mil" ? [R_FOOD] : [R_WOOD, R_GOLD, R_STONE];
      var c = idx(b.tx + 1, b.ty + 1);
      for (var i = 0; i < want.length; i++) {
        var t = findRes(want[i], c, 6);
        if (t >= 0) { u.o = { k: "gat", t: t, r: want[i], ph: "go" }; u.path = null; return; }
      }
    }
    goIdle(u);
  }

  // ---------- Geb\u00E4ude-Logik ----------
  function popOf(own) {
    var pop = 0, cap = 0;
    for (var i = 0; i < S.list.length; i++) {
      var e = S.list[i];
      if (e.own !== own || e.hp <= 0) continue;
      if (e.kind === "u") pop++;
      else if (e.done && BUILDS[e.type].pop) cap += BUILDS[e.type].pop;
    }
    return [pop, Math.min(cap, POP_MAX)];
  }

  function buildingStep(b) {
    if (!b.done) return;
    var d = BUILDS[b.type], P = S.p[b.own];
    if (b.cool > 0) b.cool--;
    // schie\u00DFen
    if (d.atk && b.cool === 0 && (S.t + b.id) % 5 === 0) {
      var cx = b.tx * T + b.size * 32, cy = b.ty * T + b.size * 32;
      var e = nearestEnemy(b.own, cx, cy, d.rng * T, true);
      if (e) { b.cool = d.cd; hit(null, e, b.type, cx, cy); }
    }
    // Zeitalter
    if (b.research > 0) {
      if (++b.research > AGE_TIME) { b.research = 0; P.age = 2; S.ev.push({ k: "age", own: b.own }); }
      return;
    }
    // ausbilden
    if (b.queue.length) {
      var pc = popOf(b.own);
      if (pc[0] >= pc[1]) { P.housed = 1; return; }
      P.housed = 0;
      if (++b.qprog >= UNITS[b.queue[0]].time) {
        var f = freeTileNear(b.tx, b.ty, b.size, b.size, 5);
        if (f < 0) return;
        var type = b.queue.shift(); b.qprog = 0;
        var u = addUnit(b.own, type, (f % MW) * T + 32, ((f / MW) | 0) * T + 32);
        S.ev.push({ k: "trained", own: b.own, type: type });
        if (b.rally >= 0) {
          if (type === "vil" && res[b.rally]) u.o = { k: "gat", t: b.rally, r: res[b.rally], ph: "go" };
          else u.o = { k: "move", t: freeTileNear(b.rally % MW, (b.rally / MW) | 0, 1, 1, 3) };
          if (u.o.k === "move" && u.o.t < 0) goIdle(u);
        }
      }
    }
  }

  // ---------- Befehle ----------
  function canPay(P, cost) { for (var k in cost) if (P[k] < cost[k]) return false; return true; }
  function pay(P, cost, sign) { for (var k in cost) P[k] -= cost[k] * (sign || 1); }

  function ownUnits(own, list) {
    var r = [];
    for (var i = 0; i < list.length; i++) {
      var u = S.E[parseInt(list[i], 36)];
      if (u && u.kind === "u" && u.own === own && u.hp > 0 && r.indexOf(u) < 0) r.push(u);
    }
    r.sort(function (a, b) { return a.id - b.id; });
    return r;
  }

  // verteilt eine Gruppe auf freie Felder um das Ziel
  function spreadTargets(n, t) {
    var out = [], cx = t % MW, cy = (t / MW) | 0;
    for (var d = 0; d <= 6 && out.length < n; d++) {
      for (var y = cy - d; y <= cy + d && out.length < n; y++) for (var x = cx - d; x <= cx + d && out.length < n; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== d || !inMap(x, y)) continue;
        if (!blocked(idx(x, y))) out.push(idx(x, y));
      }
    }
    return out;
  }

  function command(own, data) {
    var a = data.split(","), c = a[0], P = S.p[own], us, i, b, t;
    if (S.over) return;
    if (c === "m") {
      us = ownUnits(own, (a[3] || "").split("."));
      t = idx(+a[1] | 0, +a[2] | 0);
      if (!inMap(+a[1], +a[2])) return;
      var spots = spreadTargets(us.length, t);
      for (i = 0; i < us.length; i++) { us[i].o = { k: "move", t: spots[i] != null ? spots[i] : t }; us[i].path = null; }
    } else if (c === "g") {
      if (!inMap(+a[1], +a[2])) return;
      t = idx(+a[1], +a[2]);
      us = ownUnits(own, (a[3] || "").split("."));
      for (i = 0; i < us.length; i++) {
        if (us[i].type === "vil" && res[t]) us[i].o = { k: "gat", t: t, r: res[t], ph: "go" };
        else us[i].o = { k: "move", t: freeTileNear(t % MW, (t / MW) | 0, 1, 1, 3) };
        if (us[i].o.t < 0) goIdle(us[i]);
        us[i].path = null;
      }
    } else if (c === "a") {
      var e = S.E[parseInt(a[1], 36)];
      if (!e || e.hp <= 0) return;
      us = ownUnits(own, (a[2] || "").split("."));
      for (i = 0; i < us.length; i++) {
        var u = us[i];
        u.path = null;
        if (e.own !== own) { u.o = { k: "atk", t: e.id }; continue; }
        if (u.type === "vil" && e.kind === "b") {
          if (!e.done) { u.o = { k: "bld", b: e.id }; continue; }
          if (e.type === "frm") { u.o = { k: "farm", b: e.id, ph: "go" }; continue; }
          var dr = BUILDS[e.type].drop;
          if (u.carryN > 0 && dr && dr.indexOf(RES_KEY[u.carryR]) >= 0) {
            u.o = u.lastTile >= 0 && res[u.lastTile] === u.carryR ? { k: "gat", t: u.lastTile, r: u.carryR, ph: "ret", d: e.id }
                                                                    : { k: "gat", t: -1, r: u.carryR, ph: "ret", d: e.id, once: true };
            continue;
          }
        }
        if (e.kind === "b") { var ft = freeTileNear(e.tx, e.ty, e.size, e.size, 3); u.o = ft >= 0 ? { k: "move", t: ft } : { k: "idle" }; }
        else u.o = { k: "move", t: tileOf(e) };
      }
    } else if (c === "b") {
      var type = a[1], d = BUILDS[type], tx = +a[2] | 0, ty = +a[3] | 0;
      if (!d || !d.cost || (d.age || 1) > P.age || !canPay(P, d.cost) || !footprintFree(tx, ty, d.size)) { S.ev.push({ k: "fail", own: own }); return; }
      pay(P, d.cost);
      b = addBuilding(own, type, tx, ty, false);
      us = ownUnits(own, (a[4] || "").split("."));
      for (i = 0; i < us.length; i++) if (us[i].type === "vil") { us[i].o = { k: "bld", b: b.id }; us[i].path = null; }
    } else if (c === "t") {
      b = S.E[parseInt(a[1], 36)];
      var ut = UNITS[a[2]];
      if (!b || b.own !== own || b.kind !== "b" || !b.done || !ut || (BUILDS[b.type].trains || []).indexOf(a[2]) < 0) return;
      if ((ut.age || 1) > P.age || b.queue.length >= 5 || b.research || !canPay(P, ut.cost)) { S.ev.push({ k: "fail", own: own }); return; }
      pay(P, ut.cost); b.queue.push(a[2]);
    } else if (c === "c") {
      b = S.E[parseInt(a[1], 36)];
      if (!b || b.own !== own || !b.queue.length) return;
      pay(P, UNITS[b.queue.pop()].cost, -1);
      if (!b.queue.length) b.qprog = 0;
    } else if (c === "r") {
      b = S.E[parseInt(a[1], 36)];
      if (!b || b.own !== own || !inMap(+a[2], +a[3])) return;
      b.rally = idx(+a[2], +a[3]);
    } else if (c === "u") {
      b = S.E[parseInt(a[1], 36)];
      if (!b || b.own !== own || b.type !== "tc" || !b.done || P.age !== 1 || b.research || b.queue.length || !canPay(P, AGE_COST)) { S.ev.push({ k: "fail", own: own }); return; }
      pay(P, AGE_COST); b.research = 1;
    } else if (c === "k") {
      us = ownUnits(own, (a[1] || "").split("."));
      for (i = 0; i < us.length; i++) goIdle(us[i]);
    } else if (c === "s") {
      P.lost = 1; S.over = 1; S.winner = 1 - own; S.reason = "s";
    }
  }

  // ---------- Computer-Gegner (nur Einzelspieler) ----------
  var AI_LVL = {
    1: { vils: 11, army: 6, attackAt: 12000, every: 3000, age: false, rng: false, bonus: 0 },     // leicht
    2: { vils: 20, army: 10, attackAt: 7000, every: 2000, age: true, rng: true, bonus: 0 },       // normal
    3: { vils: 28, army: 10, attackAt: 5500, every: 1200, age: true, rng: true, bonus: 200 }      // schwer
  };

  function aiThink(o, lvl) {
    var L = AI_LVL[lvl] || AI_LVL[2], P = S.p[o], tc = S.E[P.tc];
    if (!tc) return;
    var cx = tc.tx + 1, cy = tc.ty + 1, i;
    var mine = S.list.filter(function (e) { return e.own === o && e.hp > 0; });
    var vils = mine.filter(function (e) { return e.kind === "u" && e.type === "vil"; });
    var army = mine.filter(function (e) { return e.kind === "u" && e.type !== "vil"; });
    var blds = mine.filter(function (e) { return e.kind === "b"; });
    var pc = popOf(o), unfinished = blds.filter(function (b) { return !b.done; }).length;
    function has(t) { return blds.some(function (b) { return b.type === t; }); }
    function count(t) { return blds.filter(function (b) { return b.type === t; }).length; }
    function ids(l) { return l.map(function (u) { return u.id.toString(36); }).join("."); }
    // Bauplatz suchen, zuerst auf der vom Gegner abgewandten Seite (f\u00FCr Rot gespiegelt)
    var flip = o === 1 ? -1 : 1;
    function spot(sz) {
      for (var r = 3; r < 14; r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        var x = cx + dx * flip - (flip < 0 ? sz - 1 : 0), y = cy + dy * flip - (flip < 0 ? sz - 1 : 0);
        if (footprintFree(x, y, sz) && footprintFree(x - 1, y - 1, sz + 2)) return [x, y];
      }
      return null;
    }
    function place(type, v) {
      var d = BUILDS[type];
      if (!canPay(P, d.cost) || (d.age || 1) > P.age) return false;
      var sp = spot(d.size);
      if (!sp) return false;
      command(o, "b," + type + "," + sp[0] + "," + sp[1] + "," + v.id.toString(36));
      return true;
    }

    // Verteidigung: Gegner in der N\u00E4he des Dorfes?
    var threat = nearestEnemy(o, cx * T + 32, cy * T + 32, 10 * T, true);
    if (threat) {
      var near = S.list.filter(function (e) { return e.kind === "u" && e.own !== o && e.hp > 0 && dist2(e.x, e.y, cx * T, cy * T) < 100 * T * T; }).length;
      // ernster Angriff (mehrere Gegner oder Dorfzentrum besch\u00E4digt): ganze Armee zur\u00FCckholen
      var defenders = near >= 3 || tc.hp < tc.maxhp * 0.8 ? army : army.filter(function (u) { return u.o.k !== "atk"; });
      if (defenders.length) command(o, "a," + threat.id.toString(36) + "," + ids(defenders));
    }

    // Dorfbewohner einteilen
    var counts = [0, 0, 0, 0, 0];
    vils.forEach(function (v) { if (v.o.k === "gat") counts[v.o.r]++; else if (v.o.k === "farm") counts[R_FOOD]++; });
    var placed = unfinished > 0;
    var idle = vils.filter(function (v) { return v.o.k === "idle"; });
    for (i = 0; i < idle.length; i++) {
      var v = idle[i];
      if (!placed && pc[0] >= pc[1] - 2 && pc[1] < POP_MAX && place("hou", v)) { placed = true; continue; }
      if (!placed && vils.length >= 6 && !has("lag") && place("lag", v)) { placed = true; continue; }
      if (!placed && vils.length >= 8 && !has("bar") && place("bar", v)) { placed = true; continue; }
      if (!placed && L.rng && vils.length >= 12 && has("bar") && !has("rng") && place("rng", v)) { placed = true; continue; }
      if (!placed && lvl >= 3 && P.age === 2 && !has("stb") && place("stb", v)) { placed = true; continue; }
      if (!placed && lvl >= 2 && P.age === 2 && count("tow") < 2 && P.s >= 125 && place("tow", v)) { placed = true; continue; }
      var ratio = [0, 0.35, 0.42, 0.15, 0.08], want = R_FOOD, worst = 1e9;
      for (var r = 1; r <= 4; r++) { var sc = counts[r] / Math.max(1, vils.length) - ratio[r]; if (sc < worst) { worst = sc; want = r; } }
      var t = findRes(want, idx(cx, cy), 14);
      if (want === R_FOOD && t < 0) {
        var farm = blds.filter(function (b) { return b.type === "frm" && b.done && !(S.E[b.worker] && S.E[b.worker].o.k === "farm" && S.E[b.worker].o.b === b.id); })[0];
        if (farm) { command(o, "a," + farm.id.toString(36) + "," + v.id.toString(36)); counts[R_FOOD]++; continue; }
        if (!placed && place("frm", v)) { placed = true; counts[R_FOOD]++; continue; }
        want = R_WOOD; t = findRes(R_WOOD, idx(cx, cy), 20);
      }
      if (t < 0) t = findRes(R_WOOD, idx(cx, cy), 30);
      if (t >= 0) { command(o, "g," + (t % MW) + "," + ((t / MW) | 0) + "," + v.id.toString(36)); counts[want]++; }
    }

    // Ausbilden und Zeitalter
    var saveForAge = L.age && P.age === 1 && vils.length >= 12;
    if (saveForAge && !tc.queue.length && !tc.research && canPay(P, AGE_COST)) command(o, "u," + tc.id.toString(36));
    else if (tc.done && !tc.queue.length && !tc.research && vils.length < L.vils && !(saveForAge && P.f < AGE_COST.f + 50)) command(o, "t," + tc.id.toString(36) + ",vil");
    var n = 0;
    blds.forEach(function (b) {
      if (!b.done || b.queue.length >= 2) return;
      if (b.type === "bar") command(o, "t," + b.id.toString(36) + "," + ((n++ % 2 === 0 && P.g >= 20) ? "swd" : "spr"));
      if (b.type === "rng") command(o, "t," + b.id.toString(36) + ",arc");
      if (b.type === "stb") command(o, "t," + b.id.toString(36) + ",cav");
    });

    // Angriff
    if (S.t >= L.attackAt && S.t % L.every < 20 && army.length >= L.army) {
      var target = S.E[S.p[1 - o].tc] || nearestEnemy(o, cx * T, cy * T, 99 * T, false);
      if (target) command(o, "a," + target.id.toString(36) + "," + ids(army));
    }
  }

  // ---------- ein Spielschritt ----------
  function step() {
    S.t++;
    S.ev = [];
    var i, e, list = S.list;
    for (i = 0; i < list.length; i++) { e = list[i]; if (e.kind === "b" && e.hp > 0) buildingStep(e); }
    for (i = 0; i < list.length; i++) { e = list[i]; if (e.kind === "u" && e.hp > 0) unitStep(e); }
    // Tote entfernen
    var removed = false;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e.hp > 0) continue;
      removed = true;
      S.ev.push({ k: "dead", own: e.own, kind: e.kind, type: e.type });
      if (e.kind === "b") {
        for (var y = e.ty; y < e.ty + e.size; y++) for (var x = e.tx; x < e.tx + e.size; x++) if (occ[idx(x, y)] === e.id) occ[idx(x, y)] = 0;
        if (e.type === "tc" && !S.over) { S.p[e.own].lost = 1; S.over = 1; S.winner = 1 - e.own; S.reason = "tc"; }
      }
      delete S.E[e.id];
    }
    if (removed) S.list = list.filter(function (x) { return x.hp > 0; });
    if (S.over) S.over++;
  }

  function newGame(seed) {
    S = { seed: (seed >>> 0) || 1, t: 0, nextId: 1, E: {}, list: [], ev: [], over: 0, winner: -1, mapVer: 0,
          p: [JSON.parse(JSON.stringify(START_RES)), JSON.parse(JSON.stringify(START_RES))] };
    S.p[0].age = S.p[1].age = 1;
    S.p[0].lost = S.p[1].lost = 0;
    genMap();
    var bases = [[5, 5], [MW - 8, MH - 8]];
    for (var o = 0; o < 2; o++) {
      var tc = addBuilding(o, "tc", bases[o][0], bases[o][1], true);
      S.p[o].tc = tc.id;
      for (var k = 0; k < 3; k++) {
        var x = o === 0 ? bases[o][0] + k : bases[o][0] + 2 - k, y = o === 0 ? bases[o][1] + 3 : bases[o][1] - 1;
        addUnit(o, "vil", x * T + 32, y * T + 32);
      }
    }
  }

  function hashState() {
    var h = 2166136261 >>> 0;
    function mix(v) { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; }
    mix(S.t); mix(S.seed); mix(S.nextId); mix(S.over);
    for (var o = 0; o < 2; o++) { var P = S.p[o]; mix(P.f); mix(P.w); mix(P.g); mix(P.s); mix(P.age); }
    for (var i = 0; i < S.list.length; i++) {
      var e = S.list[i];
      mix(e.id); mix(e.hp); mix(e.own);
      if (e.kind === "u") { mix(e.x); mix(e.y); mix(e.carryN); } else { mix(e.prog); mix(e.queue.length); mix(e.qprog); }
    }
    for (i = 0; i < N; i += 7) mix(amt[i]);
    return h >>> 0;
  }

  // ======================================================================
  // Anzeige und Bedienung
  // ======================================================================
  var ctx, root, cv, g, mini, mg, ui = {}, me = -1, raf = 0, lastTickAt = 0;
  var cam = { x: 0, y: 0, z: 1 };
  var sel = [], selB = 0, selEnemy = 0, mode = null;   // mode: {k:"place",type,tx,ty} | {k:"rally"}
  var explored, visible, terrainCanvas = null, effects = [], markers = [], endSent = false;
  var uiDirty = true, uiTimer = 0, alarmAt = 0, idleIdx = 0, keys = {}, overShown = false, resKey = "";
  var COLORS = [["#3b8cff", "#1d4f9e"], ["#ff5a5f", "#a3262b"]];
  var RES_COL = ["", "#2f6b2a", "#c2384b", "#e5c04a", "#9aa3ad"];

  var CSS = [
    ".kr-top{position:absolute;z-index:20;top:max(6px,env(safe-area-inset-top));left:56px;right:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;pointer-events:none}",
    "body.lefthand .kr-top{left:8px;right:56px}",
    ".kr-res{pointer-events:auto;background:rgba(15,20,25,.78);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:5px 9px;font:600 calc(13px*var(--ui)) system-ui;color:#e8edf2;white-space:nowrap}",
    ".kr-res.bad{color:#ff8a8d}",
    ".kr-btn{pointer-events:auto;background:rgba(15,20,25,.78);border:1px solid rgba(255,255,255,.15);border-radius:10px;color:#fff;padding:5px 10px;font:600 calc(13px*var(--ui)) system-ui}",
    ".kr-panel{position:absolute;z-index:20;bottom:max(6px,env(safe-area-inset-bottom));left:max(6px,env(safe-area-inset-left));display:flex;gap:8px;align-items:flex-end;max-width:calc(100% - 170px*var(--ui))}",
    "body.lefthand .kr-panel{left:auto;right:max(6px,env(safe-area-inset-right));flex-direction:row-reverse}",
    ".kr-info{background:rgba(15,20,25,.86);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:8px 10px;min-width:calc(150px*var(--ui));max-width:calc(220px*var(--ui));color:#e8edf2;font:calc(12px*var(--ui)) system-ui}",
    ".kr-info b{font-size:1.1em}.kr-info .sub{color:#9aa7b4}",
    ".kr-hp{height:5px;background:#3a1a1d;border-radius:3px;margin:4px 0;overflow:hidden}.kr-hp i{display:block;height:100%;background:#3ecf7a}",
    ".kr-q{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap}.kr-q span{position:relative;width:calc(26px*var(--ui));height:calc(26px*var(--ui));border-radius:6px;background:#232c36;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:auto}",
    ".kr-q span i{position:absolute;left:0;bottom:0;height:3px;background:#3b8cff}",
    ".kr-acts{display:grid;grid-template-columns:repeat(4,calc(54px*var(--ui)));gap:5px}",
    ".kr-act{position:relative;height:calc(54px*var(--ui));border-radius:12px;background:rgba(26,33,41,.9);border:1px solid rgba(255,255,255,.14);color:#fff;font:calc(20px*var(--ui)) system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;line-height:1.05}",
    ".kr-act small{font-size:calc(9px*var(--ui));color:#c5ceda;margin-top:2px;white-space:nowrap}",
    ".kr-act.off{opacity:.45}.kr-act.on{background:#3b8cff}",
    ".kr-mini{position:absolute;z-index:20;bottom:max(6px,env(safe-area-inset-bottom));right:max(6px,env(safe-area-inset-right));width:calc(150px*var(--ui));height:calc(150px*var(--ui));border-radius:10px;border:1px solid rgba(255,255,255,.2);background:#000;touch-action:none}",
    "body.lefthand .kr-mini{right:auto;left:max(6px,env(safe-area-inset-left))}",
    ".kr-banner{position:absolute;z-index:25;top:calc(48px*var(--ui) + env(safe-area-inset-top));left:50%;transform:translateX(-50%);background:rgba(15,20,25,.9);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:6px 8px 6px 12px;color:#fff;font:calc(13px*var(--ui)) system-ui;display:none;align-items:center;gap:8px;white-space:nowrap}",
    ".kr-banner button{border:0;border-radius:9px;padding:7px 12px;font:600 calc(14px*var(--ui)) system-ui;color:#fff;background:#3b8cff}.kr-banner button.x{background:#55606c}",
    ".kr-over{position:absolute;z-index:30;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);color:#fff;text-align:center;font:calc(16px*var(--ui)) system-ui}",
    ".kr-over h1{font-size:calc(42px*var(--ui));margin:0 0 6px}"
  ].join("\n");

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function costText(c) {
    var ic = { f: "\uD83C\uDF56", w: "\uD83E\uDEB5", g: "\uD83E\uDE99", s: "\uD83E\uDEA8" }, s = "";
    for (var k in c) s += c[k] + ic[k] + " ";
    return s.trim();
  }
  function missing(c) {
    var P = S.p[me], nm = { f: "Nahrung", w: "Holz", g: "Gold", s: "Stein" };
    for (var k in c) if (P[k] < c[k]) return nm[k];
    return "";
  }

  // ---------- Befehle senden (lange ID-Listen werden aufgeteilt) ----------
  function sendCmd(head, units) {
    if (me < 0) return;
    if (!units) { ctx.sendInput(head); return; }
    var ids = units.map(function (u) { return u.id.toString(36); });
    var cur = [];
    function flush() { if (cur.length) ctx.sendInput(head + "," + cur.join(".")); cur = []; }
    for (var i = 0; i < ids.length; i++) {
      if ((head + "," + cur.concat(ids[i]).join(".")).length > 62) flush();
      cur.push(ids[i]);
    }
    flush();
  }

  // ---------- Kamera / Koordinaten ----------
  function px() { return 28 * cam.z / T; }                          // Bildpunkte pro Welt-Einheit
  function toWorld(sx, sy) { var s = px(); return { x: cam.x + sx / s, y: cam.y + sy / s }; }
  function clampCam() {
    var s = px(), vw = cv.clientWidth / s, vh = cv.clientHeight / s;
    var pad = 2 * T;
    cam.x = Math.max(-pad, Math.min(MW * T - vw + pad, cam.x));
    cam.y = Math.max(-pad, Math.min(MH * T - vh + pad, cam.y));
  }
  function centerOn(x, y) { var s = px(); cam.x = x - cv.clientWidth / s / 2; cam.y = y - cv.clientHeight / s / 2; clampCam(); }
  function zoomAt(f, sx, sy) {
    var w = toWorld(sx, sy);
    cam.z = Math.max(0.55, Math.min(2.6, cam.z * f));
    var s = px(); cam.x = w.x - sx / s; cam.y = w.y - sy / s; clampCam();
  }

  // ---------- Sichtbarkeit (nur Anzeige) ----------
  function updateFog() {
    visible.fill(0);
    if (me < 0) { visible.fill(1); explored.fill(1); return; }
    for (var i = 0; i < S.list.length; i++) {
      var e = S.list[i];
      if (e.own !== me) continue;
      var r, cx, cy;
      if (e.kind === "u") { r = UNITS[e.type].sight; cx = (e.x / T) | 0; cy = (e.y / T) | 0; }
      else { r = BUILDS[e.type].sight + (e.size >> 1); cx = e.tx + (e.size >> 1); cy = e.ty + (e.size >> 1); }
      for (var y = cy - r; y <= cy + r; y++) for (var x = cx - r; x <= cx + r; x++) {
        if (inMap(x, y) && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + r) { visible[idx(x, y)] = 1; explored[idx(x, y)] = 1; }
      }
    }
  }
  function canSee(e) {
    if (me < 0 || e.own === me) return true;
    if (e.kind === "u") return visible[tileOf(e)] === 1;
    for (var y = e.ty; y < e.ty + e.size; y++) for (var x = e.tx; x < e.tx + e.size; x++) if (explored[idx(x, y)]) return true;
    return false;
  }

  // ---------- Boden vorzeichnen ----------
  function tileNoise(x, y) { var n = Math.imul(x * 374761393 + y * 668265263, 1274126177); return ((n ^ (n >>> 13)) >>> 0) % 1000; }
  function buildTerrain() {
    var P = 32, c = document.createElement("canvas");
    c.width = MW * P; c.height = MH * P;
    var q = c.getContext("2d");
    for (var y = 0; y < MH; y++) for (var x = 0; x < MW; x++) {
      var n = tileNoise(x, y), t = idx(x, y);
      if (terrain[t] === 1) {
        q.fillStyle = n < 500 ? "#2a6db0" : "#2b72b8"; q.fillRect(x * P, y * P, P, P);
      } else {
        q.fillStyle = n < 333 ? "#4f8a3a" : n < 666 ? "#548f3d" : "#4a8437"; q.fillRect(x * P, y * P, P, P);
        if (n % 7 === 0) { q.fillStyle = "rgba(255,255,255,.06)"; q.fillRect(x * P + (n % 20), y * P + (n % 23), 3, 3); }
        if (n % 11 === 0) { q.fillStyle = "rgba(0,0,0,.07)"; q.fillRect(x * P + (n % 17), y * P + (n % 13), 5, 4); }
      }
    }
    // Ufer
    q.strokeStyle = "rgba(230,220,160,.55)"; q.lineWidth = 3;
    for (y = 0; y < MH; y++) for (x = 0; x < MW; x++) {
      if (terrain[idx(x, y)] !== 1) continue;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = x + d[0], ny = y + d[1];
        if (inMap(nx, ny) && terrain[idx(nx, ny)] !== 1) {
          q.beginPath();
          if (d[0] === 1) { q.moveTo(x * P + P, y * P); q.lineTo(x * P + P, y * P + P); }
          if (d[0] === -1) { q.moveTo(x * P, y * P); q.lineTo(x * P, y * P + P); }
          if (d[1] === 1) { q.moveTo(x * P, y * P + P); q.lineTo(x * P + P, y * P + P); }
          if (d[1] === -1) { q.moveTo(x * P, y * P); q.lineTo(x * P + P, y * P); }
          q.stroke();
        }
      });
    }
    terrainCanvas = c;
  }

  // ---------- Zeichnen ----------
  function lerp(a, b, f) { return a + (b - a) * f; }

  function draw() {
    raf = requestAnimationFrame(draw);
    if (!S) return;
    var dpr = window.devicePixelRatio || 1, cw = cv.clientWidth, ch = cv.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); clampCam(); }
    scrollByKeys();
    updateFog();
    var s = px(), f = Math.min(1, (performance.now() - lastTickAt) / 50);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0a0d10"; g.fillRect(0, 0, cw, ch);
    g.save();
    g.scale(s, s); g.translate(-cam.x, -cam.y);
    g.imageSmoothingEnabled = true;
    g.drawImage(terrainCanvas, 0, 0, MW * T, MH * T);

    var x0 = Math.max(0, (cam.x / T) | 0), y0 = Math.max(0, (cam.y / T) | 0);
    var x1 = Math.min(MW - 1, ((cam.x + cw / s) / T) | 0), y1 = Math.min(MH - 1, ((cam.y + ch / s) / T) | 0);
    var x, y, t, i, e;

    // Farmen (unter allem)
    for (i = 0; i < S.list.length; i++) { e = S.list[i]; if (e.kind === "b" && e.type === "frm" && canSee(e)) drawBuilding(e); }
    // Rohstoffe
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
      t = idx(x, y);
      if (res[t] && explored[t]) drawRes(x, y, res[t], amt[t]);
    }
    // Geb\u00E4ude
    for (i = 0; i < S.list.length; i++) { e = S.list[i]; if (e.kind === "b" && e.type !== "frm" && canSee(e)) drawBuilding(e); }
    // Sammelpunkt
    var sb = S.E[selB];
    if (sb && sb.own === me && sb.rally >= 0) {
      var rx = (sb.rally % MW) * T + 32, ry = ((sb.rally / MW) | 0) * T + 32;
      g.strokeStyle = "rgba(255,255,255,.5)"; g.setLineDash([10, 10]); g.lineWidth = 3;
      g.beginPath(); g.moveTo(sb.tx * T + sb.size * 32, sb.ty * T + sb.size * 32); g.lineTo(rx, ry); g.stroke(); g.setLineDash([]);
      g.font = "40px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("\uD83D\uDEA9", rx + 6, ry - 14);
    }
    // Einheiten (nach y sortiert)
    var us = [];
    for (i = 0; i < S.list.length; i++) { e = S.list[i]; if (e.kind === "u" && canSee(e)) us.push(e); }
    us.sort(function (a, b) { return a.y - b.y || a.id - b.id; });
    for (i = 0; i < us.length; i++) drawUnit(us[i], f);
    // Effekte
    var now = performance.now();
    effects = effects.filter(function (fx) { return now - fx.t < 220; });
    g.strokeStyle = "#ffe9a8"; g.lineWidth = 3;
    effects.forEach(function (fx) {
      var k = (now - fx.t) / 220;
      g.beginPath(); g.moveTo(lerp(fx.x0, fx.x1, k), lerp(fx.y0, fx.y1, k)); g.lineTo(lerp(fx.x0, fx.x1, Math.min(1, k + 0.25)), lerp(fx.y0, fx.y1, Math.min(1, k + 0.25))); g.stroke();
    });
    markers = markers.filter(function (m) { return now - m.t < 500; });
    markers.forEach(function (m) {
      var k = (now - m.t) / 500;
      g.strokeStyle = m.c; g.lineWidth = 4; g.globalAlpha = 1 - k;
      g.beginPath(); g.arc(m.x, m.y, 10 + 22 * k, 0, 7); g.stroke(); g.globalAlpha = 1;
    });
    // Nebel
    if (me >= 0) {
      for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
        t = idx(x, y);
        if (!explored[t]) { g.fillStyle = "#07090b"; g.fillRect(x * T - 1, y * T - 1, T + 2, T + 2); }
        else if (!visible[t]) { g.fillStyle = "rgba(0,0,0,.42)"; g.fillRect(x * T, y * T, T, T); }
      }
    }
    // Bauplatz-Vorschau
    if (mode && mode.k === "place" && mode.tx != null) {
      var d = BUILDS[mode.type], ok = footprintFree(mode.tx, mode.ty, d.size) && explored[idx(mode.tx, mode.ty)];
      g.fillStyle = ok ? "rgba(62,207,122,.35)" : "rgba(255,90,95,.4)";
      g.fillRect(mode.tx * T, mode.ty * T, d.size * T, d.size * T);
      g.strokeStyle = ok ? "#3ecf7a" : "#ff5a5f"; g.lineWidth = 4; g.strokeRect(mode.tx * T, mode.ty * T, d.size * T, d.size * T);
      g.font = (d.size * 26) + "px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.globalAlpha = 0.8;
      g.fillText(d.icon, mode.tx * T + d.size * 32, mode.ty * T + d.size * 32); g.globalAlpha = 1;
    }
    g.restore();
    // Auswahlrahmen
    if (touch.box) {
      var b = touch.box;
      g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.fillStyle = "rgba(255,255,255,.08)";
      g.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      g.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
    if (S.t % 4 === 0 || uiDirty) drawMini();
    if (uiDirty || now - uiTimer > 250) { uiTimer = now; uiDirty = false; renderUI(); }
  }

  function drawRes(x, y, r, a) {
    var cx = x * T + 32, cy = y * T + 32, n = tileNoise(x, y);
    if (r === R_WOOD) {
      var rad = 24 + (n % 8);
      g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.ellipse(cx + 6, cy + 10, rad, rad * 0.6, 0, 0, 7); g.fill();
      g.fillStyle = "#5b3a1e"; g.fillRect(cx - 4, cy + 4, 8, 16);
      g.fillStyle = n % 3 === 0 ? "#1f5a24" : n % 3 === 1 ? "#24652a" : "#1c5220";
      g.beginPath(); g.arc(cx, cy - 4, rad, 0, 7); g.fill();
      g.fillStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.arc(cx - 7, cy - 12, rad * 0.45, 0, 7); g.fill();
    } else if (r === R_FOOD) {
      g.fillStyle = "#2d6b2f"; g.beginPath(); g.arc(cx, cy, 24, 0, 7); g.fill();
      g.fillStyle = "#d63a55";
      for (var k = 0; k < 6; k++) { g.beginPath(); g.arc(cx - 12 + ((n >> k) % 24), cy - 12 + ((n >> (k + 2)) % 24), 4.5, 0, 7); g.fill(); }
    } else {
      var col = r === R_GOLD ? ["#c9a227", "#f1d36b"] : ["#7f8790", "#b5bcc4"];
      g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.ellipse(cx + 4, cy + 12, 26, 12, 0, 0, 7); g.fill();
      g.fillStyle = col[0]; g.beginPath(); g.moveTo(cx - 24, cy + 14); g.lineTo(cx - 14, cy - 14); g.lineTo(cx + 6, cy - 20); g.lineTo(cx + 24, cy + 2); g.lineTo(cx + 18, cy + 16); g.closePath(); g.fill();
      g.fillStyle = col[1]; g.beginPath(); g.moveTo(cx - 12, cy - 10); g.lineTo(cx + 4, cy - 16); g.lineTo(cx + 2, cy); g.closePath(); g.fill();
    }
  }

  function drawBuilding(b) {
    var d = BUILDS[b.type], x = b.tx * T, y = b.ty * T, w = b.size * T, col = COLORS[b.own];
    if (b.type === "frm") {
      g.fillStyle = b.done ? "#8a6b34" : "#6d5a3a"; g.fillRect(x + 4, y + 4, w - 8, w - 8);
      g.strokeStyle = b.done ? "#b7d36a" : "#7a6a4a"; g.lineWidth = 5;
      for (var k = 1; k < 6; k++) { g.beginPath(); g.moveTo(x + 10, y + k * w / 6); g.lineTo(x + w - 10, y + k * w / 6); g.stroke(); }
      g.fillStyle = col[0]; g.fillRect(x + 4, y + 4, 10, 10);
    } else {
      g.fillStyle = "rgba(0,0,0,.3)"; g.fillRect(x + 10, y + 14, w - 6, w - 8);
      g.fillStyle = b.done ? "#c9b48a" : "rgba(201,180,138,.45)"; g.fillRect(x + 4, y + 4, w - 8, w - 8);
      g.fillStyle = b.done ? col[1] : "rgba(80,80,80,.5)";
      g.beginPath(); g.moveTo(x + 2, y + w * 0.45); g.lineTo(x + w / 2, y + 2); g.lineTo(x + w - 2, y + w * 0.45); g.closePath(); g.fill();
      g.fillStyle = col[0]; g.fillRect(x + w / 2 - 2, y - 18, 4, 22); g.fillRect(x + w / 2 + 2, y - 18, 16, 10);
      if (!b.done) {
        g.strokeStyle = "#7a5a32"; g.lineWidth = 4;
        g.strokeRect(x + 8, y + 8, w - 16, w - 16);
        g.beginPath(); g.moveTo(x + 8, y + 8); g.lineTo(x + w - 8, y + w - 8); g.moveTo(x + w - 8, y + 8); g.lineTo(x + 8, y + w - 8); g.stroke();
      }
      g.font = (b.size * 24) + "px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
      g.globalAlpha = b.done ? 1 : 0.6; g.fillText(d.icon, x + w / 2, y + w * 0.62); g.globalAlpha = 1;
    }
    if (b.id === selB || b.id === selEnemy) { g.strokeStyle = "#fff"; g.lineWidth = 4; g.strokeRect(x + 1, y + 1, w - 2, w - 2); }
    if (b.hp < b.maxhp || !b.done || b.id === selB) bar(x + 6, y + w - 4, w - 12, b.hp / b.maxhp, !b.done ? b.prog / d.time : -1);
    if (b.queue && b.queue.length && b.own === me) {
      g.fillStyle = "#3b8cff"; g.fillRect(x + 6, y + w + 4, (w - 12) * b.qprog / UNITS[b.queue[0]].time, 5);
    }
    if (b.research) { g.fillStyle = "#ffb340"; g.fillRect(x + 6, y + w + 4, (w - 12) * b.research / AGE_TIME, 5); }
  }

  function bar(x, y, w, f, prog) {
    g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(x, y, w, 7);
    g.fillStyle = f > 0.5 ? "#3ecf7a" : f > 0.25 ? "#ffb340" : "#ff5a5f"; g.fillRect(x, y, w * Math.max(0, f), 7);
    if (prog >= 0) { g.fillStyle = "#3b8cff"; g.fillRect(x, y + 8, w * prog, 5); }
  }

  function drawUnit(u, f) {
    // leichter Versatz pro Einheit, damit Gruppen auf einem Feld nicht deckungsgleich sind (nur Anzeige)
    var x = lerp(u.px, u.x, f) + ((u.id * 37) % 9 - 4) * 4, y = lerp(u.py, u.y, f) + ((u.id * 53) % 9 - 4) * 3, col = COLORS[u.own];
    var r = u.type === "cav" ? 22 : 17;
    var isSel = sel.indexOf(u.id) >= 0 || u.id === selEnemy;
    g.fillStyle = "rgba(0,0,0,.3)"; g.beginPath(); g.ellipse(x + 3, y + r * 0.8, r, r * 0.45, 0, 0, 7); g.fill();
    if (isSel) { g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.ellipse(x, y + r * 0.7, r + 6, (r + 6) * 0.5, 0, 0, 7); g.stroke(); }
    g.fillStyle = col[0]; g.strokeStyle = col[1]; g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
    g.font = (r * 1.25) + "px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(UNITS[u.type].icon, x, y + 1);
    if (u.carryN > 0) { g.fillStyle = RES_COL[u.carryR]; g.fillRect(x + r - 6, y - r - 2, 10, 10); }
    if (u.hp < u.maxhp || isSel) bar(x - 18, y - r - 12, 36, u.hp / u.maxhp, -1);
  }

  function drawMini() {
    var W = mini.width, H = mini.height, sx = W / MW, sy = H / MH, x, y, t;
    mg.fillStyle = "#000"; mg.fillRect(0, 0, W, H);
    for (y = 0; y < MH; y++) for (x = 0; x < MW; x++) {
      t = idx(x, y);
      if (!explored[t]) continue;
      mg.fillStyle = terrain[t] === 1 ? "#2a6db0" : res[t] ? RES_COL[res[t]] : "#4a7d38";
      mg.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
    }
    for (var i = 0; i < S.list.length; i++) {
      var e = S.list[i];
      if (!canSee(e)) continue;
      mg.fillStyle = COLORS[e.own][0];
      if (e.kind === "b") mg.fillRect(e.tx * sx, e.ty * sy, e.size * sx, e.size * sy);
      else mg.fillRect((e.x / T) * sx - 1.5, (e.y / T) * sy - 1.5, 3, 3);
    }
    var s = px();
    mg.strokeStyle = "#fff"; mg.lineWidth = 1.5;
    mg.strokeRect(cam.x / T * sx, cam.y / T * sy, cv.clientWidth / s / T * sx, cv.clientHeight / s / T * sy);
  }

  // ---------- Bedienoberfl\u00E4che ----------
  function selUnits() {
    var r = [];
    for (var i = 0; i < sel.length; i++) { var u = S.E[sel[i]]; if (u && u.hp > 0) r.push(u); }
    return r;
  }
  function setSel(ids, bid) {
    sel = ids; selB = bid || 0; selEnemy = 0;
    if (mode && mode.k !== "place") mode = null;
    uiDirty = true;
  }

  var actsKey = "";
  function renderUI() {
    if (!S) return;
    var P = me >= 0 ? S.p[me] : S.p[0];
    var pc = popOf(me >= 0 ? me : 0);
    var rk = [P.f, P.w, P.g, P.s, pc[0], pc[1], P.age, me >= 0 ? idleVillagers().length : 0].join(",");
    if (rk !== resKey) { resKey = rk; renderRes(P, pc); }
    renderSel(P);
  }

  function renderRes(P, pc) {
    ui.res.innerHTML = "";
    [["\uD83C\uDF56", P.f], ["\uD83E\uDEB5", P.w], ["\uD83E\uDE99", P.g], ["\uD83E\uDEA8", P.s]].forEach(function (r) { ui.res.appendChild(el("span", "kr-res", r[0] + " " + r[1])); });
    ui.res.appendChild(el("span", "kr-res" + (pc[0] >= pc[1] ? " bad" : ""), "\uD83D\uDC65 " + pc[0] + "/" + pc[1]));
    ui.res.appendChild(el("span", "kr-res", P.age === 2 ? "\uD83C\uDFEF Burgzeit" : "\uD83D\uDED6 Dorfzeit"));
    if (me >= 0) {
      var idle = idleVillagers().length;
      var ib = el("button", "kr-btn", "\uD83D\uDCA4 " + idle); ib.onclick = nextIdle; ui.res.appendChild(ib);
      var ab = el("button", "kr-btn", "\u2694\uFE0F Armee"); ab.onclick = selectArmy; ui.res.appendChild(ab);
      var hb = el("button", "kr-btn", "\uD83C\uDFF0"); hb.onclick = function () { var tc = S.E[S.p[me].tc]; if (tc) { setSel([], tc.id); centerOn(tc.tx * T + 96, tc.ty * T + 96); } }; ui.res.appendChild(hb);
    }
  }

  function renderSel(P) {

    // Info-Feld
    var us = selUnits(), b = S.E[selB], en = S.E[selEnemy], h = "";
    sel = us.map(function (u) { return u.id; });
    if (!b) selB = 0;
    if (us.length === 1 || (en && en.kind === "u")) {
      var u = us.length === 1 ? us[0] : en, d = UNITS[u.type];
      h = "<b>" + d.icon + " " + d.name + "</b>" + (u.own !== me ? " <span class='sub'>(Gegner)</span>" : "") +
        hpBar(u) + "<div class='sub'>Angriff " + d.atk + (d.rng ? " \u00B7 Reichweite " + d.rng : "") + " \u00B7 R\u00FCstung " + d.arm + "</div>" +
        (u.carryN ? "<div class='sub'>tr\u00E4gt " + u.carryN + " " + RES_NAMES[u.carryR] + "</div>" : "") +
        (u.own === me ? "<div class='sub'>" + orderText(u) + "</div>" : "");
    } else if (us.length > 1) {
      var cnt = {};
      us.forEach(function (u) { cnt[u.type] = (cnt[u.type] || 0) + 1; });
      h = "<b>" + us.length + " Einheiten</b><div class='sub'>" + Object.keys(cnt).map(function (k) { return UNITS[k].icon + " " + cnt[k]; }).join("  ") + "</div>";
    } else if (b || (en && en.kind === "b")) {
      var bb = b || en, bd = BUILDS[bb.type];
      h = "<b>" + bd.icon + " " + bd.name + "</b>" + (bb.own !== me ? " <span class='sub'>(Gegner)</span>" : "") + hpBar(bb);
      if (!bb.done) h += "<div class='sub'>Baustelle: " + Math.floor(100 * bb.prog / bd.time) + "%</div>";
      else if (bb.type === "frm") h += "<div class='sub'>Nahrung \u00FCbrig: " + bb.food + "</div>";
      if (bb.own === me && bb.research) h += "<div class='sub'>Aufstieg zur Burgzeit: " + Math.floor(100 * bb.research / AGE_TIME) + "%</div>";
      if (bb.own === me && P.housed && bb.queue.length) h += "<div class='sub' style='color:#ff8a8d'>Zu wenig Platz \u2013 baue H\u00E4user!</div>";
      if (bb.own === me && bb.queue.length) {
        h += "<div class='kr-q'>" + bb.queue.map(function (q, i) {
          return "<span data-c='1'>" + UNITS[q].icon + (i === 0 ? "<i style='width:" + Math.floor(100 * bb.qprog / UNITS[q].time) + "%'></i>" : "") + "</span>";
        }).join("") + "</div>";
      }
    } else {
      h = "<b>" + (me < 0 ? "Zuschauer" : "K\u00F6nigreiche") + "</b><div class='sub'>" + (me < 0 ? "Du siehst die ganze Karte." : "Tippe eine Einheit oder ein Geb\u00E4ude an.") + "</div>";
    }
    ui.info.innerHTML = h;
    var qs = ui.info.querySelectorAll("[data-c]");
    for (var qi = 0; qi < qs.length; qi++) qs[qi].onclick = function () { sendCmd("c," + selB.toString(36)); ctx.sound("click"); };

    // Aktionen
    var acts = actionList(us, b);
    var key = JSON.stringify(acts.map(function (a) { return [a.icon, a.label, a.off, a.on]; }));
    if (key !== actsKey) {
      actsKey = key; ui.acts.innerHTML = "";
      acts.forEach(function (a) {
        var bt = el("button", "kr-act" + (a.off ? " off" : "") + (a.on ? " on" : ""), a.icon + "<small>" + a.label + "</small>");
        bt.onclick = function (ev) { ev.stopPropagation(); ctx.sound("click"); a.fn(); uiDirty = true; };
        ui.acts.appendChild(bt);
      });
    }
    ui.acts.style.display = acts.length ? "grid" : "none";
  }

  function hpBar(e) { return "<div class='kr-hp'><i style='width:" + Math.max(0, Math.floor(100 * e.hp / e.maxhp)) + "%'></i></div><div class='sub'>" + Math.max(0, e.hp) + " / " + e.maxhp + " Leben</div>"; }

  function orderText(u) {
    var o = u.o;
    if (o.k === "idle") return "unt\u00E4tig";
    if (o.k === "move") return "l\u00E4uft";
    if (o.k === "atk") return "k\u00E4mpft";
    if (o.k === "bld") return "baut";
    if (o.k === "farm") return "bewirtschaftet Farm";
    if (o.k === "gat") return o.ph === "ret" ? "bringt " + RES_NAMES[o.r] + " zum Lager" : "sammelt " + RES_NAMES[o.r];
    return "";
  }

  var buildMenu = false;
  function actionList(us, b) {
    var list = [], P = me >= 0 ? S.p[me] : null;
    if (me < 0) return list;
    var vils = us.filter(function (u) { return u.type === "vil"; });
    if (us.length) {
      if (vils.length && buildMenu) {
        BUILD_ORDER.forEach(function (t) {
          var d = BUILDS[t], locked = (d.age || 1) > P.age;
          list.push({ icon: d.icon, label: locked ? "Burgzeit" : costText(d.cost), off: locked || !canPay(P, d.cost), fn: function () {
            if (locked) { ctx.toast(d.name + " gibt es erst in der Burgzeit"); return; }
            var m = missing(d.cost); if (m) { ctx.toast("Nicht genug " + m + " f\u00FCr " + d.name); ctx.sound("bad"); return; }
            startPlace(t);
          } });
        });
        list.push({ icon: "\u21A9\uFE0F", label: "zur\u00FCck", fn: function () { buildMenu = false; } });
        return list;
      }
      if (vils.length) list.push({ icon: "\uD83D\uDD28", label: "Bauen", fn: function () { buildMenu = true; } });
      list.push({ icon: "\u270B", label: "Stopp", fn: function () { sendCmd("k", us); } });
      list.push({ icon: "\u2716\uFE0F", label: "Abw\u00E4hlen", fn: function () { setSel([]); } });
      return list;
    }
    buildMenu = false;
    if (b && b.own === me && b.done) {
      var bd = BUILDS[b.type];
      (bd.trains || []).forEach(function (t) {
        var ud = UNITS[t], locked = (ud.age || 1) > P.age;
        list.push({ icon: ud.icon, label: locked ? "Burgzeit" : costText(ud.cost), off: locked || !canPay(P, ud.cost) || b.research, fn: function () {
          if (locked) { ctx.toast(ud.name + " gibt es erst in der Burgzeit"); return; }
          var m = missing(ud.cost); if (m) { ctx.toast("Nicht genug " + m + " f\u00FCr " + ud.name); ctx.sound("bad"); return; }
          sendCmd("t," + b.id.toString(36) + "," + t);
        } });
      });
      if (b.type === "tc" && P.age === 1) {
        list.push({ icon: "\uD83C\uDFEF", label: b.research ? "l\u00E4uft" : costText(AGE_COST), off: !!b.research || !canPay(P, AGE_COST), fn: function () {
          if (b.research) return;
          var m = missing(AGE_COST); if (m) { ctx.toast("Burgzeit: nicht genug " + m); ctx.sound("bad"); return; }
          if (b.queue.length) { ctx.toast("Erst die Ausbildung abwarten"); return; }
          sendCmd("u," + b.id.toString(36));
        } });
      }
      if (bd.trains) list.push({ icon: "\uD83D\uDEA9", label: "Sammelpunkt", on: mode && mode.k === "rally", fn: function () { mode = mode && mode.k === "rally" ? null : { k: "rally" }; showBanner(); } });
      list.push({ icon: "\u2716\uFE0F", label: "Abw\u00E4hlen", fn: function () { setSel([]); } });
    } else if (b || S.E[selEnemy]) {
      list.push({ icon: "\u2716\uFE0F", label: "Abw\u00E4hlen", fn: function () { setSel([]); } });
    }
    return list;
  }

  function idleVillagers() {
    return S.list.filter(function (e) { return e.kind === "u" && e.own === me && e.type === "vil" && e.o.k === "idle"; });
  }
  function nextIdle() {
    var l = idleVillagers();
    if (!l.length) { ctx.toast("Keine unt\u00E4tigen Dorfbewohner"); return; }
    var u = l[idleIdx++ % l.length];
    setSel([u.id]); centerOn(u.x, u.y);
  }
  function selectArmy() {
    var l = S.list.filter(function (e) { return e.kind === "u" && e.own === me && e.type !== "vil"; });
    if (!l.length) { ctx.toast("Du hast noch keine Soldaten"); return; }
    setSel(l.slice(0, 60).map(function (u) { return u.id; }));
  }

  // ---------- Bauen / Sammelpunkt ----------
  function startPlace(type) {
    var c = toWorld(cv.clientWidth / 2, cv.clientHeight / 2), sz = BUILDS[type].size;
    mode = { k: "place", type: type, tx: Math.max(0, Math.min(MW - sz, ((c.x / T) | 0) - (sz >> 1))), ty: Math.max(0, Math.min(MH - sz, ((c.y / T) | 0) - (sz >> 1))) };
    showBanner();
  }
  function confirmPlace() {
    if (!mode || mode.k !== "place") return;
    var d = BUILDS[mode.type];
    if (!footprintFree(mode.tx, mode.ty, d.size) || !explored[idx(mode.tx, mode.ty)]) { ctx.toast("Hier kann nicht gebaut werden"); ctx.sound("bad"); return; }
    var vils = selUnits().filter(function (u) { return u.type === "vil"; }).slice(0, 10);
    ctx.sendInput("b," + mode.type + "," + mode.tx + "," + mode.ty + "," + vils.map(function (u) { return u.id.toString(36); }).join("."));
    markers.push({ x: mode.tx * T + d.size * 32, y: mode.ty * T + d.size * 32, c: "#3ecf7a", t: performance.now() });
    ctx.sound("ok");
    mode = null; buildMenu = false; showBanner();
  }
  function showBanner() {
    var bn = ui.banner;
    if (!mode) { bn.style.display = "none"; return; }
    bn.style.display = "flex"; bn.innerHTML = "";
    if (mode.k === "place") {
      bn.appendChild(el("span", "", BUILDS[mode.type].icon + " Tippe auf die Karte zum Platzieren"));
      var ok = el("button", "", "\u2713 Bauen"); ok.onclick = confirmPlace; bn.appendChild(ok);
    } else {
      bn.appendChild(el("span", "", "\uD83D\uDEA9 Tippe auf die Karte f\u00FCr den Sammelpunkt"));
    }
    var x = el("button", "x", "\u2715"); x.onclick = function () { mode = null; showBanner(); }; bn.appendChild(x);
  }

  // ---------- Treffer-Test ----------
  function unitAt(w, radius) {
    var best = null, bd = 0;
    for (var i = 0; i < S.list.length; i++) {
      var e = S.list[i];
      if (e.kind !== "u" || !canSee(e)) continue;
      var d = dist2(w.x, w.y, e.x, e.y);
      if (d <= radius * radius && (!best || d < bd || (d === bd && e.own === me))) { best = e; bd = d; }
    }
    return best;
  }
  function buildingAt(w) {
    var tx = (w.x / T) | 0, ty = (w.y / T) | 0;
    if (!inMap(tx, ty)) return null;
    var b = S.E[occ[idx(tx, ty)]];
    return b && canSee(b) ? b : null;
  }

  // Tippen / Linksklick
  function tapAt(sx, sy, isMouse, dbl) {
    var w = toWorld(sx, sy), tx = (w.x / T) | 0, ty = (w.y / T) | 0;
    if (mode && mode.k === "place") {
      var sz = BUILDS[mode.type].size;
      mode.tx = Math.max(0, Math.min(MW - sz, tx - (sz >> 1))); mode.ty = Math.max(0, Math.min(MH - sz, ty - (sz >> 1)));
      if (isMouse) confirmPlace();
      return;
    }
    if (mode && mode.k === "rally") {
      if (inMap(tx, ty) && selB) { sendCmd("r," + selB.toString(36) + "," + tx + "," + ty); ctx.sound("ok"); markers.push({ x: tx * T + 32, y: ty * T + 32, c: "#fff", t: performance.now() }); }
      mode = null; showBanner(); return;
    }
    var rad = Math.max(30, 26 / px());
    var u = unitAt(w, rad), b = u ? null : buildingAt(w);
    var mine = selUnits();
    if (u && u.own === me) {
      if (dbl) {
        var ids = S.list.filter(function (e) { return e.kind === "u" && e.own === me && e.type === u.type && onScreen(e); }).map(function (e) { return e.id; });
        setSel(ids.slice(0, 60));
      } else setSel([u.id]);
      ctx.sound("click"); return;
    }
    if (b && b.own === me && !(mine.length && !isMouse && (!b.done || b.type === "frm" || BUILDS[b.type].drop) && mine.some(function (x) { return x.type === "vil"; }))) {
      setSel([], b.id); ctx.sound("click"); return;
    }
    if (!isMouse && mine.length) { commandAt(sx, sy); return; }
    if (u || b) { sel = []; selB = 0; selEnemy = (u || b).id; uiDirty = true; return; }
    setSel([]);
  }

  function onScreen(e) {
    var s = px();
    return e.x >= cam.x && e.y >= cam.y && e.x <= cam.x + cv.clientWidth / s && e.y <= cam.y + cv.clientHeight / s;
  }

  // Befehl an die Auswahl (Tippen mit Auswahl / Rechtsklick)
  function commandAt(sx, sy) {
    var w = toWorld(sx, sy), tx = (w.x / T) | 0, ty = (w.y / T) | 0;
    if (!inMap(tx, ty)) return;
    var mine = selUnits().filter(function (u) { return u.own === me; });
    if (!mine.length) {
      var sb = S.E[selB];
      if (sb && sb.own === me && BUILDS[sb.type].trains) { sendCmd("r," + selB.toString(36) + "," + tx + "," + ty); markers.push({ x: tx * T + 32, y: ty * T + 32, c: "#fff", t: performance.now() }); ctx.sound("ok"); }
      return;
    }
    var u = unitAt(w, Math.max(30, 26 / px())), b = u ? null : buildingAt(w), t = idx(tx, ty);
    var target = u || b;
    var mx = tx * T + 32, my = ty * T + 32;
    if (target && target.own !== me) {
      sendCmd("a," + target.id.toString(36), mine);
      markers.push({ x: target.kind === "u" ? target.x : mx, y: target.kind === "u" ? target.y : my, c: "#ff5a5f", t: performance.now() });
      ctx.sound("hit"); return;
    }
    var vils = mine.filter(function (x) { return x.type === "vil"; }), mil = mine.filter(function (x) { return x.type !== "vil"; });
    if (b && b.own === me) {
      if (vils.length) sendCmd("a," + b.id.toString(36), vils);
      if (mil.length) sendCmd("m," + tx + "," + ty, mil);
    } else if (res[t] && explored[t]) {
      if (vils.length) sendCmd("g," + tx + "," + ty, vils);
      if (mil.length) sendCmd("m," + tx + "," + ty, mil);
    } else {
      sendCmd("m," + tx + "," + ty, mine);
    }
    markers.push({ x: mx, y: my, c: "#3ecf7a", t: performance.now() });
    ctx.sound("ok");
  }

  function boxSelect(b) {
    var a = toWorld(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1)), c = toWorld(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    var ids = S.list.filter(function (e) { return e.kind === "u" && e.own === me && e.x >= a.x && e.x <= c.x && e.y >= a.y && e.y <= c.y; });
    var mil = ids.filter(function (e) { return e.type !== "vil"; });
    if (mil.length && mil.length < ids.length && b.preferArmy) ids = mil;
    if (ids.length) { setSel(ids.slice(0, 60).map(function (e) { return e.id; })); ctx.sound("click"); }
  }

  // ---------- Touch und Maus ----------
  var touch = { pts: {}, n: 0, mode: "", sx: 0, sy: 0, lx: 0, ly: 0, timer: 0, box: null, pinch: 0, lastTap: 0, lastTapX: 0, lastTapY: 0, moved: false };

  function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function onDown(e) {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    var p = pos(e);
    touch.pts[e.pointerId] = p; touch.n = Object.keys(touch.pts).length;
    if (e.pointerType === "mouse") {
      if (e.button === 2) { if (mode) { mode = null; showBanner(); } else commandAt(p.x, p.y); return; }
      if (e.button === 1) { touch.mode = "pan"; touch.lx = p.x; touch.ly = p.y; return; }
      touch.mode = "mouse"; touch.sx = p.x; touch.sy = p.y; touch.moved = false;
      return;
    }
    if (touch.n === 1) {
      touch.mode = "tap"; touch.sx = touch.lx = p.x; touch.sy = touch.ly = p.y; touch.moved = false;
      clearTimeout(touch.timer);
      touch.timer = setTimeout(function () {
        if (touch.mode === "tap" && !touch.moved && !(mode && mode.k === "place")) {
          touch.mode = "box"; touch.box = { x0: touch.sx, y0: touch.sy, x1: touch.sx, y1: touch.sy, preferArmy: true };
          if (navigator.vibrate) navigator.vibrate(20);
        }
      }, 350);
    } else if (touch.n === 2) {
      clearTimeout(touch.timer); touch.box = null;
      touch.mode = "pinch";
      var ps = Object.keys(touch.pts).map(function (k) { return touch.pts[k]; });
      touch.pinch = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      touch.lx = (ps[0].x + ps[1].x) / 2; touch.ly = (ps[0].y + ps[1].y) / 2;
    }
  }

  function onMove(e) {
    var p = pos(e);
    if (e.pointerType === "mouse") touch.mouse = p;
    if (!touch.pts[e.pointerId]) {
      if (e.pointerType === "mouse" && mode && mode.k === "place") {
        var w = toWorld(p.x, p.y), sz = BUILDS[mode.type].size;
        mode.tx = Math.max(0, Math.min(MW - sz, ((w.x / T) | 0) - (sz >> 1))); mode.ty = Math.max(0, Math.min(MH - sz, ((w.y / T) | 0) - (sz >> 1)));
      }
      return;
    }
    touch.pts[e.pointerId] = p;
    var s = px();
    if (touch.mode === "mouse") {
      if (Math.abs(p.x - touch.sx) + Math.abs(p.y - touch.sy) > 6) { touch.moved = true; touch.box = { x0: touch.sx, y0: touch.sy, x1: p.x, y1: p.y }; }
      if (mode && mode.k === "place") { var w2 = toWorld(p.x, p.y), sz2 = BUILDS[mode.type].size; mode.tx = Math.max(0, Math.min(MW - sz2, ((w2.x / T) | 0) - (sz2 >> 1))); mode.ty = Math.max(0, Math.min(MH - sz2, ((w2.y / T) | 0) - (sz2 >> 1))); touch.box = null; }
      return;
    }
    if (touch.mode === "pan") { cam.x -= (p.x - touch.lx) / s; cam.y -= (p.y - touch.ly) / s; touch.lx = p.x; touch.ly = p.y; clampCam(); return; }
    if (touch.mode === "tap") {
      if (Math.abs(p.x - touch.sx) + Math.abs(p.y - touch.sy) > 12) { touch.moved = true; touch.mode = "drag"; clearTimeout(touch.timer); }
      else return;
    }
    if (touch.mode === "drag") { cam.x -= (p.x - touch.lx) / s; cam.y -= (p.y - touch.ly) / s; touch.lx = p.x; touch.ly = p.y; clampCam(); return; }
    if (touch.mode === "box") { touch.box.x1 = p.x; touch.box.y1 = p.y; return; }
    if (touch.mode === "pinch" && touch.n === 2) {
      var ps = Object.keys(touch.pts).map(function (k) { return touch.pts[k]; });
      var d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), mx = (ps[0].x + ps[1].x) / 2, my = (ps[0].y + ps[1].y) / 2;
      cam.x -= (mx - touch.lx) / px(); cam.y -= (my - touch.ly) / px();
      if (touch.pinch > 0) zoomAt(d / touch.pinch, mx, my);
      touch.pinch = d; touch.lx = mx; touch.ly = my;
    }
  }

  function onUp(e) {
    var p = pos(e);
    delete touch.pts[e.pointerId]; touch.n = Object.keys(touch.pts).length;
    clearTimeout(touch.timer);
    if (touch.mode === "mouse" && e.pointerType === "mouse") {
      if (touch.box && touch.moved) boxSelect(touch.box);
      else if (!touch.moved) tapAt(p.x, p.y, true, isDouble(p));
      touch.box = null; touch.mode = ""; return;
    }
    if (touch.mode === "tap") tapAt(p.x, p.y, false, isDouble(p));
    else if (touch.mode === "box") boxSelect(touch.box);
    touch.box = null;
    if (touch.n === 0) touch.mode = "";
    else if (touch.mode === "pinch") touch.mode = "none";
  }

  function isDouble(p) {
    var now = performance.now(), d = now - touch.lastTap < 320 && Math.abs(p.x - touch.lastTapX) + Math.abs(p.y - touch.lastTapY) < 30;
    touch.lastTap = d ? 0 : now; touch.lastTapX = p.x; touch.lastTapY = p.y;
    return d;
  }

  function onWheel(e) { e.preventDefault(); var p = pos(e); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y); }

  function onKey(e) {
    if (e.target && e.target.tagName === "INPUT") return;
    keys[e.key.toLowerCase()] = e.type === "keydown";
    if (e.type !== "keydown") return;
    if (e.key === "Escape") { mode = null; buildMenu = false; showBanner(); setSel([]); }
    if (e.key === ".") nextIdle();
    if (e.key.toLowerCase() === "h" && me >= 0) { var tc = S.E[S.p[me].tc]; if (tc) { setSel([], tc.id); centerOn(tc.tx * T + 96, tc.ty * T + 96); } }
  }

  function scrollByKeys() {
    var sp = [0, 10, 18, 28][ctx.settings.cam || 2] / px() * 0.9, dx = 0, dy = 0;
    if (keys.a || keys.arrowleft) dx -= sp; if (keys.d || keys.arrowright) dx += sp;
    if (keys.w || keys.arrowup) dy -= sp; if (keys.s || keys.arrowdown) dy += sp;
    if (ctx.settings.edge && touch.mouse && !("ontouchstart" in window)) {
      var m = touch.mouse, E = 14;
      if (m.x < E) dx -= sp; if (m.x > cv.clientWidth - E) dx += sp;
      if (m.y < E) dy -= sp; if (m.y > cv.clientHeight - E) dy += sp;
    }
    if (dx || dy) { cam.x += dx; cam.y += dy; clampCam(); }
  }

  function miniTouch(e) {
    e.preventDefault();
    if (e.type === "pointerdown") mini.setPointerCapture(e.pointerId);
    if (e.type === "pointermove" && !e.buttons && e.pointerType === "mouse") return;
    var r = mini.getBoundingClientRect();
    centerOn((e.clientX - r.left) / r.width * MW * T, (e.clientY - r.top) / r.height * MH * T);
  }

  // ---------- Ereignisse aus der Simulation (nur f\u00FCr Anzeige/T\u00F6ne) ----------
  function handleEvents() {
    var now = performance.now();
    for (var i = 0; i < S.ev.length; i++) {
      var ev = S.ev[i];
      if (ev.k === "shot") { if (effects.length < 80) effects.push({ x0: ev.x0, y0: ev.y0, x1: ev.x1, y1: ev.y1, t: now }); }
      else if (ev.k === "hit" && ev.own === me && now - alarmAt > 12000) {
        alarmAt = now; ctx.sound("alarm"); ctx.toast("\u26A0\uFE0F Du wirst angegriffen!");
      } else if (ev.own === me) {
        if (ev.k === "done") { ctx.sound("done"); ctx.toast(BUILDS[ev.type].icon + " " + BUILDS[ev.type].name + " fertig"); }
        else if (ev.k === "trained") ctx.sound("done");
        else if (ev.k === "age") { ctx.sound("win"); ctx.toast("\uD83C\uDFEF Burgzeit erreicht! Reiter und T\u00FCrme sind freigeschaltet.", 4000); }
        else if (ev.k === "fail") { ctx.sound("bad"); ctx.toast("Befehl nicht m\u00F6glich (Platz oder Rohstoffe)"); }
        else if (ev.k === "dead" && ev.kind === "b") ctx.toast("\uD83D\uDCA5 " + BUILDS[ev.type].name + " zerst\u00F6rt");
      }
    }
    if (S.ev.length) uiDirty = true;
  }

  function showOver() {
    var win = me >= 0 ? S.winner === me : null;
    ui.over.style.display = "flex";
    ui.over.innerHTML = "<div><h1>" + (win === null ? (S.winner === 0 ? "Blau gewinnt" : "Rot gewinnt") : win ? "\uD83C\uDFC6 Sieg!" : "Niederlage") + "</h1>" +
      "<div>" + (S.reason === "s" ? (S.winner === 0 ? "Rot" : "Blau") + " hat aufgegeben." : "Das Dorfzentrum ist gefallen.") + "</div><div style='opacity:.7;margin-top:8px'>Neue Runde startet gleich ...</div></div>";
    ctx.sound(win ? "win" : "bad");
  }

  // ======================================================================
  // Schnittstelle
  // ======================================================================
  window.GAMES = window.GAMES || {};
  window.GAMES.A = {
    start: function (c) {
      ctx = c; root = c.root;
      me = c.role === "L" ? 0 : c.role === "R" ? 1 : -1;
      newGame(c.seed);
      if (c.solo) { var bonus = (AI_LVL[c.ai] || AI_LVL[2]).bonus; S.p[1].f += bonus; S.p[1].w += bonus; S.p[1].g += bonus; }
      explored = new Uint8Array(N); visible = new Uint8Array(N);
      buildTerrain();
      if (!document.getElementById("kr-css")) { var st = document.createElement("style"); st.id = "kr-css"; st.textContent = CSS; document.head.appendChild(st); }
      cv = el("canvas", "full"); root.appendChild(cv);
      cv.style.touchAction = "none";
      g = cv.getContext("2d");
      ui.top = el("div", "kr-top"); ui.res = el("div", ""); ui.res.style.cssText = "display:flex;gap:6px;flex-wrap:wrap"; ui.top.appendChild(ui.res); root.appendChild(ui.top);
      ui.panel = el("div", "kr-panel"); ui.info = el("div", "kr-info"); ui.acts = el("div", "kr-acts");
      ui.panel.appendChild(ui.info); ui.panel.appendChild(ui.acts); root.appendChild(ui.panel);
      mini = el("canvas", "kr-mini"); mini.width = 160; mini.height = 160; mg = mini.getContext("2d"); root.appendChild(mini);
      ui.banner = el("div", "kr-banner"); root.appendChild(ui.banner);
      ui.over = el("div", "kr-over"); root.appendChild(ui.over);
      cv.addEventListener("pointerdown", onDown);
      cv.addEventListener("pointermove", onMove);
      cv.addEventListener("pointerup", onUp);
      cv.addEventListener("pointercancel", onUp);
      cv.addEventListener("wheel", onWheel, { passive: false });
      cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
      mini.addEventListener("pointerdown", miniTouch); mini.addEventListener("pointermove", miniTouch);
      document.addEventListener("keydown", onKey); document.addEventListener("keyup", onKey);
      sel = []; selB = 0; selEnemy = 0; mode = null; buildMenu = false; actsKey = ""; effects = []; markers = []; endSent = false; keys = {}; overShown = false; resKey = "";
      cam.z = 1.1;
      lastTickAt = performance.now();
      draw();
      var home = me >= 0 ? S.E[S.p[me].tc] : S.E[S.p[0].tc];
      centerOn(home.tx * T + 96, home.ty * T + 96);
      ctx.toast(me < 0 ? "Du schaust zu" : "Du bist " + (me === 0 ? "Blau (oben links)" : "Rot (unten rechts)") +
        (c.solo ? " \u2013 der Computer spielt Rot (" + ["", "leicht", "normal", "schwer"][c.ai || 2] + ")." : " \u2013 sammle Rohstoffe und baue dein Dorf aus!"), 5000);
    },
    tick: function () {
      if (!S) return;
      if (ctx.solo && !S.over && S.t % 20 === 10) aiThink(1, ctx.ai || 2);
      step();
      lastTickAt = performance.now();
      handleEvents();
      if (S.over && !overShown) { overShown = true; showOver(); }
      if (S.over === 100 && !endSent && me >= 0) { endSent = true; ctx.end(); }
    },
    input: function (who, data) {
      if (!S) return;
      if (who === "L") command(0, data);
      else if (who === "R") command(1, data);
    },
    surrender: function () { sendCmd("s"); },
    stop: function () {
      cancelAnimationFrame(raf); raf = 0;
      document.removeEventListener("keydown", onKey); document.removeEventListener("keyup", onKey);
      S = null;
    },
    resize: function () { if (cv) clampCam(); },
    settingsChanged: function () { uiDirty = true; actsKey = ""; },
    hash: function () { return S ? hashState() : 0; },
    // nur f\u00FCr Tests
    _sim: { newGame: newGame, step: step, command: command, ai: aiThink, hash: function () { return hashState(); }, state: function () { return S; },
            map: function () { return { terrain: terrain, res: res, amt: amt, occ: occ, MW: MW, MH: MH, UNITS: UNITS, BUILDS: BUILDS }; } }
  };
})();
