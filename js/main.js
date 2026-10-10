/* ANZA(30) — interacciones de la página (sin dependencias) */
(function () {
  "use strict";

  var page = document.querySelector(".page");
  if (!page) return;
  page.classList.remove("no-js");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
     Al recargar, la página vuelve siempre al principio (el navegador, por
     defecto, recordaría la posición de scroll anterior).
     ------------------------------------------------------------------ */
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  if (!window.location.hash) window.scrollTo(0, 0);

  /* ------------------------------------------------------------------
     Animación de entrada: solo si la página se abre arriba del todo.
     Se salta en cuanto la persona hace scroll, para no hacerla esperar.
     ------------------------------------------------------------------ */
  var INTRO_MS = 4400;
  if (!reduceMotion && window.pageYOffset < 20) {
    page.classList.add("is-intro");
    var endIntro = function () {
      page.classList.remove("is-intro");
      window.removeEventListener("wheel", endIntro);
      window.removeEventListener("touchmove", endIntro);
      window.removeEventListener("keydown", endIntro);
    };
    window.setTimeout(endIntro, INTRO_MS);
    window.addEventListener("wheel", endIntro, { passive: true });
    window.addEventListener("touchmove", endIntro, { passive: true });
    window.addEventListener("keydown", endIntro);
    window.addEventListener("scroll", function onIntroScroll() {
      if (window.pageYOffset > 40) { window.removeEventListener("scroll", onIntroScroll); endIntro(); }
    }, { passive: true });
  }

  /* ------------------------------------------------------------------
     Hero: la animación va ligada al scroll. Cada posición de scroll
     corresponde a un punto exacto de la animación (avanza y retrocede con
     el dedo o la rueda), con un ligero suavizado para que no vaya a saltos.
     ------------------------------------------------------------------ */
  var hero = document.querySelector(".hero");
  var stage = document.querySelector(".hero__stage");
  var header = document.querySelector(".header");
  var scenes = Array.prototype.slice.call(document.querySelectorAll(".scene"));
  var backgrounds = Array.prototype.slice.call(stage.querySelectorAll(".hero__bg"));
  var fading = Array.prototype.slice.call(stage.querySelectorAll(".hero__light, .hero__smoke"));
  var bigs = Array.prototype.slice.call(stage.querySelectorAll(".hero__big"));
  var decos = Array.prototype.slice.call(stage.querySelectorAll(".deco"));
  var frame = stage.querySelector(".hero__frame");
  var lights = stage.querySelector(".hero__lights");
  var worldMap = stage.querySelector(".hero__map");
  var routes = Array.prototype.slice.call(stage.querySelectorAll(".hero__route"));
  var MAP_GROW = 0.55; // cuánto crece el mapa (y la constelación) al pasar de la primera pantalla a las siguientes
  var MAP_FADE = 0.6;  // opacidad del mapa cuando hay texto grande encima (1 = como en la primera pantalla)
  var LIGHTS_SOFT = 0.3; // intensidad de las luces del mapa a partir de la segunda pantalla (1 = como en la primera)

  // Guion: [fracción del recorrido, escena]. Entre dos puntos con la misma
  // escena la pantalla se queda quieta; entre escenas distintas, hace la transición.
  var STOPS = [[0, 0], [0.1, 0], [0.3, 1], [0.4, 1], [0.6, 2], [0.7, 2], [0.9, 3], [1, 3]];
  var DECOS = [[0.4783, 0.34, 75, 59.5], [0.13, 0.34, 194, 0], [0.7577, 0.34, 194, 0]]; // posición (x, y) y tamaño final de cada par de óvalos
  var SMOOTH = 0.14; // suavizado: 1 = sin suavizar, más bajo = más inercia
  var CORNERS = [[32, 46], [32, 46], [32, 10], [13, 5]]; // tamaño de las esquinas del marco en cada escena

  var current = -1;
  var shown = null; // punto de la animación que se está pintando (0 a 3)
  var boxes = [];
  var unit = 1;
  var rafId = null;

  function clamp(value) { return Math.min(1, Math.max(0, value)); }
  function mix(from, to, t) { return from + (to - from) * t; }
  function ease(t) { return t * t * (3 - 2 * t); }

  function scrollPoint() {
    var travel = hero.offsetHeight - stage.offsetHeight;
    var progress = travel > 0 ? clamp(-hero.getBoundingClientRect().top / travel) : 0;
    for (var i = 1; i < STOPS.length; i++) {
      if (progress <= STOPS[i][0]) {
        var t = (progress - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]);
        return mix(STOPS[i - 1][1], STOPS[i][1], ease(clamp(t)));
      }
    }
    return STOPS[STOPS.length - 1][1];
  }

  // Caja del marco de esquinas en cada escena (se recalcula al cambiar el tamaño)
  function measure() {
    var W = stage.clientWidth;
    var H = stage.clientHeight;
    var narrow = W <= 640;
    unit = W / (narrow ? 626 : W <= 1024 ? 1178 : 1727);
    var pad = (narrow ? 18 : 37) * unit;
    var top = header ? header.offsetHeight : 0;
    var y0 = top + (H - top) * 0.06;
    var big = [pad, y0, W - 2 * pad, H - y0 - H * 0.045];
    if (narrow) {
      // en móvil el marco grande deja el mismo margen arriba (bajo el menú) que abajo
      var margin = H * 0.04;
      big = [pad, top + margin, W - 2 * pad, H - top - 2 * margin];
    }

    var texts = scenes[2].querySelectorAll("p");
    var first = texts[0];
    var last = texts[texts.length - 1];
    var gap = W * (narrow ? 0.08 : 0.03);
    var y = first.offsetTop - gap;
    var band = [pad, y, W - 2 * pad, last.offsetTop + last.offsetHeight + gap - y];

    var cta = scenes[3].querySelector(".scene__cta");
    var link = [cta.offsetLeft, cta.offsetTop, cta.offsetWidth, cta.offsetHeight];
    boxes = [big, big, band, link];
  }

  function paint(v) {
    var state = Math.round(v);
    if (state !== current) {
      current = state;
      stage.setAttribute("data-state", String(state));
      scenes.forEach(function (scene, i) {
        scene.classList.toggle("is-active", i === state);
        scene.setAttribute("aria-hidden", i === state ? "false" : "true");
      });
    }

    // textos: el que sale se desvanece subiendo y el que entra aparece desde abajo
    scenes.forEach(function (scene, i) {
      var d = v - i;
      var opacity = clamp(1 - Math.abs(d) * 1.8);
      scene.style.opacity = opacity.toFixed(3);
      scene.style.visibility = opacity > 0.01 ? "visible" : "hidden";
      scene.style.transform = "translate3d(0," + (-d * 90 * unit).toFixed(1) + "px,0)";
    });

    // fondos: cada uno se funde sobre el anterior
    backgrounds.forEach(function (bg, i) {
      bg.style.opacity = i === 0 ? "1" : clamp(v - (i - 1)).toFixed(3);
    });
    fading.forEach(function (el) { el.style.opacity = clamp(1 - v * 1.15).toFixed(3); });
    bigs.forEach(function (el) { el.style.opacity = clamp(1 - v * 2.5).toFixed(3); });

    // Óvalos: en la segunda pantalla se forman en grande en el centro del fondo; al
    // seguir deslizando se encogen y se reparten por el mapa, cada par en su cuadro.
    var W = stage.clientWidth;
    var H = stage.clientHeight;
    var top = header ? header.offsetHeight : 0;
    var bigSize = Math.min(W * 0.46, (H - top) * 0.82);
    var forming = clamp(v);                 // 0 → 1: aparecen
    var spread = ease(clamp(v - 1));        // 0 → 1: se reparten
    decos.forEach(function (deco, i) {
      var d = DECOS[i];
      var size = d[2] * unit;
      var dx = W / 2 - (W * d[0] + size / 2);
      var dy = (H + top) / 2 - (H * d[1] + d[3] * unit + size / 2);
      var scale = mix((bigSize / size) * (0.86 + 0.14 * forming), 1, spread);
      // se cambia el tamaño real (no una escala) para que el trazo siga siendo fino
      var now = size * scale;
      var shift = (now - size) / 2;
      deco.style.width = deco.style.height = now.toFixed(1) + "px";
      deco.style.transform = "translate(" + (dx * (1 - spread) - shift).toFixed(1) + "px," + (dy * (1 - spread) - shift).toFixed(1) + "px)";
      // en grande los tres pares coinciden, así que solo se muestra uno hasta que se separan
      var solo = i === 0 ? 1 : clamp(spread * 4);
      // en la última pantalla desaparecen y quedan solo las conexiones
      var gone = 1 - clamp((v - 2.15) / 0.5);
      deco.style.setProperty("--el", (mix(0.34, 0.48, spread) * forming * solo * gone).toFixed(3));
      deco.style.setProperty("--sq", (0.26 * clamp(spread * 1.6 - 0.6) * gone).toFixed(3));
    });

    // luces del mapa: intensas en la primera pantalla, suaves cuando hay texto grande encima
    if (lights) lights.style.opacity = mix(1, LIGHTS_SOFT, clamp(v)).toFixed(3);

    // mapa y constelación: crecen y se atenúan hasta quedar como una trama de fondo
    // crece de la 1ª a la 2ª pantalla y vuelve a su tamaño original al llegar a la última
    var grown = clamp(v) * (1 - ease(clamp(v - 2)));
    var grow = "scale(" + (1 + MAP_GROW * grown).toFixed(4) + ")";
    if (worldMap) {
      worldMap.style.transform = grow;
      worldMap.style.opacity = mix(1, MAP_FADE, clamp(v)).toFixed(3);
    }
    routes.forEach(function (route) { route.style.transform = grow; });
    stage.style.setProperty("--dots", clamp((v - 2.35) / 0.65).toFixed(4));

    // constelación
    stage.style.setProperty("--draw", clamp((v - 0.6) / 2.3).toFixed(4));

    // marco de esquinas: se transforma de una caja a la siguiente
    if (frame && boxes.length) {
      var w = Math.min(3, Math.max(1, v));
      var k0 = Math.min(2, Math.floor(w));
      var f = w - k0;
      var from = boxes[k0];
      var to = boxes[k0 + 1];
      frame.style.opacity = clamp((v - 0.35) / 0.65).toFixed(3);
      frame.style.setProperty("--fx", mix(from[0], to[0], f).toFixed(1) + "px");
      frame.style.setProperty("--fy", mix(from[1], to[1], f).toFixed(1) + "px");
      frame.style.setProperty("--fw", mix(from[2], to[2], f).toFixed(1) + "px");
      frame.style.setProperty("--fh", mix(from[3], to[3], f).toFixed(1) + "px");
      frame.style.setProperty("--cw", (mix(CORNERS[k0][0], CORNERS[k0 + 1][0], f) * unit).toFixed(1) + "px");
      frame.style.setProperty("--ch", (mix(CORNERS[k0][1], CORNERS[k0 + 1][1], f) * unit).toFixed(1) + "px");
    }
  }

  function tick() {
    rafId = null;
    var target = scrollPoint();
    if (reduceMotion) target = Math.round(target);
    if (shown === null || reduceMotion || Math.abs(target - shown) < 0.0015) shown = target;
    else shown += (target - shown) * SMOOTH;
    paint(shown);
    if (shown !== target) rafId = window.requestAnimationFrame(tick);
  }

  function updateHero() {
    if (rafId === null) rafId = window.requestAnimationFrame(tick);
  }

  function refreshHero() {
    measure();
    if (shown === null) shown = scrollPoint();
    paint(shown);
    updateHero();
  }

  stage.classList.add("is-scrub");

  /* ------------------------------------------------------------------
     Menú: resalta la sección que se está viendo
     ------------------------------------------------------------------ */
  var links = Array.prototype.slice.call(document.querySelectorAll(".nav a"));
  var targets = links.map(function (link) {
    return document.querySelector(link.getAttribute("href"));
  });

  var footer = document.querySelector(".closing");
  var flow = document.querySelector(".flow");
  var GREY = [56, 56, 56];   // #383838
  var BLUE = [20, 56, 224];  // #1438e0
  var FLOW_FROM = 0.283;     // mismos puntos que el degradado de .flow en css/styles.css
  var FLOW_TO = 0.607;

  function updateNav() {
    if (header && footer && flow) {
      // El fondo del menú sigue al degradado gris → azul de la sección de partners,
      // y desaparece cuando el footer ya ocupa toda la pantalla.
      var clear = footer.getBoundingClientRect().top <= 2;
      header.classList.toggle("is-clear", clear);
      if (clear) {
        header.style.backgroundColor = "transparent";
      } else {
        var box = flow.getBoundingClientRect();
        var at = (header.offsetHeight - box.top) / box.height; // punto del degradado que queda bajo el menú
        var k = Math.min(1, Math.max(0, (at - FLOW_FROM) / (FLOW_TO - FLOW_FROM)));
        header.style.backgroundColor = "rgb(" + GREY.map(function (c, i) { return Math.round(c + (BLUE[i] - c) * k); }).join(",") + ")";
      }
    }
    var mid = window.innerHeight * 0.5;
    var active = 0;
    targets.forEach(function (target, i) {
      if (target && target.getBoundingClientRect().top <= mid) active = i;
    });
    links.forEach(function (link, i) {
      link.classList.toggle("is-active", i === active);
      if (i === active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }

  var ticking = false;
  function onScroll() {
    updateHero();
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      updateNav();
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  window.addEventListener("resize", refreshHero);
  refreshHero();
  updateNav();
  // las cajas dependen del texto: se recalculan cuando termina de cargar la tipografía
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshHero);
  window.addEventListener("load", refreshHero);

  /* ------------------------------------------------------------------
     Tarjetas: el botón "+" muestra u oculta la bio del partner
     ------------------------------------------------------------------ */
  function fitBio(bio) {
    // si la bio es larga, reduce el cuerpo de letra hasta que quepa en la tarjeta
    var fit = 1;
    bio.style.setProperty("--fit", fit);
    while (bio.scrollHeight > bio.clientHeight + 1 && fit > 0.55) {
      fit -= 0.04;
      bio.style.setProperty("--fit", fit.toFixed(2));
    }
  }

  function setOpen(card, open) {
    var button = card.querySelector(".card__toggle");
    var bio = card.querySelector(".card__bio");
    var name = card.getAttribute("data-name");
    if (!button || !bio) return;
    card.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.setAttribute("aria-label", (open ? "Hide bio of " : "Show bio of ") + name);
    bio.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) fitBio(bio);
  }

  // Si un nombre o apellido largo no cabe en su tarjeta, se reduce lo justo para que quepa.
  function fitName(card) {
    var title = card.querySelector(".card__name");
    if (!title) return;
    title.style.removeProperty("--fit");
    var avail = card.clientWidth - 2 * title.offsetLeft;
    var widest = 0;
    Array.prototype.forEach.call(title.querySelectorAll("span"), function (span) {
      widest = Math.max(widest, span.getBoundingClientRect().width);
    });
    if (widest > avail && widest > 0) title.style.setProperty("--fit", Math.max(0.6, avail / widest).toFixed(3));
  }
  function fitNames() {
    Array.prototype.forEach.call(document.querySelectorAll(".card"), fitName);
  }

  var SVG = "http://www.w3.org/2000/svg";
  var PLUS = '<svg viewBox="0 0 27 28" aria-hidden="true"><path d="M11.50 27.61V0H15.28V27.61H11.50ZM0 15.57V12.03H26.78V15.57H0Z"/></svg>';

  Array.prototype.forEach.call(document.querySelectorAll(".card"), function (card, index) {
    // Nombre: en el HTML basta con escribir <span>NOMBRE</span> <span>Apellido</span>.
    // Aquí se cambia cada "A" del nombre por la "A" especial de la marca.
    var title = card.querySelector(".card__name");
    var spans = title ? title.querySelectorAll("span") : [];
    var first = spans[0] ? spans[0].textContent.trim() : "";
    var last = spans[1] ? spans[1].textContent.trim() : "";
    var name = (first.charAt(0) + first.slice(1).toLowerCase() + " " + last).trim();
    card.setAttribute("data-name", name);
    if (title && spans[0]) {
      title.setAttribute("aria-label", name);
      var pieces = first.split("A");
      spans[0].textContent = "";
      pieces.forEach(function (piece, k) {
        if (k) {
          var a = document.createElementNS(SVG, "svg");
          a.setAttribute("viewBox", "0 0 82 70");
          a.setAttribute("class", "a" + (k === 1 && !pieces[0] ? " a--first" : ""));
          a.setAttribute("aria-hidden", "true");
          var use = document.createElementNS(SVG, "use");
          use.setAttribute("href", "#glyph-a");
          a.appendChild(use);
          spans[0].appendChild(a);
        }
        if (piece) spans[0].appendChild(document.createTextNode(piece));
      });
    }

    // solo las tarjetas con texto en la bio muestran el botón "+"
    var text = card.querySelector(".card__bio");
    if (!text || !text.textContent.trim()) return;
    card.classList.add("has-bio");
    text.id = text.id || "bio-" + (index + 1);
    text.setAttribute("aria-hidden", "true");
    var toggle = document.createElement("button");
    toggle.className = "card__toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", text.id);
    toggle.setAttribute("aria-label", "Show bio of " + name);
    toggle.innerHTML = PLUS;
    card.appendChild(toggle);

    card.addEventListener("click", function () {
      var opening = !card.classList.contains("is-open");
      // solo una bio abierta a la vez: al abrir una, las demás vuelven a su estado normal
      if (opening) {
        Array.prototype.forEach.call(document.querySelectorAll(".card.is-open"), function (other) {
          if (other !== card) setOpen(other, false);
        });
      }
      setOpen(card, opening);
    });
    card.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && card.classList.contains("is-open")) {
        setOpen(card, false);
        card.querySelector(".card__toggle").focus();
      }
    });
  });

  fitNames();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitNames);
  window.addEventListener("load", fitNames);
  window.addEventListener("resize", function () {
    fitNames();
    Array.prototype.forEach.call(document.querySelectorAll(".card.is-open .card__bio"), fitBio);
  });

  /* ------------------------------------------------------------------
     Titular de la red de partners: aparece al entrar en pantalla
     ------------------------------------------------------------------ */
  var intro = document.querySelector(".network__intro");
  if (intro) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      intro.classList.add("is-in");
    } else {
      var introObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            intro.classList.add("is-in");
            introObserver.disconnect();
          });
        },
        { threshold: 0.2 }
      );
      introObserver.observe(intro);
    }
  }

  /* ------------------------------------------------------------------
     Partners: cada tarjeta aparece al entrar en pantalla, una tras otra
     ------------------------------------------------------------------ */
  var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));
  var grid = document.querySelector(".grid");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    cards.forEach(function (card) { card.classList.add("is-visible"); });
    if (grid) grid.classList.add("is-in", "is-end");
  } else {
    var cardObserver = new IntersectionObserver(
      function (entries) {
        var entering = entries
          .filter(function (entry) { return entry.isIntersecting; })
          .sort(function (a, b) {
            return a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left;
          });
        entering.forEach(function (entry, i) {
          cardObserver.unobserve(entry.target);
          window.setTimeout(function () {
            entry.target.classList.add("is-visible");
            // líneas a sangre: la de arriba con la primera tarjeta, la de abajo con la última
            if (entry.target === cards[0]) grid.classList.add("is-in");
            if (entry.target === cards[cards.length - 1]) grid.classList.add("is-end");
          }, i * 160);
        });
      },
      { threshold: 0.12 }
    );
    cards.forEach(function (card) { cardObserver.observe(card); });
  }

  /* ------------------------------------------------------------------
     "Submit your project": copia el email y lo muestra en el botón
     ------------------------------------------------------------------ */
  var submit = document.getElementById("submit-project");
  if (submit) {
    submit.addEventListener("click", function () {
      var email = submit.getAttribute("data-email");
      submit.textContent = email;
      submit.classList.add("is-copied");
      submit.setAttribute("aria-label", email + " (copied to clipboard)");

      function fallback() {
        // navegadores sin acceso al portapapeles: copia desde un campo temporal
        var field = document.createElement("textarea");
        field.value = email;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        try { document.execCommand("copy"); } catch (error) { /* el email queda visible para copiarlo a mano */ }
        document.body.removeChild(field);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(email).catch(fallback);
      } else {
        fallback();
      }
    });
  }

  /* ------------------------------------------------------------------
     Cierre: la animación se lanza cuando la sección entra en pantalla
     ------------------------------------------------------------------ */
  var closing = document.querySelector(".closing");
  if (closing) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      closing.classList.add("is-in");
    } else {
      new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            closing.classList.toggle("is-in", entry.isIntersecting);
          });
        },
        { threshold: 0.35 }
      ).observe(closing);
    }
  }
})();
