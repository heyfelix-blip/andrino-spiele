// Arduino Spiele \u2013 Oberflaeche (Menue, Einstellungen, PingPong, Spiele-Lader)
// Wird von der Startseite des ShieldServers geladen (window.APP_BASE).
//
// Spiele, die nachgeladen werden, melden sich mit window.GAMES[<mode>] = {
//   start(ctx), tick(), input(who, data), stop(), hash()
// }. ctx enthaelt: root, role, seed, settings, sendInput(s), end(), toast(s), sound(k)
(function () {
  "use strict";

  var BASE = window.APP_BASE || "./";
  var VER = window.APP_VER || Date.now();
  var GAME_INFO = {
    P: { name: "PingPong", icon: "\uD83C\uDFD3", desc: "Klassiker zu zweit. Schl\u00E4ger mit dem Finger ziehen.", file: null },
    C: { name: "Run & Gun", icon: "\uD83D\uDD2B", desc: "Zusammen durchs Level laufen, springen und den Boss besiegen.", file: "rungun.js" },
    A: { name: "K\u00F6nigreiche", icon: "\uD83C\uDFF0", desc: "Dorf aufbauen, Rohstoffe sammeln, Armee ausbilden, Gegner besiegen.", file: "reiche.js" }
  };
  window.GAMES = window.GAMES || {};

  // ---------- Einstellungen ----------
  var DEFAULTS = { ui: 100, sound: true, left: false, cam: 2, edge: true, stats: false, ai: 2 };
  var settings = load();
  function load() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem("arduinoSpiele") || "{}") || {}; } catch (e) { s = {}; }
    for (var k in DEFAULTS) if (!(k in s)) s[k] = DEFAULTS[k];
    return s;
  }
  function save() {
    try { localStorage.setItem("arduinoSpiele", JSON.stringify(settings)); } catch (e) {}
    applySettings();
  }
  function applySettings() {
    document.documentElement.style.setProperty("--ui", settings.ui / 100);
    document.body.classList.toggle("lefthand", !!settings.left);
    $("stats").style.display = settings.stats ? "block" : "none";
    if (game && game.settingsChanged) game.settingsChanged(settings);
  }

  // ---------- Toene (kleine Synth-Klaenge, keine Dateien) ----------
  var actx = null;
  function sound(kind) {
    if (!settings.sound) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var SOUNDS = { click: [660, 0.05, "square"], ok: [880, 0.08, "triangle"], bad: [180, 0.15, "sawtooth"],
                     hit: [220, 0.06, "square"], alarm: [440, 0.25, "sawtooth"], done: [990, 0.12, "triangle"],
                     shot: [520, 0.03, "square"], win: [1046, 0.4, "triangle"] };
      var d = SOUNDS[kind] || SOUNDS.click;
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = d[2]; o.frequency.value = d[0];
      g.gain.setValueAtTime(0.08, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d[1]);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + d[1] + 0.02);
    } catch (e) {}
  }

  // ---------- Aufbau der Seite ----------
  var CSS = [
    ":root{--ui:1;--bg:#0f1419;--panel:#1a2129;--panel2:#232c36;--line:#2f3a46;--text:#e8edf2;--muted:#9aa7b4;--acc:#3b8cff;--ok:#3ecf7a;--warn:#ffb340;--bad:#ff5a5f}",
    "*{box-sizing:border-box}",
    "html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:calc(16px*var(--ui)) system-ui,-apple-system,Segoe UI,sans-serif;-webkit-tap-highlight-color:transparent;overscroll-behavior:none}",
    "button{font:inherit;color:inherit;cursor:pointer}",
    "#boot{display:none}",
    ".scr{position:fixed;inset:0;display:none;overflow:auto}",
    ".scr.on{display:block}",
    "#menu{padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 16px max(16px,env(safe-area-inset-left))}",
    ".wrap{max-width:980px;margin:0 auto}",
    ".top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}",
    ".logo{font-weight:800;font-size:1.4em;letter-spacing:.3px;margin-right:auto}",
    ".logo span{color:var(--acc)}",
    ".chip{display:inline-flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:.85em;color:var(--muted)}",
    ".dot{width:9px;height:9px;border-radius:50%;background:var(--bad)}",
    ".dot.ok{background:var(--ok)}.dot.wait{background:var(--warn)}",
    ".icon-btn{background:var(--panel);border:1px solid var(--line);border-radius:12px;width:44px;height:44px;font-size:1.15em}",
    ".status{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:14px;display:flex;align-items:center;gap:14px}",
    ".status .big{font-size:2.2em;font-weight:800;min-width:1.4em;text-align:center;color:var(--acc)}",
    ".status h2{margin:0 0 2px;font-size:1.1em}.status p{margin:0;color:var(--muted);font-size:.9em}",
    ".cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}",
    ".card{position:relative;text-align:left;background:var(--panel);border:2px solid var(--line);border-radius:16px;padding:16px;min-height:130px;transition:transform .1s,border-color .15s}",
    ".card:active{transform:scale(.98)}",
    ".card.sel{border-color:var(--acc);background:linear-gradient(180deg,#1d2a3a,var(--panel))}",
    ".card .ic{font-size:2em}.card h3{margin:6px 0 4px;font-size:1.1em}.card p{margin:0;color:var(--muted);font-size:.85em;line-height:1.35}",
    ".card .tag{position:absolute;top:12px;right:12px;font-size:.75em;background:var(--acc);color:#fff;border-radius:999px;padding:2px 8px;display:none}",
    ".card.sel .tag{display:block}",
    ".card[disabled]{opacity:.55}",
    ".hint{color:var(--muted);font-size:.85em;margin-top:14px;text-align:center}",
    "#game{background:#000;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}",
    "#gameRoot{position:absolute;inset:0}",
    "#gameRoot canvas.full{position:absolute;inset:0;width:100%;height:100%;display:block}",
    "#ingameBtn{position:absolute;z-index:30;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));width:40px;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(15,20,25,.7);color:#fff;font-size:1.1em}",
    "body.lefthand #ingameBtn{left:auto;right:max(8px,env(safe-area-inset-right))}",
    ".ov{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;background:rgba(5,8,12,.72);padding:16px}",
    ".ov.on{display:flex}",
    ".box{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;width:min(520px,100%);max-height:92vh;overflow:auto}",
    ".box h2{margin:0 0 12px;font-size:1.2em}",
    ".row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}",
    ".row:last-child{border-bottom:0}.row small{display:block;color:var(--muted);font-size:.8em}",
    ".btn{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:11px 16px}",
    ".btn.pri{background:var(--acc);border-color:var(--acc);color:#fff}.btn.danger{background:#3a1a1d;border-color:#6b2a2f;color:#ffb3b5}",
    ".btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.btns .btn{flex:1}",
    ".sw{position:relative;width:52px;height:30px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);flex:none}",
    ".sw::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:left .15s}",
    ".sw.on{background:var(--acc);border-color:var(--acc)}.sw.on::after{left:25px}",
    ".seg{display:flex;background:var(--panel2);border:1px solid var(--line);border-radius:10px;overflow:hidden;flex:none}",
    ".seg button{border:0;background:none;padding:7px 10px;font-size:.85em}.seg button.on{background:var(--acc);color:#fff}",
    "input[type=range]{width:140px;accent-color:var(--acc)}",
    ".tabs{display:flex;gap:6px;margin-bottom:10px}.tabs button{flex:1;border-radius:10px;border:1px solid var(--line);background:var(--panel2);padding:8px}.tabs button.on{background:var(--acc);border-color:var(--acc);color:#fff}",
    ".help h4{margin:12px 0 4px}.help p,.help li{color:var(--muted);font-size:.9em;line-height:1.45}.help ul{margin:4px 0;padding-left:18px}",
    "#cdOv{pointer-events:none;background:rgba(5,8,12,.35);align-items:flex-start;padding-top:8vh}",
    "#cdOv .num{font-size:min(22vw,150px);font-weight:900;color:#fff;text-shadow:0 6px 30px rgba(59,140,255,.6)}",
    "#cdOv .sub{position:absolute;bottom:18%;width:100%;text-align:center;color:#cfd8e3;font-size:1.1em}",
    "#rotOv .box{text-align:center}#rotOv .ph{font-size:3.5em;display:inline-block;animation:rot 1.6s ease-in-out infinite}",
    "@keyframes rot{0%,30%{transform:rotate(0)}60%,100%{transform:rotate(90deg)}}",
    "#toast{position:fixed;z-index:60;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);background:rgba(20,26,33,.95);border:1px solid var(--line);border-radius:12px;padding:9px 14px;font-size:.9em;display:none;max-width:90vw;text-align:center}",
    "#stats{position:fixed;z-index:40;right:6px;bottom:6px;font:11px monospace;color:#9f9;background:rgba(0,0,0,.5);padding:3px 6px;border-radius:6px;display:none;pointer-events:none}",
    "#kickBox{text-align:center}",
    ".lobby{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px;margin-bottom:6px}",
    ".lobby .status{background:none;border:0;padding:0 2px 12px;margin:0}",
    ".slots{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}",
    ".slot{display:flex;align-items:center;gap:10px;background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:10px 12px;min-height:60px}",
    ".slot .av{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;flex:none}",
    ".slot b{display:block}.slot small{color:var(--muted)}",
    ".slot.empty{border-style:dashed;opacity:.65}",
    ".slot .rd{margin-left:auto;font-size:.78em;padding:3px 9px;border-radius:999px;background:#3a2f1a;color:#ffcf85;white-space:nowrap}",
    ".slot .rd.ok{background:#173a28;color:#7ef0ae}",
    ".bigbtn{display:block;width:100%;margin-top:12px;padding:14px;font-size:1.1em;font-weight:700;border-radius:14px;border:0;background:var(--acc);color:#fff}",
    ".bigbtn.on{background:var(--ok)}.bigbtn[disabled]{opacity:.4}",
    ".sec{margin:20px 2px 10px;font-size:1.05em}.sec small{color:var(--muted);font-weight:400;font-size:.8em;margin-left:8px}",
    ".cards.solo .card{min-height:96px}",
    ".card .lvl{display:flex;gap:4px;margin-top:8px}.card .lvl span{font-size:.75em;padding:3px 8px;border-radius:8px;background:var(--panel2);border:1px solid var(--line)}.card .lvl span.on{background:var(--acc);border-color:var(--acc);color:#fff}",
    "body.ingame #toast{top:calc(58px + env(safe-area-inset-top))}"
  ].join("\n");

  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }

  var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  document.body.insertAdjacentHTML("beforeend", [
    '<div id="menu" class="scr on"><div class="wrap">',
    ' <div class="top"><div class="logo">Arduino <span>Spiele</span></div>',
    '  <span class="chip"><span class="dot" id="connDot"></span><span id="connTxt">Verbinde</span></span>',
    '  <span class="chip" id="roleChip">-</span>',
    '  <button class="icon-btn" id="fsBtn" title="Vollbild">\u26F6</button>',
    '  <button class="icon-btn" id="setBtn" title="Einstellungen">\u2699\uFE0F</button></div>',
    ' <h3 class="sec" style="margin-top:4px">Mehrspieler<small>\u00FCber den Arduino im Heim-WLAN</small></h3>',
    ' <div class="lobby"><div class="status"><div class="big" id="stBig">\u2026</div><div><h2 id="stTitle">Verbinde mit dem Server</h2><p id="stText">Einen Moment ...</p></div></div>',
    ' <div class="slots"><div class="slot" id="slotL"></div><div class="slot" id="slotR"></div></div>',
    ' <div class="cards" id="cards"></div>',
    ' <button class="bigbtn" id="readyBtn">Bereit</button>',
    ' <div class="hint" id="lbHint"></div></div>',
    ' <h3 class="sec">Einzelspieler<small>ohne Server \u2013 geht \u00FCberall</small></h3>',
    ' <div class="cards solo" id="soloCards"></div>',
    '</div></div>',
    '<div id="game" class="scr"><div id="gameRoot"></div><button id="ingameBtn" title="Men\u00FC">\u2630</button></div>',
    '<div id="cdOv" class="ov"><div class="num" id="cdNum">3</div><div class="sub" id="cdSub"></div></div>',
    '<div id="pauseOv" class="ov"><div class="box"><h2 id="pauseTitle">Men\u00FC</h2>',
    ' <div class="btns" style="flex-direction:column"><button class="btn pri" id="resumeBtn">Weiterspielen</button>',
    ' <button class="btn" id="pSetBtn">Einstellungen</button><button class="btn" id="pFsBtn">Vollbild + Querformat</button>',
    ' <button class="btn danger" id="surrBtn">Aufgeben</button><button class="btn danger" id="leaveBtn">Spiel verlassen</button></div></div></div>',
    '<div id="setOv" class="ov"><div class="box"><h2>Einstellungen</h2>',
    ' <div class="tabs"><button class="on" data-tab="s">Allgemein</button><button data-tab="h">Steuerung &amp; Hilfe</button></div>',
    ' <div id="tabS"></div><div id="tabH" class="help" style="display:none"></div>',
    ' <div class="btns"><button class="btn" id="resetBtn">Zur\u00FCcksetzen</button><button class="btn pri" id="setClose">Fertig</button></div></div></div>',
    '<div id="rotOv" class="ov"><div class="box"><div class="ph">\uD83D\uDCF1</div><h2>Bitte Handy quer halten</h2>',
    ' <p style="color:var(--muted)">Die Spiele sind f\u00FCrs Querformat gemacht.</p>',
    ' <div class="btns"><button class="btn pri" id="rotFs">Vollbild + Querformat</button><button class="btn" id="rotSkip">Trotzdem so spielen</button></div></div></div>',
    '<div id="kickOv" class="ov"><div class="box" id="kickBox"><div style="font-size:3em">\uD83D\uDCA4</div><h2 id="kickTitle">Vom Server getrennt</h2>',
    ' <p style="color:var(--muted)" id="kickText">Du warst 6 Minuten inaktiv.</p>',
    ' <div class="btns"><button class="btn pri" id="backBtn">Zur\u00FCck zum Server</button></div></div></div>',
    '<div id="toast"></div><div id="stats"></div>'
  ].join(""));
  if ($("boot")) $("boot").remove();

  // ---------- Menue ----------
  var conn = { ws: null, kicked: false, left: false, solo: false };
  // Auf GitHub Pages (https) gibt es keinen Arduino: dann nur Einzelspieler
  var noServer = location.protocol === "https:" || /github\.io$/.test(location.hostname);
  var ready = "00", soloRun = null;
  var role = "", mode = "P", phase = "", playersOnline = 0, game = null, gameMode = null;
  var tickNo = 0, hashes = {}, rotSkipped = false;
  var RN = { L: "Spieler 1", R: "Spieler 2", Z: "Zuschauer" };

  function canChoose() { return !noServer && (role === "L" || role === "R") && phase === "l" && playersOnline >= 2; }

  function renderCards() {
    var c = $("cards"); c.innerHTML = "";
    var both = playersOnline >= 2 && !noServer;
    c.style.display = both ? "" : "none";
    ["P", "C", "A"].forEach(function (m) {
      var gi = GAME_INFO[m];
      var b = h("button", { "class": "card" + (mode === m ? " sel" : "") },
        '<span class="tag">gew\u00E4hlt</span><div class="ic">' + gi.icon + '</div><h3>' + gi.name + '</h3><p>' + gi.desc + '</p>');
      if (!canChoose()) b.setAttribute("disabled", "");
      b.onclick = function () {
        if (!canChoose() || mode === m) return;
        sound("click"); send("g|" + m);
        if (GAME_INFO[m].file) loadGame(m, function () {});
      };
      c.appendChild(b);
    });
    renderLobby();
    renderSolo();
  }

  function slotHtml(who, filled, isMe, rd) {
    var col = who === "L" ? "#3b8cff" : "#ff5a5f";
    if (!filled) return '<div class="av" style="background:#2a333d">?</div><div><b>' + RN[who] + '</b><small>warte auf Mitspieler \u2026</small></div>';
    return '<div class="av" style="background:' + col + '">' + (who === "L" ? "1" : "2") + '</div><div><b>' + RN[who] + (isMe ? " (du)" : "") + '</b><small>' +
      (who === "L" ? "Blau / links" : "Rot / rechts") + '</small></div><span class="rd' + (rd ? " ok" : "") + '">' + (rd ? "\u2713 bereit" : "w\u00E4hlt \u2026") + '</span>';
  }

  function renderLobby() {
    var both = playersOnline >= 2;
    var sl = $("slotL"), sr = $("slotR");
    sl.className = "slot" + (playersOnline >= 1 ? "" : " empty");
    sr.className = "slot" + (both ? "" : " empty");
    sl.innerHTML = slotHtml("L", playersOnline >= 1 && !noServer, role === "L", ready[0] === "1");
    sr.innerHTML = slotHtml("R", both && !noServer, role === "R", ready[1] === "1");
    $("slotL").parentNode.style.display = noServer ? "none" : "";
    var rb = $("readyBtn"), mine = role === "L" ? ready[0] : role === "R" ? ready[1] : "0";
    rb.style.display = noServer || role === "Z" || !role ? "none" : "";
    rb.disabled = !canChoose();
    rb.className = "bigbtn" + (mine === "1" ? " on" : "");
    rb.textContent = mine === "1" ? "\u2713 Bereit \u2013 warte auf Mitspieler" : "Bereit f\u00FCr " + GAME_INFO[mode].name;
    var hint = "";
    if (noServer) hint = "Mehrspieler geht nur im Heim-WLAN: dort die Seite des Arduino \u00F6ffnen (z. B. http://192.168.1.47).";
    else if (phase === "l" && !both) hint = "\u00D6ffne die Seite auf einem zweiten Ger\u00E4t. Sobald dein Mitspieler da ist, w\u00E4hlt ihr hier das Spiel.";
    else if (phase === "l") hint = role === "Z" ? "Zwei Spieler sind schon da \u2013 du schaust zu." : "W\u00E4hlt gemeinsam ein Spiel und tippt beide auf \u201EBereit\u201C.";
    $("lbHint").textContent = hint;
    if (phase === "l" && !noServer) {
      if (!both) setStatus(playersOnline + "/2", "Warte auf zweiten Spieler", "Lobby \u2013 noch " + (2 - playersOnline) + " Platz frei.");
      else if (ready === "11") setStatus("\u2713", "Beide bereit", "Gleich geht's los ...");
      else setStatus("2/2", "Beide da \u2013 Spiel w\u00E4hlen", GAME_INFO[mode].icon + " " + GAME_INFO[mode].name + " ist gew\u00E4hlt.");
    }
  }

  // ---------- Einzelspieler ----------
  var SOLO = [
    { m: "P", icon: "\uD83C\uDFD3", name: "PingPong", desc: "Gegen den Computer.", lvl: true },
    { m: "C", icon: "\uD83D\uDD2B", name: "Run & Gun", desc: "Allein durchs Level bis zum Boss." },
    { m: "A", icon: "\uD83C\uDFF0", name: "K\u00F6nigreiche", desc: "Gegen einen Computer-Gegner.", lvl: true }
  ];
  var LVL = [[1, "leicht"], [2, "normal"], [3, "schwer"]];
  function renderSolo() {
    var c = $("soloCards"); c.innerHTML = "";
    SOLO.forEach(function (g0) {
      var b = h("button", { "class": "card" }, '<div class="ic">' + g0.icon + '</div><h3>' + g0.name + '</h3><p>' + g0.desc + '</p>' +
        (g0.lvl ? '<div class="lvl">' + LVL.map(function (l) { return '<span data-l="' + l[0] + '" class="' + (settings.ai === l[0] ? "on" : "") + '">' + l[1] + '</span>'; }).join("") + '</div>' : ""));
      if (phase === "g" || phase === "p" || phase === "c") b.setAttribute("disabled", "");
      b.onclick = function (e) {
        var l = e.target.getAttribute && e.target.getAttribute("data-l");
        if (l) { settings.ai = +l; save(); sound("click"); renderSolo(); return; }
        if (phase === "g" || phase === "p" || phase === "c") return;
        startSolo(g0.m);
      };
      c.appendChild(b);
    });
  }
  $("readyBtn").onclick = function () {
    if (!canChoose()) return;
    var mine = role === "L" ? ready[0] : ready[1];
    sound(mine === "1" ? "click" : "ok");
    send("y|" + (mine === "1" ? "0" : "1"));
  };

  function setStatus(big, title, text) {
    $("stBig").textContent = big; $("stTitle").textContent = title; $("stText").textContent = text;
  }

  function setConn(state, txt) {
    $("connDot").className = "dot" + (state === "ok" ? " ok" : state === "wait" ? " wait" : "");
    $("connTxt").textContent = txt;
  }

  function showScreen(name) {
    $("menu").classList.toggle("on", name === "menu");
    $("game").classList.toggle("on", name === "game");
    document.body.classList.toggle("ingame", name === "game");
    checkRotation();
  }

  var toastT = 0;
  function toast(t, ms) {
    var e = $("toast"); e.textContent = t; e.style.display = "block";
    clearTimeout(toastT); toastT = setTimeout(function () { e.style.display = "none"; }, ms || 2500);
  }

  // ---------- Querformat / Vollbild ----------
  function isTouch() { return "ontouchstart" in window || navigator.maxTouchPoints > 0; }
  function checkRotation() {
    var portrait = window.innerHeight > window.innerWidth;
    var show = $("game").classList.contains("on") && portrait && isTouch() && !rotSkipped;
    $("rotOv").classList.toggle("on", show);
  }
  window.addEventListener("resize", function () { checkRotation(); if (game && game.resize) game.resize(); });
  function goFullscreen() {
    var el = document.documentElement;
    var p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : null;
    var lock = function () { try { screen.orientation.lock("landscape").catch(function () {}); } catch (e) {} };
    if (p && p.then) p.then(lock).catch(function () {}); else lock();
  }
  $("fsBtn").onclick = function () { sound("click"); goFullscreen(); };
  $("rotFs").onclick = function () { goFullscreen(); rotSkipped = true; checkRotation(); };
  $("rotSkip").onclick = function () { rotSkipped = true; checkRotation(); };
  $("pFsBtn").onclick = function () { goFullscreen(); };

  // ---------- Einstellungen-Dialog ----------
  function sw(key, title, sub) {
    var r = h("div", { "class": "row" }, "<div>" + title + (sub ? "<small>" + sub + "</small>" : "") + "</div>");
    var b = h("button", { "class": "sw" + (settings[key] ? " on" : "") });
    b.onclick = function () { settings[key] = !settings[key]; b.classList.toggle("on", settings[key]); save(); sound("click"); };
    r.appendChild(b); return r;
  }
  function seg(key, title, sub, opts) {
    var r = h("div", { "class": "row" }, "<div>" + title + (sub ? "<small>" + sub + "</small>" : "") + "</div>");
    var s = h("div", { "class": "seg" });
    opts.forEach(function (o) {
      var b = h("button", { "class": settings[key] === o[0] ? "on" : "" }, o[1]);
      b.onclick = function () { settings[key] = o[0]; save(); sound("click"); buildSettings(); };
      s.appendChild(b);
    });
    r.appendChild(s); return r;
  }
  function buildSettings() {
    var t = $("tabS"); t.innerHTML = "";
    var r = h("div", { "class": "row" }, "<div>Oberfl\u00E4chengr\u00F6\u00DFe<small>Kn\u00F6pfe und Schrift</small></div>");
    var rg = h("input", { type: "range", min: 80, max: 140, step: 5, value: settings.ui });
    rg.oninput = function () { settings.ui = +rg.value; save(); };
    r.appendChild(rg); t.appendChild(r);
    t.appendChild(sw("sound", "T\u00F6ne", "Klicks, Treffer, Alarm"));
    t.appendChild(sw("left", "Linksh\u00E4nder", "Steuerkn\u00F6pfe und Men\u00FC auf die andere Seite"));
    t.appendChild(seg("cam", "Kamera-Tempo", "K\u00F6nigreiche", [[1, "langsam"], [2, "normal"], [3, "schnell"]]));
    t.appendChild(seg("ai", "Computer-Gegner", "Einzelspieler", LVL));
    t.appendChild(sw("edge", "Kantenscrollen", "Am PC: Maus an den Rand bewegt die Karte"));
    t.appendChild(sw("stats", "Leistungsanzeige", "Bilder und Takte pro Sekunde"));
    $("tabH").innerHTML = HELP;
  }
  var HELP = [
    "<h4>\uD83C\uDFD3 PingPong</h4><ul><li>Handy: Finger auf dem Spielfeld hoch und runter ziehen.</li><li>PC: Maus ziehen oder Pfeiltasten / W, S.</li><li>Wer zuerst 5 Punkte hat, gewinnt.</li></ul>",
    "<h4>\uD83D\uDD2B Run & Gun</h4><ul><li>Handy: Kn\u00F6pfe unten links laufen und zielen, rechts springen und schie\u00DFen.</li><li>PC: Pfeile oder WASD, Leertaste springt, X schie\u00DFt.</li><li>Nach oben zielen: \u25B2 halten. Jeder hat 5 Leben.</li></ul>",
    "<h4>\uD83C\uDFF0 K\u00F6nigreiche</h4><ul><li><b>Karte bewegen:</b> mit einem Finger ziehen, zwei Finger zum Zoomen.</li>",
    "<li><b>Ausw\u00E4hlen:</b> Einheit oder Geb\u00E4ude antippen. <b>Mehrere:</b> Finger kurz halten und dann ziehen (Rahmen), oder Doppeltipp = alle gleichen Einheiten im Bild.</li>",
    "<li><b>Befehl:</b> mit Auswahl auf Boden (laufen), Rohstoff (sammeln), Baustelle (bauen) oder Gegner (angreifen) tippen.</li>",
    "<li><b>Bauen:</b> Dorfbewohner w\u00E4hlen, \u201EBauen\u201C, Geb\u00E4ude w\u00E4hlen, auf die Karte tippen, mit \u2713 best\u00E4tigen.</li>",
    "<li><b>Unt\u00E4tige Dorfbewohner:</b> Knopf \uD83D\uDCA4 oben springt zum n\u00E4chsten.</li>",
    "<li>PC: Linksklick w\u00E4hlt aus / Rahmen ziehen, Rechtsklick gibt Befehle, Mausrad zoomt, WASD bewegt die Karte.</li>",
    "<li><b>Ziel:</b> Zerst\u00F6re das gegnerische Dorfzentrum.</li></ul>",
    "<h4>Allgemein</h4><ul><li>Nach 6 Minuten ohne Eingabe wirft der Server dich raus. Mit \u201EZur\u00FCck zum Server\u201C bist du wieder drin.</li><li>Ein dritter Spieler schaut zu.</li></ul>"
  ].join("");
  document.querySelectorAll("#setOv .tabs button").forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll("#setOv .tabs button").forEach(function (x) { x.classList.toggle("on", x === b); });
      $("tabS").style.display = b.dataset.tab === "s" ? "block" : "none";
      $("tabH").style.display = b.dataset.tab === "h" ? "block" : "none";
    };
  });
  function openSettings() { buildSettings(); $("setOv").classList.add("on"); }
  $("setBtn").onclick = function () { sound("click"); openSettings(); };
  $("pSetBtn").onclick = function () { $("pauseOv").classList.remove("on"); openSettings(); };
  $("setClose").onclick = function () { $("setOv").classList.remove("on"); };
  $("resetBtn").onclick = function () { settings = JSON.parse(JSON.stringify(DEFAULTS)); save(); buildSettings(); };

  // ---------- Menue im Spiel ----------
  $("ingameBtn").onclick = function () {
    sound("click");
    $("surrBtn").style.display = gameMode === "A" && (role === "L" || role === "R") ? "" : "none";
    $("pauseTitle").textContent = (GAME_INFO[gameMode || mode] || {}).name || "Men\u00FC";
    $("pauseOv").classList.add("on");
  };
  $("resumeBtn").onclick = function () { $("pauseOv").classList.remove("on"); };
  $("surrBtn").onclick = function () {
    $("pauseOv").classList.remove("on");
    if (game && game.surrender) game.surrender();
  };
  $("leaveBtn").onclick = function () {
    $("pauseOv").classList.remove("on");
    if (soloRun) { soloEnd(); return; }
    conn.left = true;
    if (conn.ws) conn.ws.close();
  };

  // ---------- Verbindung ----------
  function send(t) {
    if (t.length > 64) { console.warn("Nachricht zu lang f\u00FCr den Uno, nicht gesendet:", t); return; }
    if (conn.ws && conn.ws.readyState === 1) conn.ws.send(t);
  }

  function connect() {
    conn.kicked = false; conn.left = false; conn.solo = false;
    if (noServer) {
      setConn("bad", "Kein Arduino"); setStatus("\uD83D\uDCF4", "Kein Server erreichbar", "Hier gibt es nur Einzelspieler.");
      phase = ""; renderCards(); return;
    }
    $("kickOv").classList.remove("on");
    setConn("wait", "Verbinde");
    var q = new URLSearchParams(location.search).get("ws") || location.port;
    var ws;
    try { ws = new WebSocket("ws://" + location.hostname + (q ? ":" + q : "") + "/ws"); }
    catch (e) { setTimeout(connect, 2000); return; }
    conn.ws = ws;
    ws.onopen = function () { setConn("ok", "Verbunden"); };
    ws.onmessage = function (e) { onMsg(e.data); };
    ws.onclose = function () {
      if (conn.solo) { setConn("bad", "Offline (Einzelspieler)"); setStatus("\uD83C\uDFAE", "Einzelspieler l\u00E4uft", "Danach verbindest du dich wieder."); return; }
      stopGame(); showScreen("menu"); $("cdOv").classList.remove("on");
      setConn("bad", "Getrennt"); role = ""; renderRole();
      if (conn.kicked || conn.left) {
        $("kickTitle").textContent = conn.kicked ? "Vom Server getrennt" : "Spiel verlassen";
        $("kickText").textContent = conn.kicked ? "Du warst 6 Minuten inaktiv." : "Du hast die Verbindung beendet.";
        $("kickOv").classList.add("on");
        setStatus("\uD83D\uDCA4", "Nicht verbunden", "Tippe auf \u201EZur\u00FCck zum Server\u201C.");
      } else {
        setStatus("\u2026", "Verbindung weg", "Neuer Versuch in 2 Sekunden ...");
        setTimeout(connect, 2000);
      }
    };
  }
  $("backBtn").onclick = function () { sound("click"); connect(); };

  function renderRole() {
    $("roleChip").textContent = role ? "Du: " + RN[role] : "-";
  }


  // ---------- Nachrichten vom Server ----------
  function onMsg(d) {
    var a = d.split("|");
    var k = a[0];
    if (k === "#t") { tickNo++; statT++; if (game) { game.tick(); afterTick(); } return; }
    if (k === "i") { if (game) game.input(a[1], a.slice(2).join("|")); return; }
    if (k === "r") { onExtra(a[1], a.slice(2).join("|")); return; }
    if (k === "#s") { pongState(a[1]); return; }
    if (k === "#hello") return;
    if (k === "#mode") { mode = a[1]; renderCards(); if (GAME_INFO[mode].file) loadGame(mode, function () {}); return; }
    if (k === "#role") { role = a[1]; renderRole(); return; }
    if (k === "#lobby") {
      stopGame(); showScreen("menu"); $("cdOv").classList.remove("on");
      phase = "l"; playersOnline = +a[1]; ready = a[2] || "00"; renderCards(); return;
    }
    if (k === "#cd") {
      stopGame(); showScreen("menu"); phase = "c"; ready = "11"; renderCards();
      var gi = GAME_INFO[mode];
      setStatus(a[1], gi.name + " startet gleich", role === "Z" ? "Du schaust zu." : "Du bist " + RN[role] + ".");
      $("cdNum").textContent = a[1];
      $("cdSub").textContent = gi.icon + " " + gi.name + (role === "Z" ? " \u2013 du schaust zu" : " \u2013 du bist " + RN[role]);
      $("cdOv").classList.add("on"); sound("click");
      return;
    }
    if (k === "#go") { $("cdOv").classList.remove("on"); startRelayGame(+a[1] || 1); return; }
    if (k === "#end") { phase = "w"; roundOver(); return; }
    if (k === "#win") {
      phase = "w"; pongWin(a[1]);
      setTimeout(function () { if (phase === "w") roundOver(); }, 2500);
      return;
    }
    if (k === "#kick") { conn.kicked = true; return; }
    if (k === "#full") { toast("Server ist voll"); return; }
  }

  // Nach einer Runde zur\u00FCck ins Men\u00FC: dort kann man ein anderes Spiel w\u00E4hlen
  function roundOver() {
    stopGame(); showScreen("menu"); renderCards();
    setStatus("\u2713", "Runde vorbei", "Gleich seid ihr zur\u00FCck in der Lobby und k\u00F6nnt ein neues Spiel w\u00E4hlen.");
  }

  // ---------- Nachgeladene Spiele ----------
  var loading = {};
  function loadGame(m, cb) {
    if (window.GAMES[m]) { cb(); return; }
    if (loading[m]) { loading[m].push(cb); return; }
    loading[m] = [cb];
    var s = document.createElement("script");
    s.src = BASE + GAME_INFO[m].file + "?v=" + VER;
    s.onload = function () { var l = loading[m]; loading[m] = null; l.forEach(function (f) { f(); }); };
    s.onerror = function () { loading[m] = null; toast(GAME_INFO[m].name + " konnte nicht geladen werden", 4000); };
    document.head.appendChild(s);
  }

  var pending = null;    // Nachrichten, die waehrend des Ladens ankommen
  function startRelayGame(seed) {
    stopGame();
    phase = "g"; gameMode = mode; tickNo = 0; hashes = {};
    showScreen("game"); renderCards();
    var m = mode;
    if (!window.GAMES[m]) {
      pending = [];
      var origGame = { tick: function () { pending.push(["t"]); }, input: function (w, x) { pending.push(["i", w, x]); }, stop: function () {} };
      game = origGame;
      loadGame(m, function () {
        if (game !== origGame) return;
        var q = pending; pending = null; game = null;
        realStart(m, seed);
        q.forEach(function (e) { if (e[0] === "t") { game.tick(); afterTick(); } else game.input(e[1], e[2]); });
      });
      return;
    }
    realStart(m, seed);
  }

  function realStart(m, seed) {
    var root = $("gameRoot"); root.innerHTML = "";
    game = window.GAMES[m];
    game.start({
      root: root, role: role, seed: seed, settings: settings,
      sendInput: function (x) { send("i|" + x); },
      end: function () { send("e|"); },
      toast: toast, sound: sound
    });
  }

  function afterTick() {
    if (!game || !game.hash || role === "Z") return;
    if (tickNo % 50 === 0) {
      var hv = shortHash(game.hash());
      hashes[tickNo] = hv;
      send("r|h," + tickNo + "," + hv);
      delete hashes[tickNo - 500];
    }
  }

  // beliebige Pr\u00FCfsumme auf eine 32-Bit-Zahl k\u00FCrzen (Nachrichten an den Uno d\u00FCrfen max. 64 Zeichen haben)
  function shortHash(v) {
    if (typeof v === "number") return v >>> 0;
    var s = String(v), h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function onExtra(who, data) {
    var p = data.split(",");
    if (p[0] === "h" && who !== role && role !== "Z") {
      var mine = hashes[+p[1]];
      if (mine != null && String(mine) !== p[2]) toast("\u26A0\uFE0F Spielst\u00E4nde weichen ab (Desync bei Takt " + p[1] + ")", 5000);
    }
  }

  function stopGame() {
    if (game && game.stop) game.stop();
    if (pong.active) pongStop();
    game = null; gameMode = null; pending = null;
    $("gameRoot").innerHTML = "";
  }

  // ---------- PingPong (Server rechnet, hier nur Anzeige + Eingabe) ----------
  var PW = 160, PHt = 100, PPH = 24, PPW = 3, PBS = 4, PLX = 6, PRX = PW - 6 - PPW;
  var pong = { active: false, S: null, P: null, t0: 0, my: (PHt - PPH) / 2, sent: -1, cv: null, g: null, raf: 0, iv: 0, msg: "", won: "" };

  function pongState(s) {
    if (!pong.active) pongStart();
    pong.P = pong.S; pong.S = s.split(",").map(Number); pong.t0 = performance.now();
    if (pong.P && (pong.S[4] !== pong.P[4] || pong.S[5] !== pong.P[5])) sound("ok");
  }

  function pongStart() {
    stopGame();
    phase = "p"; gameMode = "P"; renderCards();
    $("cdOv").classList.remove("on");
    pong.active = true; pong.S = pong.P = null; pong.my = (PHt - PPH) / 2; pong.sent = -1; pong.won = "";
    showScreen("game");
    var root = $("gameRoot");
    var cv = h("canvas", { "class": "full" }); root.appendChild(cv);
    pong.cv = cv; pong.g = cv.getContext("2d");
    function setY(cy) {
      var r = pong.area;
      if (!r) return;
      pong.my = Math.max(0, Math.min(PHt - PPH, Math.round((cy - r.y) / r.h * PHt - PPH / 2)));
    }
    cv.addEventListener("pointerdown", function (e) { setY(e.clientY); });
    cv.addEventListener("pointermove", function (e) { if (e.buttons || e.pointerType !== "mouse") setY(e.clientY); });
    pong.key = function (e) {
      if (e.key === "ArrowUp" || e.key === "w") pong.my = Math.max(0, pong.my - 6);
      if (e.key === "ArrowDown" || e.key === "s") pong.my = Math.min(PHt - PPH, pong.my + 6);
    };
    document.addEventListener("keydown", pong.key);
    pong.iv = setInterval(function () {
      if ((role === "L" || role === "R") && pong.my !== pong.sent) { send("m|" + pong.my); pong.sent = pong.my; }
    }, 50);
    pongDraw();
  }

  function pongStop() {
    pong.active = false;
    cancelAnimationFrame(pong.raf); clearInterval(pong.iv);
    document.removeEventListener("keydown", pong.key);
  }

  function pongWin(w) {
    pong.won = w;
    sound(w === role ? "win" : "bad");
  }

  function pongDraw() {
    if (!pong.active) return;
    pong.raf = requestAnimationFrame(pongDraw);
    var cv = pong.cv, g = pong.g, dpr = window.devicePixelRatio || 1;
    var cw = cv.clientWidth, ch = cv.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#05070a"; g.fillRect(0, 0, cw, ch);
    // Spielfeld 16:10 einpassen
    var sc = Math.min((cw - 24) / PW, (ch - 24) / PHt), fw = PW * sc, fh = PHt * sc;
    var ox = (cw - fw) / 2, oy = (ch - fh) / 2;
    pong.area = { y: oy, h: fh };
    g.fillStyle = "#0c1a14"; g.fillRect(ox, oy, fw, fh);
    g.strokeStyle = "#1f3b2d"; g.lineWidth = 2; g.strokeRect(ox, oy, fw, fh);
    g.save(); g.translate(ox, oy); g.scale(sc, sc);
    g.fillStyle = "#1f3b2d"; for (var y = 2; y < PHt; y += 8) g.fillRect(PW / 2 - 0.5, y, 1, 4);
    var s = pong.S || [(PW - PBS) / 2, (PHt - PBS) / 2, (PHt - PPH) / 2, (PHt - PPH) / 2, 0, 0];
    if (pong.S && pong.P) {
      var f = Math.min(1, (performance.now() - pong.t0) / 50); s = s.slice();
      for (var i = 0; i < 4; i++) if (Math.abs(pong.S[i] - pong.P[i]) < 30) s[i] = pong.P[i] + (pong.S[i] - pong.P[i]) * f;
    }
    var lp = role === "L" ? pong.my : s[2], rp = role === "R" ? pong.my : s[3];
    g.font = "bold 22px system-ui"; g.textAlign = "center"; g.fillStyle = "rgba(255,255,255,.18)";
    g.fillText(s[4], PW / 2 - 20, 26); g.fillText(s[5], PW / 2 + 20, 26);
    g.fillStyle = role === "L" ? "#3ecf7a" : "#e8edf2"; g.fillRect(PLX, lp, PPW, PPH);
    g.fillStyle = role === "R" ? "#3ecf7a" : "#e8edf2"; g.fillRect(PRX, rp, PPW, PPH);
    if (pong.S && !pong.won) { g.fillStyle = "#fff"; g.shadowColor = "#9cf"; g.shadowBlur = 6; g.fillRect(s[0], s[1], PBS, PBS); g.shadowBlur = 0; }
    g.restore();
    g.fillStyle = "#cfd8e3"; g.font = "13px system-ui"; g.textAlign = "center";
    var info = role === "Z" ? "Du schaust zu" : "Du spielst " + (role === "L" ? "links" : "rechts") + " (gr\u00FCn)";
    g.fillText(info, cw / 2, oy - 6 > 12 ? oy - 6 : ch - 6);
    if (pong.won) {
      g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, ch / 2 - 40, cw, 80);
      g.fillStyle = "#fff"; g.font = "bold 28px system-ui";
      g.fillText(pong.won === role ? "Du gewinnst! \uD83C\uDFC6" : (pong.won === "L" ? "Links" : "Rechts") + " gewinnt", cw / 2, ch / 2 + 4);
      g.font = "14px system-ui"; g.fillText("Neue Runde gleich ...", cw / 2, ch / 2 + 28);
    }
  }

  // ---------- Einzelspieler: lokaler Takt statt Server ----------
  function startSolo(m) {
    sound("ok");
    conn.solo = true;
    if (conn.ws && conn.ws.readyState <= 1) conn.ws.close();
    $("cdOv").classList.remove("on"); $("kickOv").classList.remove("on");
    role = "L"; renderRole();
    var go = function () {
      stopGame();
      phase = m === "P" ? "p" : "g"; gameMode = m;
      showScreen("game");
      if (m === "P") { soloPong(); return; }
      var q = [];
      $("gameRoot").innerHTML = "";
      game = window.GAMES[m];
      game.start({ root: $("gameRoot"), role: "L", seed: ((Math.random() * 1e6) | 0) || 1, settings: settings, solo: true, ai: settings.ai,
        sendInput: function (x) { q.push(x); }, end: soloEnd, toast: toast, sound: sound });
      soloRun = { iv: setInterval(function () {
        if (!game) return;
        q.splice(0).forEach(function (x) { game.input("L", x); });
        game.tick(); statT++;
      }, 50) };
    };
    if (m === "P" || window.GAMES[m]) go();
    else { toast("Lade " + GAME_INFO[m].name + " ..."); loadGame(m, go); }
  }

  function soloEnd() {
    if (soloRun) { clearInterval(soloRun.iv); soloRun = null; }
    stopGame(); phase = ""; role = ""; renderRole();
    showScreen("menu"); renderCards();
    connect();
  }

  // PingPong gegen den Computer (gleiche Regeln wie auf dem Arduino)
  function soloPong() {
    var P = { bx: 78, by: 48, lp: 38, rp: 38, vx: 0, vy: 0, ls: 0, rs: 0, pause: 30 }, done = false, aim = 0;
    var spd = [0, 2, 3, 4][settings.ai || 2];
    function serve(d) { P.bx = 78; P.by = 48; P.vx = 3 * d; P.vy = [-2, -1, 1, 2][(Math.random() * 4) | 0]; P.pause = 20; aim = ((Math.random() * 16) | 0) - 8; }
    function bounce(pad) {
      P.vx = -P.vx; if (Math.abs(P.vx) < 7) P.vx += P.vx > 0 ? 1 : -1;
      P.vy = Math.max(-5, Math.min(5, Math.trunc(((P.by + 2) - (pad + 12)) / 3))) || (Math.random() < 0.5 ? 1 : -1);
      aim = ((Math.random() * 16) | 0) - 8;
    }
    function point(left) {
      if (left) P.ls++; else P.rs++;
      if (P.ls >= 5 || P.rs >= 5) { done = true; pongWin(left ? "L" : "R"); setTimeout(function () { if (soloRun) soloEnd(); }, 3000); return; }
      serve(left ? 1 : -1);
    }
    serve(Math.random() < 0.5 ? 1 : -1);
    pongStart();
    soloRun = { iv: setInterval(function () {
      if (done) return;
      statT++;
      P.lp = pong.my;
      var target = P.vx > 0 ? P.by + 2 - 12 + aim : 38;                 // Computer folgt dem Ball
      P.rp = Math.max(0, Math.min(76, P.rp + Math.max(-spd, Math.min(spd, target - P.rp))));
      if (P.pause > 0) P.pause--;
      else {
        P.bx += P.vx; P.by += P.vy;
        if (P.by < 0) { P.by = -P.by; P.vy = -P.vy; }
        if (P.by > 96) { P.by = 192 - P.by; P.vy = -P.vy; }
        if (P.vx < 0 && P.bx <= 9 && P.bx + 4 >= 6 && P.by + 4 >= P.lp && P.by <= P.lp + 24) { P.bx = 9; bounce(P.lp); }
        if (P.vx > 0 && P.bx + 4 >= 151 && P.bx <= 154 && P.by + 4 >= P.rp && P.by <= P.rp + 24) { P.bx = 147; bounce(P.rp); }
        if (P.bx < -4) point(false); else if (P.bx > 160) point(true);
      }
      pongState([P.bx, P.by, P.lp, P.rp, P.ls, P.rs].join(","));
    }, 50) };
  }

  // ---------- Leistungsanzeige ----------
  var frames = 0, statT = 0;
  (function countFrames() { frames++; requestAnimationFrame(countFrames); })();
  setInterval(function () {
    if (settings.stats) $("stats").textContent = "FPS " + frames + " \u00B7 Takte/s " + statT;
    frames = 0; statT = 0;
  }, 1000);

  // ---------- Start ----------
  applySettings();
  renderCards(); renderRole();
  connect();
})();
