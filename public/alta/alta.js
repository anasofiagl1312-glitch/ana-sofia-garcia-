/*
 * Interfaz de la clienta.
 *
 * Entra por el enlace que la operadora le mandó: /alta#<token>. El token va en
 * el fragmento de la URL, que el navegador NO manda al servidor, así que no
 * queda en registros de acceso ni en el historial de ningún intermediario.
 *
 * Habla con las mismas rutas que usaría la app de la Fase 3 (/yo, /mascotas,
 * /proveedores). No hay una API aparte para esto: lo único propio es canjear el
 * enlace por una sesión.
 *
 * Se guarda PASO POR PASO. Si cierra la pestaña a la mitad, lo que llenó ya
 * está guardado, y al volver a abrir el enlace retoma donde iba.
 */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var saludo = document.getElementById("saludo");
  var progreso = document.getElementById("progreso");
  var progresoPasos = document.getElementById("progreso-pasos");

  var sesion = null;
  var estado = {
    clienta: null,
    mascotas: [],
    proveedores: [],
    preferencias: [],
    aplicaciones: [],
    documentos: 0
  };
  var paso = 0;

  var PASOS = ["bienvenida", "mascota", "carnet", "negocios", "avisos", "listo"];

  // ------------------------------------------------------------ utilidades

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function pedir(ruta, opciones) {
    opciones = opciones || {};
    var cabeceras = {};
    if (sesion) cabeceras.Authorization = "Bearer " + sesion;
    if (opciones.body && !opciones.archivo) cabeceras["Content-Type"] = "application/json";

    return fetch(ruta, {
      method: opciones.method || "GET",
      headers: cabeceras,
      body: opciones.archivo ? opciones.body : opciones.body ? JSON.stringify(opciones.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (cuerpo) {
        if (!r.ok) {
          var detalle = cuerpo.detalles
            ? cuerpo.detalles.map(function (d) { return d.mensaje; }).join(" ")
            : "";
          throw new Error(cuerpo.mensaje || detalle || "Algo salió mal. Vuelve a intentar.");
        }
        return cuerpo;
      });
    });
  }

  function valores(formulario) {
    var d = {};
    Array.prototype.forEach.call(formulario.elements, function (el) {
      if (!el.name) return;
      if (el.type === "radio" || el.type === "checkbox") {
        if (el.checked) d[el.name] = el.value;
      } else {
        d[el.name] = el.value.trim();
      }
    });
    return d;
  }

  function ocupado(formulario, si) {
    var b = formulario.querySelector(".boton--principal");
    if (!b) return;
    b.disabled = si;
    if (si) b.setAttribute("aria-busy", "true");
    else b.removeAttribute("aria-busy");
  }

  function mostrarError(formulario, mensaje) {
    var previo = formulario.querySelector(".error");
    if (previo) previo.remove();
    var caja = document.createElement("div");
    caja.className = "error";
    caja.setAttribute("role", "alert");
    caja.textContent = mensaje;
    formulario.insertBefore(caja, formulario.firstChild);
    caja.scrollIntoView({ block: "nearest" });
  }

  function pintarProgreso() {
    if (paso === 0) { progreso.hidden = true; return; }
    progreso.hidden = false;
    progresoPasos.innerHTML = PASOS.slice(1).map(function (_, i) {
      var n = i + 1;
      return "<li" + (n === paso ? ' aria-current="step"' : "") +
        (n < paso ? ' data-hecho="si"' : "") + "></li>";
    }).join("");
  }

  function ir(n) {
    paso = n;
    pintarProgreso();
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  // ---------------------------------------------------------------- pantallas

  function render() {
    var nombre = PASOS[paso];
    if (nombre === "bienvenida") return pantallaBienvenida();
    if (nombre === "mascota") return pantallaMascota();
    if (nombre === "carnet") return pantallaCarnet();
    if (nombre === "negocios") return pantallaNegocios();
    if (nombre === "avisos") return pantallaAvisos();
    return pantallaListo();
  }

  function pantallaBienvenida() {
    var pila = (estado.clienta.nombre || "").split(" ")[0];
    app.innerHTML =
      '<p class="paso__numero">Bienvenida</p>' +
      '<h2 class="paso__titulo">Hola' + (pila ? " " + esc(pila) : "") + "</h2>" +
      '<p class="paso__nota">Vamos a guardar los datos de tu mascota para poder ' +
      "agendarle sus citas y recordártelas a tiempo. Son cuatro pantallas y se " +
      "guarda sola conforme avanzas, así que puedes dejarlo a medias y volver " +
      "con este mismo enlace.</p>" +
      '<div class="nota">Nada es obligatorio salvo el nombre de tu mascota. ' +
      "Lo que no sepas ahora, lo llenamos después.</div>" +
      '<div class="acciones"><button class="boton boton--principal" data-ir="1">Empezar</button></div>';
  }

  function pantallaMascota() {
    var m = estado.mascotas[0] || {};
    app.innerHTML =
      '<p class="paso__numero">Paso 1 de 4</p>' +
      '<h2 class="paso__titulo">Tu mascota</h2>' +
      '<p class="paso__nota">Con esto sabemos a quién le toca cada cita.</p>' +
      '<form data-form="mascota">' +
      campo("Nombre", '<input id="m-nombre" name="nombre" required maxlength="60" placeholder="Lola" value="' + esc(m.nombre || "") + '">') +
      '<div class="pareja">' +
      campo("Especie", select("especie", [["perro", "Perro"], ["gato", "Gato"], ["otra", "Otra"]], m.especie)) +
      campo("Raza", '<input id="m-raza" name="raza" maxlength="60" placeholder="Schnauzer" value="' + esc(m.raza || "") + '">') +
      "</div>" +
      '<div class="pareja">' +
      campo("Peso aproximado", '<input id="m-peso" name="pesoKg" type="number" step="0.5" min="0" max="200" inputmode="decimal" placeholder="8" value="' + esc(m.peso_kg || "") + '">', "En kilos. Si no lo sabes, déjalo vacío.") +
      campo("Sexo", select("sexo", [["desconocido", "Prefiero no decir"], ["hembra", "Hembra"], ["macho", "Macho"]], m.sexo)) +
      "</div>" +
      campo("¿Cuándo nació, más o menos?", '<input id="m-nacimiento" name="nacimiento" type="date" value="' + esc(m.nacimiento || "") + '">', "Un aproximado basta. Sirve para saber qué vacunas le tocan.") +
      campo("¿Está esterilizada?", select("esterilizada", [["", "No sé"], ["si", "Sí"], ["no", "No"]], m.esterilizada === true ? "si" : m.esterilizada === false ? "no" : "")) +
      campo("Lo que el negocio necesita saber",
        '<textarea id="m-notas" name="notasManejo" maxlength="1000" placeholder="Se pone nerviosa con la secadora. Es alérgica al pollo.">' + esc(m.notas_manejo || "") + "</textarea>",
        "Si es nerviosa, si muerde cuando la bañan, si tiene alergias. Se lo decimos al negocio cuando agendamos.") +
      '<div class="acciones">' +
      '<button class="boton boton--callado" type="button" data-ir="0">Atrás</button>' +
      '<button class="boton boton--principal" type="submit">Guardar y seguir</button>' +
      "</div></form>";
  }

  function pantallaCarnet() {
    var m = estado.mascotas[0];
    var lista = estado.aplicaciones.length
      ? '<ul class="lista">' + estado.aplicaciones.map(function (a) {
          return "<li><b>" + esc(a.producto) + "</b>" +
            (a.marca ? " · " + esc(a.marca) : "") +
            "<small>Aplicada el " + esc(fechaLegible(a.fecha_aplicacion)) +
            (a.fecha_refuerzo ? " · refuerzo el " + esc(fechaLegible(a.fecha_refuerzo)) : "") +
            "</small></li>";
        }).join("") + "</ul>"
      : "";

    app.innerHTML =
      '<p class="paso__numero">Paso 2 de 4</p>' +
      '<h2 class="paso__titulo">El carnet de ' + esc(m ? m.nombre : "tu mascota") + "</h2>" +
      '<p class="paso__nota">Para que lo traigas en el celular y no cargues el papelito. ' +
      "También nos sirve para avisarte cuando toque un refuerzo.</p>" +

      '<div class="subida">' +
      '<label class="subida__boton" for="archivo">Tomar foto o subir PDF</label>' +
      '<input type="file" id="archivo" accept="image/*,application/pdf" capture="environment">' +
      '<p class="subida__nota" id="subida-nota">' +
      (estado.documentos
        ? estado.documentos + (estado.documentos === 1 ? " documento guardado" : " documentos guardados")
        : "Fotografía las páginas del carnet. Puedes subir varias.") +
      "</p></div>" +

      '<p class="subtitulo">Vacunas y desparasitaciones</p>' +
      '<p class="paso__nota">Si te animas a capturarlas, te avisamos cuando venza cada una. ' +
      "Si no, con la foto del carnet basta por ahora.</p>" +
      lista +

      '<form data-form="aplicacion">' +
      campo("¿Qué le aplicaron?", '<input id="a-producto" name="producto" maxlength="120" placeholder="Rabia">') +
      '<div class="pareja">' +
      campo("Marca", '<input id="a-marca" name="marca" maxlength="80" placeholder="Nobivac">') +
      campo("Lote", '<input id="a-lote" name="lote" maxlength="60" placeholder="A-4471">') +
      "</div>" +
      '<div class="pareja">' +
      campo("Fecha", '<input id="a-fecha" name="fechaAplicacion" type="date">') +
      campo("Siguiente refuerzo", '<input id="a-refuerzo" name="fechaRefuerzo" type="date">') +
      "</div>" +
      campo("Veterinario", '<input id="a-vet" name="veterinario" maxlength="120" placeholder="Dra. Martínez">') +
      '<div class="acciones">' +
      '<button class="boton boton--callado" type="button" data-ir="1">Atrás</button>' +
      '<button class="boton boton--principal" type="submit">Agregar</button>' +
      "</div>" +
      '<button class="salto" type="button" data-ir="3">Seguir sin capturar vacunas</button>' +
      "</form>";

    var archivo = document.getElementById("archivo");
    if (archivo) archivo.addEventListener("change", subirDocumento);
  }

  function pantallaNegocios() {
    var lista = estado.proveedores.length
      ? '<ul class="lista">' + estado.proveedores.map(function (p) {
          return "<li><b>" + esc(p.negocio) + (p.sucursal ? " " + esc(p.sucursal) : "") + "</b>" +
            "<small>" + esc(RELACION[p.relacion] || "Negocio") +
            (p.telefono ? " · " + esc(p.telefono) : "") + "</small></li>";
        }).join("") + "</ul>"
      : "";

    app.innerHTML =
      '<p class="paso__numero">Paso 3 de 4</p>' +
      '<h2 class="paso__titulo">Tu veterinaria</h2>' +
      '<p class="paso__nota">¿A dónde llevas a tu mascota? Nosotros nos encargamos ' +
      "de hablarles y apartar la cita.</p>" +
      lista +

      '<form data-form="proveedor">' +
      campo("¿Qué es este lugar?", select("relacion", [
        ["veterinaria", "Mi veterinaria"],
        ["estetica", "Donde la baño"],
        ["guarderia", "Guardería"],
        ["paseador", "Paseador"],
        ["otro", "Otro"]
      ])) +
      campo("Nombre del negocio", '<input id="p-negocio" name="negocio" required maxlength="120" placeholder="Veterinaria San Ángel">') +
      campo("Sucursal", '<input id="p-sucursal" name="sucursal" maxlength="120" placeholder="Insurgentes">') +
      campo("Dirección", '<input id="p-direccion" name="direccion" maxlength="300" placeholder="Av. Revolución 1877">') +
      campo("Teléfono o WhatsApp", '<input id="p-telefono" name="telefono" inputmode="tel" maxlength="30" placeholder="55 8765 4321">',
        "Es por donde les vamos a escribir para apartar tu cita.") +
      '<div class="acciones">' +
      '<button class="boton boton--callado" type="button" data-ir="2">Atrás</button>' +
      '<button class="boton boton--principal" type="submit">Agregar</button>' +
      "</div>" +
      '<button class="salto" type="button" data-ir="4">' +
      (estado.proveedores.length ? "Ya están todos, seguir" : "Seguir sin agregar") +
      "</button></form>";
  }

  function pantallaAvisos() {
    var c = estado.clienta;
    app.innerHTML =
      '<p class="paso__numero">Paso 4 de 4</p>' +
      '<h2 class="paso__titulo">Cómo te avisamos</h2>' +
      '<p class="paso__nota">Te escribimos cuatro veces por cita: cuando la apartamos, ' +
      "una semana antes, tres días antes y el mismo día en la mañana.</p>" +

      '<form data-form="avisos">' +
      '<div class="campo"><label>¿Por dónde prefieres?</label><div class="elecciones">' +
      eleccion("canalPreferido", "whatsapp", "WhatsApp", "Al " + esc(c.celular), c.canalPreferido) +
      eleccion("canalPreferido", "correo", "Correo electrónico", "", c.canalPreferido) +
      eleccion("canalPreferido", "ambos", "Los dos", "Por si se te pasa uno", c.canalPreferido) +
      "</div></div>" +

      campo("Tu correo", '<input id="c-correo" name="correo" type="email" inputmode="email" maxlength="200" placeholder="maria@ejemplo.com" value="' + esc(c.correo || "") + '">',
        "Solo hace falta si elegiste correo.") +

      campo("¿A qué hora quieres el aviso del día?",
        '<input id="c-hora" name="horaAvisoDia" type="time" value="' + esc(c.horaAvisoDia || "08:00") + '">',
        "El de la mañana del día de la cita.") +

      '<p class="subtitulo">Cuándo te queda bien llevarla</p>' +
      '<p class="paso__nota">Cuando toque agendar, te proponemos días de éstos. ' +
      "Si no marcas nada, te proponemos cualquier día hábil.</p>" +
      '<div class="campo"><div class="elecciones">' +
      DIAS.map(function (d) {
        var marcado = estado.preferencias.some(function (p) { return p.diaSemana === d[0]; });
        return '<label class="eleccion"><input type="checkbox" name="dia" value="' + d[0] + '"' +
          (marcado ? " checked" : "") + '><span class="eleccion__texto">' + d[1] + "</span></label>";
      }).join("") + "</div></div>" +

      '<div class="pareja">' +
      campo("Desde", '<input id="f-inicio" name="horaInicio" type="time" value="' + esc(franjaGuardada("horaInicio") || "10:00") + '">') +
      campo("Hasta", '<input id="f-fin" name="horaFin" type="time" value="' + esc(franjaGuardada("horaFin") || "14:00") + '">') +
      "</div>" +

      '<div class="acciones">' +
      '<button class="boton boton--callado" type="button" data-ir="3">Atrás</button>' +
      '<button class="boton boton--principal" type="submit">Guardar</button>' +
      "</div></form>";
  }

  function pantallaListo() {
    var m = estado.mascotas[0];
    var c = estado.clienta;
    app.innerHTML =
      '<div class="listo">' +
      '<h2 class="listo__titulo">Listo</h2>' +
      "<p>Ya tenemos todo. A partir de aquí nosotros te buscamos: te vamos a " +
      "escribir con tiempo para preguntarte qué día te acomoda, y de ahí nos " +
      "encargamos del resto.</p>" +

      '<div class="resumen"><dl>' +
      (m ? "<dt>Mascota</dt><dd>" + esc(m.nombre) +
        (m.raza ? " · " + esc(m.raza) : "") + "</dd>" : "") +
      "<dt>Carnet</dt><dd>" +
      (estado.documentos ? estado.documentos + " documento(s)" : "Sin documentos") +
      (estado.aplicaciones.length ? " · " + estado.aplicaciones.length + " aplicación(es)" : "") +
      "</dd>" +
      "<dt>Negocios</dt><dd>" +
      (estado.proveedores.length
        ? estado.proveedores.map(function (p) { return esc(p.negocio); }).join(", ")
        : "Ninguno todavía") + "</dd>" +
      "<dt>Avisos</dt><dd>" + esc(CANAL[c.canalPreferido] || "WhatsApp") + "</dd>" +
      "</dl></div>" +

      '<button class="salto" type="button" data-ir="1">Corregir algo</button>' +
      "</div>";
  }

  // ------------------------------------------------------------- fragmentos

  function campo(etiqueta, control, ayuda) {
    var id = (control.match(/id="([^"]+)"/) || [])[1] || "";
    return '<div class="campo"><label' + (id ? ' for="' + id + '"' : "") + ">" + etiqueta + "</label>" +
      control + (ayuda ? '<span class="campo__ayuda">' + ayuda + "</span>" : "") + "</div>";
  }

  function select(nombre, opciones, elegido) {
    return '<select id="' + nombre + '-sel" name="' + nombre + '">' +
      opciones.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' +
          (String(elegido || "") === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select>";
  }

  function eleccion(nombre, valor, titulo, nota, elegido) {
    return '<label class="eleccion"><input type="radio" name="' + nombre + '" value="' + valor + '"' +
      (elegido === valor ? " checked" : "") + '><span class="eleccion__texto">' + titulo +
      (nota ? "<small>" + nota + "</small>" : "") + "</span></label>";
  }

  var DIAS = [[1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"],
              [5, "Viernes"], [6, "Sábado"], [7, "Domingo"]];
  var RELACION = { veterinaria: "Mi veterinaria", estetica: "Donde la baño",
                   guarderia: "Guardería", paseador: "Paseador", otro: "Negocio" };
  var CANAL = { whatsapp: "Por WhatsApp", correo: "Por correo", ambos: "Por WhatsApp y correo" };
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function fechaLegible(iso) {
    var p = String(iso || "").slice(0, 10).split("-");
    if (p.length !== 3) return "—";
    return Number(p[2]) + " de " + MESES[Number(p[1]) - 1] + " de " + p[0];
  }

  function franjaGuardada(cual) {
    var p = estado.preferencias[0];
    return p ? String(p[cual]).slice(0, 5) : null;
  }

  // ---------------------------------------------------------------- guardado

  function subirDocumento(e) {
    var archivo = e.target.files && e.target.files[0];
    if (!archivo) return;
    var nota = document.getElementById("subida-nota");
    var m = estado.mascotas[0];
    if (!m) { nota.textContent = "Primero guarda a tu mascota."; return; }

    nota.textContent = "Subiendo…";
    var cuerpo = new FormData();
    cuerpo.append("tipo", "carnet");
    cuerpo.append("archivo", archivo);

    pedir("/mascotas/" + m.id + "/documentos", { method: "POST", body: cuerpo, archivo: true })
      .then(function () {
        estado.documentos += 1;
        nota.textContent = estado.documentos +
          (estado.documentos === 1 ? " documento guardado" : " documentos guardados");
        e.target.value = "";
      })
      .catch(function (err) { nota.textContent = err.message; });
  }

  app.addEventListener("click", function (e) {
    var b = e.target.closest("[data-ir]");
    if (b) { e.preventDefault(); ir(Number(b.dataset.ir)); }
  });

  app.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    var tipo = f.dataset.form;
    var d = valores(f);
    ocupado(f, true);

    var trabajo;

    if (tipo === "mascota") {
      var cuerpo = {
        nombre: d.nombre,
        especie: d.especie || "perro",
        raza: d.raza || null,
        pesoKg: d.pesoKg ? Number(d.pesoKg) : null,
        sexo: d.sexo || "desconocido",
        notasManejo: d.notasManejo || null
      };
      if (d.nacimiento) cuerpo.nacimiento = d.nacimiento;
      if (d.esterilizada === "si") cuerpo.esterilizada = true;
      if (d.esterilizada === "no") cuerpo.esterilizada = false;

      var existente = estado.mascotas[0];
      trabajo = existente
        ? pedir("/mascotas/" + existente.id, { method: "PATCH", body: cuerpo })
            .then(function () { Object.assign(existente, cuerpo, { nombre: cuerpo.nombre }); })
        : pedir("/mascotas", { method: "POST", body: cuerpo })
            .then(function (r) { estado.mascotas.unshift(Object.assign({ id: r.id }, cuerpo)); });
      trabajo = trabajo.then(function () { ir(2); });

    } else if (tipo === "aplicacion") {
      if (!d.producto || !d.fechaAplicacion) {
        ocupado(f, false);
        mostrarError(f, "Necesitamos al menos qué le aplicaron y en qué fecha.");
        return;
      }
      trabajo = pedir("/mascotas/" + estado.mascotas[0].id + "/aplicaciones", {
        method: "POST",
        body: {
          producto: d.producto,
          marca: d.marca || null,
          lote: d.lote || null,
          fechaAplicacion: d.fechaAplicacion,
          fechaRefuerzo: d.fechaRefuerzo || null,
          veterinario: d.veterinario || null
        }
      }).then(function () {
        estado.aplicaciones.push({
          producto: d.producto, marca: d.marca,
          fecha_aplicacion: d.fechaAplicacion, fecha_refuerzo: d.fechaRefuerzo
        });
        render();
      });

    } else if (tipo === "proveedor") {
      trabajo = pedir("/proveedores", {
        method: "POST",
        body: {
          negocio: d.negocio,
          sucursal: d.sucursal || null,
          direccion: d.direccion || null,
          telefono: d.telefono || null,
          whatsapp: d.telefono || null,
          relacion: d.relacion || "otro"
        }
      }).then(function (r) {
        estado.proveedores.push({
          id: r.id, negocio: d.negocio, sucursal: d.sucursal,
          telefono: d.telefono, relacion: d.relacion
        });
        render();
      });

    } else {
      var dias = [];
      Array.prototype.forEach.call(f.querySelectorAll('input[name="dia"]:checked'), function (el) {
        dias.push(Number(el.value));
      });

      var perfil = { horaAvisoDia: d.horaAvisoDia, canalPreferido: d.canalPreferido || "whatsapp" };
      if (d.correo) perfil.correo = d.correo;

      trabajo = pedir("/yo", { method: "PATCH", body: perfil })
        .then(function () {
          return pedir("/yo/preferencias", {
            method: "PUT",
            body: {
              preferencias: dias.map(function (dia, i) {
                return {
                  diaSemana: dia,
                  horaInicio: d.horaInicio || "10:00",
                  horaFin: d.horaFin || "14:00",
                  prioridad: i + 1
                };
              })
            }
          });
        })
        .then(function () { return pedir("/alta/api/listo", { method: "POST" }); })
        .then(function () {
          estado.clienta.canalPreferido = perfil.canalPreferido;
          estado.clienta.correo = perfil.correo || estado.clienta.correo;
          estado.clienta.horaAvisoDia = perfil.horaAvisoDia;
          estado.preferencias = dias.map(function (dia) {
            return { diaSemana: dia, horaInicio: d.horaInicio, horaFin: d.horaFin };
          });
          ir(5);
        });
    }

    trabajo.catch(function (err) { mostrarError(f, err.message); })
      .then(function () { ocupado(f, false); });
  });

  // -------------------------------------------------------------- arranque

  function arrancar() {
    var token = window.location.hash.replace(/^#/, "");
    if (!token) {
      app.innerHTML = '<div class="error">Falta el enlace completo. ' +
        "Ábrelo tal como te lo mandaron, sin recortarlo.</div>";
      return;
    }

    pedir("/alta/api/sesion", { method: "POST", body: { token: token } })
      .then(function (r) {
        sesion = r.sesion;
        estado.clienta = r.clienta;
        estado.mascotas = r.mascotas || [];
        estado.proveedores = r.proveedores || [];
        estado.preferencias = r.preferencias || [];

        var pila = (r.clienta.nombre || "").split(" ")[0];
        saludo.textContent = pila ? "Los datos de " + pila : "Tus datos";

        // El enlace deja de estar en la barra en cuanto se canjea, para que no
        // se quede a la vista si le pasa el teléfono a alguien.
        history.replaceState(null, "", window.location.pathname);

        if (estado.mascotas.length) {
          return pedir("/mascotas/" + estado.mascotas[0].id + "/carnet")
            .then(function (carnet) {
              estado.aplicaciones = carnet.aplicaciones || [];
              estado.documentos = (carnet.documentos || []).length;
            })
            .catch(function () { /* el carnet vacío no impide seguir */ });
        }
      })
      .then(function () { ir(0); })
      .catch(function (err) {
        app.innerHTML = '<div class="error">' + esc(err.message) + "</div>";
      });
  }

  arrancar();
})();
