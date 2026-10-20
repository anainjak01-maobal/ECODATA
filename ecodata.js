/* EcoData · funciones comunes: leer observaciones, enviarlas al registro, estadística y gráficos.
   No depende de ninguna librería. Se expone como window.ED. */
(function (w) {
  "use strict";
  var CFG = w.ED_CONFIG || {};
  var PUNTOS = ["Portería", "Esquina", "Patio"];
  var OLORES = ["No", "Leve", "Fuerte"];
  var POLVOS = ["Bajo", "Medio", "Alto"];

  /* ---------- Formato ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function entero(n) { return n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString("es-CO"); }
  function dec(n) { return n == null || isNaN(n) ? "–" : (Math.round(n * 10) / 10).toFixed(1).replace(".", ","); }
  function pct(x) { return x == null || isNaN(x) ? "–" : Math.round(x * 100) + " %"; }
  function fechaCorta(iso) { var p = iso.split("-"); return p[2] + "/" + p[1]; }
  function fechaLarga(iso) { var p = iso.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
  function hoy() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ---------- Utilidades estadísticas ---------- */
  function suma(arr, fn) { return arr.reduce(function (s, x) { return s + (fn ? fn(x) : x); }, 0); }
  function media(arr) { return arr.length ? suma(arr) / arr.length : null; }
  function unicos(arr) { return arr.filter(function (v, i, a) { return a.indexOf(v) === i; }); }

  /* Números aleatorios reproducibles (mulberry32): el mismo conjunto da siempre el mismo rango. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* Rango probable del promedio (95 %) por remuestreo. */
  function ic95(arr, seed) {
    if (arr.length < 2) return null;
    var r = rng(seed), B = 4000, n = arr.length, m = [];
    for (var b = 0; b < B; b++) {
      var s = 0;
      for (var i = 0; i < n; i++) s += arr[Math.floor(r() * n)];
      m.push(s / n);
    }
    m.sort(function (x, y) { return x - y; });
    return [m[Math.floor(B * 0.025)], m[Math.floor(B * 0.975)]];
  }
  /* Rango probable de la diferencia de promedios (a menos b). */
  function icDiferencia(a, b, seed) {
    if (a.length < 2 || b.length < 2) return null;
    var r = rng(seed), B = 4000, d = [];
    for (var k = 0; k < B; k++) {
      var sa = 0, sb = 0, i;
      for (i = 0; i < a.length; i++) sa += a[Math.floor(r() * a.length)];
      for (i = 0; i < b.length; i++) sb += b[Math.floor(r() * b.length)];
      d.push(sa / a.length - sb / b.length);
    }
    d.sort(function (x, y) { return x - y; });
    return [d[Math.floor(B * 0.025)], d[Math.floor(B * 0.975)]];
  }
  /* Intervalo de Wilson para una proporción k de n. */
  function wilson(k, n) {
    if (!n) return null;
    var z = 1.96, p = k / n, den = 1 + z * z / n;
    var c = (p + z * z / (2 * n)) / den;
    var h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }

  /* ---------- Carga y envío ---------- */
  function cargar() {
    var base = w.DS_DATOS_BASE || [];
    if (!CFG.REGISTRO) return Promise.resolve({ datos: base, fuente: "respaldo", motivo: "Falta REGISTRO en config.js." });
    var url = CFG.REGISTRO + (CFG.REGISTRO.indexOf("?") > -1 ? "&" : "?") + "datos=1";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || "El registro no respondió bien.");
        return { datos: j.datos, fuente: "vivo" };
      })
      .catch(function (err) {
        return { datos: base, fuente: "respaldo", motivo: err.message };
      });
  }
  function enviar(accion, payload, clave) {
    if (!CFG.REGISTRO) return Promise.resolve({ ok: false, error: "Falta REGISTRO en config.js." });
    var cuerpo = Object.assign({ accion: accion, clave: clave }, payload || {});
    return fetch(CFG.REGISTRO, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(cuerpo)
    }).then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: "No hubo respuesta del registro. Revisa la conexión." }; });
  }

  /* ---------- Filtros y resúmenes ---------- */
  function filtrar(datos, f, conPunto) {
    return datos.filter(function (r) {
      if (f.desde && r.fecha < f.desde) return false;
      if (f.hasta && r.fecha > f.hasta) return false;
      if (conPunto && f.punto && f.punto !== "Todos" && r.punto !== f.punto) return false;
      return true;
    });
  }
  function resumen(rows) {
    var tardes = unicos(rows.map(function (r) { return r.fecha; }));
    var quema = unicos(rows.filter(function (r) { return r.quema; }).map(function (r) { return r.fecha; }));
    var bolsas = suma(rows, function (r) { return r.bolsas; });
    return {
      filas: rows.length, tardes: tardes.length, bolsas: bolsas,
      promFila: rows.length ? bolsas / rows.length : null,
      quemaDias: quema.length, quemaIC: wilson(quema.length, tardes.length),
      olorFuerte: rows.filter(function (r) { return r.olor === "Fuerte"; }).length
    };
  }
  function porPunto(rows) {
    return PUNTOS.map(function (p) {
      var rs = rows.filter(function (r) { return r.punto === p; });
      var tot = suma(rs, function (r) { return r.bolsas; });
      return {
        punto: p, filas: rs.length, total: tot,
        prom: rs.length ? tot / rs.length : null,
        max: rs.length ? Math.max.apply(null, rs.map(function (r) { return r.bolsas; })) : null,
        quemaDias: unicos(rs.filter(function (r) { return r.quema; }).map(function (r) { return r.fecha; })).length
      };
    });
  }
  function porNivel(rows, campo, niveles) {
    return niveles.map(function (n) {
      var rs = rows.filter(function (r) { return r[campo] === n; });
      return { nivel: n, n: rs.length, prom: media(rs.map(function (r) { return r.bolsas; })) };
    });
  }
  function cruce(rows) {
    return OLORES.map(function (o) {
      return {
        olor: o,
        conQuema: rows.filter(function (r) { return r.olor === o && r.quema; }).length,
        sinQuema: rows.filter(function (r) { return r.olor === o && !r.quema; }).length
      };
    });
  }
  function fechasOrdenadas(rows) { return unicos(rows.map(function (r) { return r.fecha; })).sort(); }

  /* ---------- Gráficos (SVG como texto) ---------- */
  function svg(W, H, inner, nombre) {
    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(nombre) + '">' + inner + "</svg>";
  }
  function barrasH(items, nombre) {
    var W = 560, rowH = 46, left = 112, right = 70, top = 8;
    var max = Math.max.apply(null, items.map(function (i) { return i.valor; }).concat([1]));
    var H = top + items.length * rowH + 6, out = "";
    items.forEach(function (it, i) {
      var y = top + i * rowH, bw = (W - left - right) * it.valor / max;
      var fill = it.destacado ? "var(--accent)" : "var(--neutral)";
      out += '<g><title>' + esc(it.etiqueta + ": " + entero(it.valor) + " " + (it.unidad || "")) + "</title>";
      out += '<text x="0" y="' + (y + 25) + '">' + esc(it.etiqueta) + "</text>";
      out += '<rect x="' + left + '" y="' + (y + 8) + '" width="' + Math.max(bw, 2) + '" height="26" style="fill:' + fill + '"/>';
      out += '<text x="' + (left + bw + 8) + '" y="' + (y + 27) + '" style="font-weight:' + (it.destacado ? 700 : 400) + '">' + esc(entero(it.valor)) + "</text></g>";
    });
    return svg(W, H, out, nombre);
  }
  function columnas(fechas, rows, nombre) {
    var W = Math.max(640, fechas.length * 46), H = 290, top = 40, base = 236, left = 36;
    var max = Math.max.apply(null, rows.map(function (r) { return r.bolsas; }).concat([1]));
    var yMax = Math.ceil(max / 4) * 4 + 4;
    var escala = function (v) { return base - (base - top) * v / yMax; };
    var grupo = (W - left - 8) / Math.max(fechas.length, 1), bw = Math.min(11, grupo / 4);
    var out = "";
    for (var t = 0; t <= yMax; t += 4) {
      out += '<line x1="' + left + '" x2="' + (W - 4) + '" y1="' + escala(t) + '" y2="' + escala(t) + '" style="stroke:var(--rule)"/>';
      out += '<text class="eje" x="' + (left - 6) + '" y="' + (escala(t) + 4) + '" text-anchor="end">' + t + "</text>";
    }
    fechas.forEach(function (f, i) {
      var cx = left + i * grupo + grupo / 2, x0 = cx - (3 * bw) / 2, quema = false;
      PUNTOS.forEach(function (p, j) {
        var r = rows.filter(function (q) { return q.fecha === f && q.punto === p; })[0];
        if (!r) return;
        if (r.quema) quema = true;
        var y = escala(r.bolsas), fill = p === "Esquina" ? "var(--accent)" : p === "Patio" ? "var(--neutral-2)" : "var(--neutral)";
        out += '<rect x="' + (x0 + j * bw) + '" y="' + y + '" width="' + (bw - 1) + '" height="' + (base - y) + '" style="fill:' + fill + '"><title>' +
          esc(p + " · " + fechaLarga(f) + ": " + r.bolsas + " bolsas" + (r.quema ? " · quema vista" : "")) + "</title></rect>";
      });
      out += '<text class="eje" x="' + cx + '" y="' + (base + 16) + '" text-anchor="middle">' + fechaCorta(f) + "</text>";
      if (quema) {
        out += '<path d="M' + cx + " " + (top - 14) + " l5 7 l-5 7 l-5 -7z\" style=\"fill:var(--accent)\"/>";
        out += '<text x="' + cx + '" y="' + (top - 20) + '" text-anchor="middle" style="fill:var(--accent);font-size:12px">quema</text>';
      }
    });
    out += '<line x1="' + left + '" x2="' + (W - 4) + '" y1="' + base + '" y2="' + base + '" style="stroke:var(--ink2)"/>';
    return svg(W, H, out, nombre);
  }
  function lineas(fechas, rows, nombre) {
    var W = Math.max(640, fechas.length * 46), H = 260, top = 24, base = 218, left = 36;
    var max = Math.max.apply(null, rows.map(function (r) { return r.bolsas; }).concat([1]));
    var yMax = Math.ceil(max / 4) * 4 + 4;
    var grupo = (W - left - 110) / Math.max(fechas.length - 1, 1);
    var x = function (i) { return left + i * grupo; };
    var y = function (v) { return base - (base - top) * v / yMax; };
    var out = "";
    for (var t = 0; t <= yMax; t += 4) {
      out += '<line x1="' + left + '" x2="' + (W - 110) + '" y1="' + y(t) + '" y2="' + y(t) + '" style="stroke:var(--rule)"/>';
      out += '<text class="eje" x="' + (left - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + t + "</text>";
    }
    var estilo = {
      "Portería": { c: "var(--ink-soft)", d: "" },
      "Esquina": { c: "var(--accent)", d: "" },
      "Patio": { c: "var(--ink2)", d: "6 4" }
    };
    var etiquetas = [];
    PUNTOS.forEach(function (p) {
      var pts = [];
      fechas.forEach(function (f, i) {
        var r = rows.filter(function (q) { return q.fecha === f && q.punto === p; })[0];
        if (r) pts.push({ x: x(i), y: y(r.bolsas), v: r.bolsas, f: f });
      });
      if (!pts.length) return;
      var e = estilo[p];
      out += '<polyline points="' + pts.map(function (q) { return q.x + "," + q.y; }).join(" ") + '" fill="none" stroke-width="2.5" stroke-dasharray="' + e.d + '" style="stroke:' + e.c + '"/>';
      pts.forEach(function (q) {
        out += '<circle cx="' + q.x + '" cy="' + q.y + '" r="4" style="fill:' + e.c + '"><title>' + esc(p + " · " + fechaLarga(q.f) + ": " + q.v + " bolsas") + "</title></circle>";
      });
      var ult = pts[pts.length - 1];
      etiquetas.push({ x: ult.x + 8, y: ult.y + 4, texto: p, c: e.c });
    });
    /* Separa las etiquetas del final para que no se encimen. */
    etiquetas.sort(function (a, b) { return a.y - b.y; });
    for (var k = 1; k < etiquetas.length; k++) {
      if (etiquetas[k].y - etiquetas[k - 1].y < 16) etiquetas[k].y = etiquetas[k - 1].y + 16;
    }
    etiquetas.forEach(function (q) {
      out += '<text x="' + q.x + '" y="' + q.y + '" style="fill:' + q.c + ';font-weight:600">' + esc(q.texto) + "</text>";
    });
    fechas.forEach(function (f, i) {
      out += '<text class="eje" x="' + x(i) + '" y="' + (base + 16) + '" text-anchor="middle">' + fechaCorta(f) + "</text>";
    });
    return svg(W, H, out, nombre);
  }
  function intervalos(filas, nombre) {
    var W = 680, H = 40 + filas.length * 56, left = 200, right = 660, xMax = 16;
    var sx = function (v) { return left + (right - left) * v / xMax; };
    var out = "";
    for (var t = 0; t <= xMax; t += 4) {
      out += '<line x1="' + sx(t) + '" x2="' + sx(t) + '" y1="12" y2="' + (H - 30) + '" style="stroke:var(--rule)"/>';
      out += '<text class="eje" x="' + sx(t) + '" y="' + (H - 12) + '" text-anchor="middle">' + t + "</text>";
    }
    filas.forEach(function (f, i) {
      var cy = 40 + i * 56, col = f.color;
      out += '<g><title>' + esc(f.etiqueta + ": promedio " + dec(f.media) + "; rango probable " + dec(f.ic[0]) + " a " + dec(f.ic[1])) + "</title>";
      out += '<text x="0" y="' + (cy + 5) + '">' + esc(f.etiqueta) + "</text>";
      out += '<line x1="' + sx(f.ic[0]) + '" x2="' + sx(f.ic[1]) + '" y1="' + cy + '" y2="' + cy + '" stroke-width="3" style="stroke:' + col + '"/>';
      out += '<line x1="' + sx(f.ic[0]) + '" x2="' + sx(f.ic[0]) + '" y1="' + (cy - 8) + '" y2="' + (cy + 8) + '" stroke-width="3" style="stroke:' + col + '"/>';
      out += '<line x1="' + sx(f.ic[1]) + '" x2="' + sx(f.ic[1]) + '" y1="' + (cy - 8) + '" y2="' + (cy + 8) + '" stroke-width="3" style="stroke:' + col + '"/>';
      out += '<circle cx="' + sx(f.media) + '" cy="' + cy + '" r="7" style="fill:' + col + '"/>';
      out += '<text x="' + sx(f.media) + '" y="' + (cy - 14) + '" text-anchor="middle" style="font-weight:700">' + dec(f.media) + "</text></g>";
    });
    return svg(W, H, out, nombre);
  }
  function barrasV(items, nombre) {
    var W = 520, H = 230, top = 26, base = 190, left = 14;
    var max = Math.max.apply(null, items.map(function (i) { return i.valor || 0; }).concat([1]));
    var bw = (W - left * 2) / items.length - 28, out = "";
    items.forEach(function (it, i) {
      var x = left + 14 + i * (bw + 28), h = (base - top) * (it.valor || 0) / max;
      out += '<g><title>' + esc(it.etiqueta + ": promedio " + dec(it.valor) + " bolsas (" + it.n + " registros)") + "</title>";
      out += '<rect x="' + x + '" y="' + (base - h) + '" width="' + bw + '" height="' + h + '" style="fill:' + (it.destacado ? "var(--accent)" : "var(--neutral)") + '"/>';
      out += '<text x="' + (x + bw / 2) + '" y="' + (base - h - 8) + '" text-anchor="middle" style="font-weight:700">' + dec(it.valor) + "</text>";
      out += '<text class="eje" x="' + (x + bw / 2) + '" y="' + (base + 20) + '" text-anchor="middle">' + esc(it.etiqueta) + "</text>";
      out += '<text class="eje" x="' + (x + bw / 2) + '" y="' + (base + 38) + '" text-anchor="middle">' + it.n + " registros</text></g>";
    });
    out += '<line x1="' + left + '" x2="' + (W - left) + '" y1="' + base + '" y2="' + base + '" style="stroke:var(--ink2)"/>';
    return svg(W, H, out, nombre);
  }

  /* ---------- Tabla ---------- */
  function tablaHtml(rows) {
    if (!rows.length) return '<tr><td colspan="7" class="muted">No hay registros con estos filtros.</td></tr>';
    return rows.map(function (r) {
      return "<tr><td>" + fechaLarga(r.fecha) + "</td><td>" + esc(r.dia) + "</td><td>" + esc(r.punto) +
        '</td><td class="n">' + entero(r.bolsas) + "</td><td>" + (r.quema ? '<span class="pill">Sí</span>' : "No") +
        "</td><td>" + esc(r.olor) + "</td><td>" + esc(r.polvo) + "</td></tr>";
    }).join("");
  }
  function csv(rows) {
    var cab = ["ID", "Fecha", "Día", "Punto", "Bolsas", "Quema", "Olor", "Polvo"];
    var lineas = [cab.join(";")].concat(rows.map(function (r) {
      return [r.id, r.fecha, r.dia, r.punto, r.bolsas, r.quema ? "Sí" : "No", r.olor, r.polvo].map(function (c) {
        var s = String(c == null ? "" : c);
        return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(";");
    }));
    return "﻿" + lineas.join("\r\n");
  }
  function descargar(nombre, texto) {
    try {
      var blob = new Blob([texto], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    } catch (e) { /* si el navegador bloquea la descarga, la tabla sigue visible */ }
  }

  w.ED = {
    CFG: CFG, PUNTOS: PUNTOS, OLORES: OLORES, POLVOS: POLVOS,
    esc: esc, entero: entero, dec: dec, pct: pct, fechaCorta: fechaCorta, fechaLarga: fechaLarga, hoy: hoy,
    media: media, suma: suma, unicos: unicos, ic95: ic95, icDiferencia: icDiferencia, wilson: wilson,
    cargar: cargar, enviar: enviar,
    filtrar: filtrar, resumen: resumen, porPunto: porPunto, porNivel: porNivel, cruce: cruce, fechasOrdenadas: fechasOrdenadas,
    barrasH: barrasH, columnas: columnas, lineas: lineas, intervalos: intervalos, barrasV: barrasV,
    tablaHtml: tablaHtml, csv: csv, descargar: descargar
  };
})(window);
