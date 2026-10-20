/* ============================================================
   EcoData · Registro de observaciones (Google Apps Script)
   Cambia CLAVE por una clave que solo conozca el equipo.
   Después de cada cambio: Implementar > Administrar implementaciones > Versión nueva.
   ============================================================ */
var CLAVE = "Eco12345";
var HOJA = "Observaciones";
var PUNTOS = ["Portería", "Esquina", "Patio"];
var OLORES = ["No", "Leve", "Fuerte"];
var POLVOS = ["Bajo", "Medio", "Alto"];
var CABECERA = ["ID", "Fecha", "Día", "Punto", "Bolsas", "Quema", "Olor", "Polvo", "Anotó", "Creado"];
var DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/* Lectura pública: ?datos=1 devuelve las observaciones sin el nombre de quien anotó. */
function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.datos) {
    try {
      return salida({ ok: true, datos: leerDatos() });
    } catch (err) {
      return salida({ ok: false, error: "No pude leer la hoja " + HOJA + ": " + err.message });
    }
  }
  return salida({ ok: true, mensaje: "Registro de EcoData activo." });
}

/* Escritura: el cuerpo llega como texto JSON con la clave del equipo. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var p = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (String(p.clave || "") !== CLAVE) return salida({ ok: false, error: "Clave incorrecta." });
    var accion = String(p.accion || "registrar");
    if (accion === "verificar") return salida({ ok: true, mensaje: "Clave correcta." });
    if (accion === "registrar") return salida(registrar(p));
    if (accion === "actualizar") return salida(actualizar(p));
    if (accion === "borrar") return salida(borrar(p));
    return salida({ ok: false, error: "Acción no reconocida: " + accion });
  } catch (err) {
    return salida({ ok: false, error: "Error en el servidor: " + err.message });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hoja() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(HOJA);
  if (!h) {
    h = ss.insertSheet(HOJA);
    h.getRange(1, 1, 1, CABECERA.length).setValues([CABECERA]).setFontWeight("bold");
    h.setFrozenRows(1);
  }
  return h;
}

function texto(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  return String(v == null ? "" : v).trim();
}

function leerDatos() {
  var h = hoja();
  var ultima = h.getLastRow();
  if (ultima < 2) return [];
  var filas = h.getRange(2, 1, ultima - 1, CABECERA.length).getValues();
  return filas.filter(function (f) { return texto(f[0]) !== ""; }).map(function (f) {
    return {
      id: texto(f[0]), fecha: texto(f[1]), dia: texto(f[2]), punto: texto(f[3]),
      bolsas: Number(f[4]) || 0, quema: texto(f[5]) === "Sí", olor: texto(f[6]), polvo: texto(f[7])
    };
  });
}

function validar(p) {
  var fecha = texto(p.fecha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return "La fecha debe tener formato AAAA-MM-DD.";
  var d = new Date(fecha + "T12:00:00");
  if (isNaN(d.getTime())) return "La fecha no existe en el calendario.";
  if (PUNTOS.indexOf(texto(p.punto)) < 0) return "El punto debe ser: " + PUNTOS.join(", ") + ".";
  var b = Number(p.bolsas);
  if (p.bolsas === "" || p.bolsas == null || isNaN(b) || b < 0 || b > 500 || Math.floor(b) !== b) return "Las bolsas deben ser un número entero entre 0 y 500.";
  if (OLORES.indexOf(texto(p.olor)) < 0) return "El olor debe ser: " + OLORES.join(", ") + ".";
  if (POLVOS.indexOf(texto(p.polvo)) < 0) return "El polvo debe ser: " + POLVOS.join(", ") + ".";
  return "";
}

function filaDesde(p, id) {
  var d = new Date(texto(p.fecha) + "T12:00:00");
  return [id, texto(p.fecha), DIAS[d.getDay()], texto(p.punto), Number(p.bolsas),
          (p.quema === true || texto(p.quema) === "Sí" || texto(p.quema) === "true") ? "Sí" : "No",
          texto(p.olor), texto(p.polvo), texto(p.anoto).slice(0, 60),
          Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm")];
}

/* Busca la fila de una tarde y punto. Devuelve el número de fila de la hoja o 0. */
function buscarClave(h, fecha, punto, ignorarId) {
  var ultima = h.getLastRow();
  if (ultima < 2) return 0;
  var filas = h.getRange(2, 1, ultima - 1, CABECERA.length).getValues();
  for (var i = 0; i < filas.length; i++) {
    if (texto(filas[i][0]) === ignorarId) continue;
    if (texto(filas[i][1]) === fecha && texto(filas[i][3]) === punto) return i + 2;
  }
  return 0;
}

function siguienteId(h) {
  var ultima = h.getLastRow(), max = 0;
  if (ultima >= 2) {
    h.getRange(2, 1, ultima - 1, 1).getValues().forEach(function (f) {
      var n = parseInt(texto(f[0]).replace(/\D/g, ""), 10);
      if (n > max) max = n;
    });
  }
  return "E" + ("00" + (max + 1)).slice(-2);
}

function registrar(p) {
  var err = validar(p);
  if (err) return { ok: false, error: err };
  var h = hoja();
  var fecha = texto(p.fecha), punto = texto(p.punto);
  if (buscarClave(h, fecha, punto, "")) {
    return { ok: false, error: "Ya hay un registro de " + punto + " para esa fecha. Edítalo en vez de crear otro." };
  }
  var id = siguienteId(h);
  h.appendRow(filaDesde(p, id));
  return { ok: true, id: id, mensaje: "Registro guardado." };
}

function actualizar(p) {
  var err = validar(p);
  if (err) return { ok: false, error: err };
  var h = hoja();
  var id = texto(p.id);
  var ultima = h.getLastRow();
  var fila = 0;
  if (ultima >= 2) {
    var ids = h.getRange(2, 1, ultima - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (texto(ids[i][0]) === id) { fila = i + 2; break; }
  }
  if (!fila) return { ok: false, error: "No encuentro el registro " + id + "." };
  var fecha = texto(p.fecha), punto = texto(p.punto);
  if (buscarClave(h, fecha, punto, id)) {
    return { ok: false, error: "Ya hay otro registro de " + punto + " para esa fecha." };
  }
  var anterior = h.getRange(fila, 1, 1, CABECERA.length).getValues()[0];
  var nueva = filaDesde(p, id);
  nueva[9] = texto(anterior[9]);
  if (!texto(p.anoto)) nueva[8] = texto(anterior[8]);
  h.getRange(fila, 1, 1, CABECERA.length).setValues([nueva]);
  return { ok: true, id: id, mensaje: "Registro actualizado." };
}

function borrar(p) {
  var h = hoja();
  var id = texto(p.id);
  var ultima = h.getLastRow();
  if (ultima >= 2) {
    var ids = h.getRange(2, 1, ultima - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (texto(ids[i][0]) === id) { h.deleteRow(i + 2); return { ok: true, mensaje: "Registro borrado." }; }
    }
  }
  return { ok: false, error: "No encuentro el registro " + id + "." };
}

/* Prueba rápida desde el editor de Apps Script: ejecuta esta función y mira el registro en la hoja. */
function pruebaLectura() {
  Logger.log(JSON.stringify(leerDatos().slice(0, 3)));
}
