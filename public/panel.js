/*
 * Panel interno de Huella.
 *
 * La estructura, el comportamiento y los textos vienen de
 * docs/referencia-panel.html, el panel que el equipo ya usa. La diferencia de
 * fondo es de dónde salen los datos: aquel guardaba en una base del navegador y
 * redactaba los mensajes por su cuenta; éste habla con /panel/api contra la
 * base de datos real.
 *
 * Por eso los mensajes NO se arman aquí. El texto de cada aviso llega ya
 * redactado por el servidor, con los mismos composers que usa el envío
 * automático (src/modules/mensajes/contenido.ts). Si el panel los volviera a
 * escribir, la operadora leería en pantalla una cosa y la clienta recibiría
 * otra, que es justo lo que la arquitectura evita.
 *
 * Sin compilador ni empaquetador: son tres archivos que el mismo Fastify sirve.
 * Para un panel que usan tres personas, una cadena de herramientas de frontend
 * cuesta más de lo que ahorra.
 */
(function () {
  "use strict";

  var API = "/panel/api";
  var LLAVE = "huella.credencial";

  var credencial = null;
  /* Si ya entró o sigue en la pantalla de acceso. Cambia qué significa un 401. */
  var dentro = false;
  var tab = "hoy";
  var datos = { avisos: null, clientas: null, citas: null, numeros: null, rutinas: null };
  var detalles = {};      // expediente de cada clienta, ya traído
  var abiertas = {};      // acordeones de clientas abiertos
  var forms = {};         // formularios visibles
  var cargando = false;
  var avisoPendiente = null;   // se pinta una vez en el siguiente render

  var app = document.getElementById("app");
  var panel = document.getElementById("panel");
  var acceso = document.getElementById("acceso");

  // ------------------------------------------------------------ fechas

  var DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function parse(s) {
    if (!s) return null;
    var p = String(s).slice(0, 10).split("-");
    if (p.length !== 3) return null;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function largo(s) {
    var d = parse(s);
    if (!d) return "—";
    return DIAS[d.getDay()] + " " + d.getDate() + " de " + MESES[d.getMonth()];
  }

  function corto(s) {
    var d = parse(s);
    if (!d) return "—";
    return d.getDate() + " " + MESES[d.getMonth()].slice(0, 3);
  }

  /** Fecha y hora de un instante, en la zona de la clienta. */
  function fechaHora(iso, zona) {
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    var f = new Intl.DateTimeFormat("es-MX", {
      weekday: "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZone: zona || "America/Mexico_City"
    }).format(d);
    return f.replace(",", "");
  }

  function dinero(n) {
    if (n === "" || n === null || n === undefined || isNaN(n)) return "por confirmar";
    return "$" + Number(n).toLocaleString("es-MX");
  }

  // ------------------------------------------------------------ utilidades

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function tel(w) {
    var d = String(w || "").replace(/\D/g, "");
    if (d.length === 10) d = "52" + d;
    return d;
  }

  function waLink(numero, texto) {
    return "https://wa.me/" + tel(numero) + "?text=" + encodeURIComponent(texto);
  }

  function toast(msg) {
    var t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function vals(obj) { return Object.keys(obj).map(function (k) { return obj[k]; }); }

  // ------------------------------------------------------------ red

  function pedir(ruta, opciones) {
    opciones = opciones || {};
    var cabeceras = { Authorization: "Bearer " + credencial };
    if (opciones.body) cabeceras["Content-Type"] = "application/json";

    return fetch(API + ruta, {
      method: opciones.method || "GET",
      headers: cabeceras,
      body: opciones.body ? JSON.stringify(opciones.body) : undefined
    }).catch(function () {
      // fetch solo se rompe así cuando no hay nadie del otro lado. Decirlo,
      // porque "Failed to fetch" no le dice a nadie qué hacer.
      throw new Error("No encontré el servidor en " + window.location.origin +
        ". Revisa que «npm run dev» siga corriendo en la terminal.");
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (cuerpo) {
        if (r.status === 401) {
          // Solo se cierra la sesión si había una. Durante el acceso, un 401 es
          // la respuesta a lo que acaba de teclear, no una sesión que se venció:
          // sacarla a la pantalla de acceso donde ya está, y encima decirle que
          // "la sesión se cerró", no explica nada.
          if (dentro) {
            salir();
            throw new Error("La sesión se cerró. Vuelve a entrar.");
          }
          throw new Error(cuerpo.mensaje || "Credencial inválida.");
        }
        if (!r.ok) {
          var detalle = cuerpo.detalles
            ? cuerpo.detalles.map(function (d) { return d.campo + ": " + d.mensaje; }).join(" · ")
            : "";
          throw new Error(cuerpo.mensaje || detalle || "Algo salió mal.");
        }
        return cuerpo;
      });
    });
  }

  // ------------------------------------------------------------ acceso

  function entrar(correo, clave) {
    var cred = btoa(correo + ":" + clave);
    var previa = credencial;
    credencial = cred;
    return pedir("/numeros").then(function () {
      try { sessionStorage.setItem(LLAVE, cred); } catch (e) { /* modo privado */ }
      mostrarPanel();
    }).catch(function (e) {
      credencial = previa;
      throw e;
    });
  }

  function salir() {
    credencial = null;
    dentro = false;
    try { sessionStorage.removeItem(LLAVE); } catch (e) { /* nada */ }
    datos = { avisos: null, clientas: null, citas: null, numeros: null };
    panel.hidden = true;
    acceso.hidden = false;
  }

  function mostrarPanel() {
    dentro = true;
    acceso.hidden = true;
    panel.hidden = false;
    cargar();
  }

  // ------------------------------------------------------------ carga

  function cargar() {
    cargando = true;
    render();

    var peticion =
      tab === "hoy" ? pedir("/avisos-hoy").then(function (d) { datos.avisos = d; }) :
      tab === "clientas" ? pedir("/clientas").then(function (d) { datos.clientas = d.clientas; }) :
      tab === "citas" ? Promise.all([
        pedir("/citas").then(function (d) { datos.citas = d.citas; }),
        pedir("/rutinas").then(function (d) { datos.rutinas = d.rutinas; })
      ]) :
      pedir("/numeros").then(function (d) { datos.numeros = d; });

    peticion.catch(function (e) {
      app.innerHTML = '<div class="banner mal">' + esc(e.message) + "</div>";
    }).then(function () {
      cargando = false;
      render();
    });
  }

  // ------------------------------------------------------------ render

  function render() {
    if (cargando && !datosDeLaPestana()) {
      app.innerHTML = '<div class="empty"><p>Cargando…</p></div>';
      return;
    }
    if (tab === "hoy") return renderHoy();
    if (tab === "clientas") return renderClientas();
    if (tab === "citas") return renderCitas();
    return renderNumeros();
  }

  /** Saca el aviso que quedó de la última acción, si lo hay. Se pinta una vez. */
  function bannerPendiente() {
    if (!avisoPendiente) return "";
    var html = '<div class="banner mal">' + esc(avisoPendiente) + "</div>";
    avisoPendiente = null;
    return html;
  }

  function datosDeLaPestana() {
    if (tab === "hoy") return datos.avisos;
    if (tab === "clientas") return datos.clientas;
    if (tab === "citas") return datos.citas;
    return datos.numeros;
  }

  // ------------------------------------------------------------ Hoy

  function tarjetaAviso(a, i) {
    var kind = ETIQUETA[a.momento] || a.momento;
    var enviado = ["enviado", "entregado", "leido"].indexOf(a.estado) !== -1;

    var meta = a.servicio + " · " + a.proveedor + " · programado " + a.horaProgramada;

    if (a.problema) {
      return '<div class="card">' +
        '<span class="card-kind">' + esc(kind) + "</span>" +
        "<h3>" + esc(a.clienta || a.celular) + " · " + esc(a.mascota) + "</h3>" +
        '<p class="meta">' + esc(meta) + "</p>" +
        '<div class="banner mal">No se pudo redactar este aviso: ' + esc(a.problema) + "</div></div>";
    }

    var acciones = enviado
      ? '<span class="pill gris">Enviado</span>'
      : '<button class="btn quiet" data-accion="enviado" data-arg="' + esc(a.id) +
        '" data-canal="' + esc(a.canalPreferido === "correo" ? "correo" : "whatsapp") +
        '">Marcar enviado</button>';

    if (a.momento === "cierre" && !enviado) {
      acciones += '<button class="btn quiet" data-accion="cumplida" data-arg="' + esc(a.citaId) + '">Marcar cumplida</button>';
    }

    return '<div class="card' + (a.atrasado ? " atrasada" : "") + '">' +
      '<span class="card-kind' + (EN_GRIS.indexOf(a.momento) !== -1 ? " verde" : "") + '">' +
        esc(kind) + (a.atrasado ? " · atrasado" : "") + "</span>" +
      "<h3>" + esc(a.clienta || "Sin nombre") + " · " + esc(a.mascota) + "</h3>" +
      '<p class="meta">' + esc(meta) + "</p>" +
      (a.asunto && a.canalPreferido !== "whatsapp"
        ? '<p class="meta"><b>Asunto:</b> ' + esc(a.asunto) + "</p>" : "") +
      '<div class="preview" id="prev-' + i + '">' + esc(a.texto) + "</div>" +
      '<div class="row">' +
      // El botón principal es el canal que ella prefirió; el otro, si lo hay,
      // queda al lado por si no contesta.
      (a.canalPreferido === "correo" && a.enlaceCorreo
        ? '<a class="btn primary" href="' + esc(a.enlaceCorreo) + '">Abrir correo</a>'
        : '<a class="btn primary" target="_blank" rel="noopener" href="' + esc(a.enlaceWhatsApp) + '">Abrir WhatsApp</a>') +
      (a.canalPreferido === "ambos" && a.enlaceCorreo
        ? '<a class="btn" href="' + esc(a.enlaceCorreo) + '">Abrir correo</a>' : "") +
      (a.canalPreferido === "correo" && a.enlaceCorreo
        ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(a.enlaceWhatsApp) + '">Abrir WhatsApp</a>' : "") +
      '<button class="btn" data-accion="copiar" data-arg="prev-' + i + '">Copiar</button>' +
      acciones + "</div></div>";
  }

  var ETIQUETA = {
    t_21: "Preguntar fecha",
    t_7: "Aviso de 7 días",
    t_3: "Aviso de 3 días",
    t_0: "Aviso del día",
    cierre: "Cerrar y programar"
  };
  var EN_GRIS = ["t_0"];

  function renderHoy() {
    var d = datos.avisos;
    if (!d) { app.innerHTML = '<div class="empty"><p>Cargando…</p></div>'; return; }

    var pendientes = d.avisos.filter(function (a) {
      return ["programado", "fallido", "enviando"].indexOf(a.estado) !== -1;
    });

    if (!d.avisos.length) {
      var hayClientas = datos.clientas ? datos.clientas.length : null;
      if (hayClientas === 0) {
        app.innerHTML = '<div class="empty"><h2>Todavía no hay nadie</h2>' +
          "<p>Da de alta a tu primera clienta y sus rutinas. A partir de ahí, este panel te va a ir diciendo qué toca cada día.</p>" +
          '<button class="btn primary" data-accion="irClientas">Dar de alta una clienta</button></div>';
      } else {
        app.innerHTML = '<div class="empty"><h2>Todo al corriente</h2>' +
          "<p>No hay ningún aviso pendiente por mandar hoy.</p></div>";
      }
      return;
    }

    var encabezado = "";
    if (pendientes.length) {
      encabezado = '<div class="banner">Tienes <b>' + pendientes.length +
        (pendientes.length === 1 ? " pendiente" : " pendientes") +
        "</b>. Abre WhatsApp, manda el mensaje y marca que ya lo enviaste." +
        (d.atrasados ? " <b>" + d.atrasados + "</b> " +
          (d.atrasados === 1 ? "va atrasado" : "van atrasados") + "." : "") +
        "</div>";
    } else {
      encabezado = '<div class="banner">Ya salieron todos los avisos de hoy.</div>';
    }

    app.innerHTML = encabezado + d.avisos.map(tarjetaAviso).join("");
  }

  // ------------------------------------------------------------ Clientas

  function renderClientas() {
    var cs = datos.clientas;
    if (!cs) { app.innerHTML = '<div class="empty"><p>Cargando…</p></div>'; return; }

    var html = forms.clienta
      ? formAlta()
      : '<div class="row" style="margin-bottom:16px">' +
        '<button class="btn primary" data-accion="form" data-arg="clienta">+ Nueva clienta</button></div>';

    if (!cs.length && !forms.clienta) {
      html += '<div class="empty"><p>Aquí van a aparecer tus clientas, sus mascotas y las rutinas de cada una.</p></div>';
    }

    cs.forEach(function (c) {
      var abierta = !!abiertas[c.id];
      html += '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline">' +
        "<div><h3>" + esc(c.nombre || "Sin nombre") +
          '<span class="pill' + (c.estado === "activa" ? "" : " gris") + '">' + esc(ESTADO[c.estado] || c.estado) + "</span>" +
          (c.celularVerificado ? "" : '<span class="pill gris">Sin verificar</span>') +
        "</h3>" +
        '<p class="meta">' + esc(c.celular) +
          " · " + c.mascotas.length + (c.mascotas.length === 1 ? " mascota" : " mascotas") +
          " · " + c.rutinasActivas + (c.rutinasActivas === 1 ? " rutina" : " rutinas") +
          (c.proximaFecha ? " · toca " + corto(c.proximaFecha) : "") + "</p></div>" +
        '<button class="btn quiet" data-accion="toggle" data-arg="' + esc(c.id) + '">' +
          (abierta ? "Cerrar" : "Ver") + "</button></div>" +
        '<div class="row" style="margin-top:10px">' +
        '<button class="btn quiet" data-accion="invitar" data-arg="' + esc(c.id) + '">' +
          (c.invitacion && c.invitacion.tiene ? "Nuevo enlace de alta" : "Enlace de alta") + "</button>" +
        estadoDeInvitacion(c.invitacion) + "</div>";

      if (abierta) html += expediente(c.id);
      html += "</div>";
    });

    app.innerHTML = html;
  }

  /**
   * Qué pasó con el enlace que se le mandó a la clienta.
   *
   * Se muestra porque es lo que dice si hay que insistirle: uno mandado y
   * nunca abierto no es lo mismo que uno abierto y dejado a medias.
   */
  function estadoDeInvitacion(inv) {
    if (!inv || !inv.tiene) return "";
    if (inv.completadaEn) return '<span class="pill">Alta completada</span>';
    if (inv.vencida) return '<span class="pill gris">Enlace vencido</span>';
    if (inv.abiertaEn) return '<span class="pill">Lo abrió, sin terminar</span>';
    return '<span class="pill gris">Enlace sin abrir</span>';
  }

  var ESTADO = {
    prueba: "Prueba",
    activa: "Pagando",
    pago_pendiente: "Pago pendiente",
    cancelada: "Baja",
    no_acepto: "No aceptó"
  };

  /**
   * Expediente de una clienta: sus mascotas con lo que el negocio necesita
   * saber, sus rutinas y sus últimas tres citas.
   *
   * Se pide sólo al abrir el acordeón. Traerlo para todas al listar sería una
   * consulta por clienta que casi nadie va a mirar.
   */
  function expediente(id) {
    var d = detalles[id];
    if (!d) {
      pedir("/clientas/" + id)
        .then(function (r) { detalles[id] = r; render(); })
        .catch(function (e) { detalles[id] = { error: e.message }; render(); });
      return '<div class="sub"><div class="item-s">Cargando expediente…</div></div>';
    }
    if (d.error) return '<div class="sub"><div class="banner mal">' + esc(d.error) + "</div></div>";

    var html = '<div class="sub">';

    html += '<div class="item"><div class="item-t">Mascotas</div>';
    if (!d.mascotas.length) {
      html += '<div class="item-s">Sin mascotas registradas.</div>';
    }
    d.mascotas.forEach(function (m) {
      var ficha = [m.especie, m.raza, m.pesoKg ? m.pesoKg + " kg" : ""].filter(Boolean).join(" · ");
      html += '<div class="item-s" style="margin-top:6px"><b>' + esc(m.nombre) + "</b>" +
        (ficha ? " · " + esc(ficha) : "") +
        (m.notasManejo ? '<br><span style="font-style:italic">Manejo: ' + esc(m.notasManejo) + "</span>" : "") +
        "</div>";
    });
    html += "</div>";

    html += '<div class="item"><div class="item-t">Rutinas</div>';
    if (!d.rutinas.length) {
      html += '<div class="item-s">Sin rutinas.</div>';
    }
    d.rutinas.forEach(function (r) {
      html += '<div class="item-s" style="margin-top:6px">↳ <b>' + esc(r.servicio) + "</b> de " +
        esc(r.mascota) + " en " + esc(r.proveedor) +
        " · " + esc(r.periodicidad) +
        " · " + esc(dinero(r.costoReferencia)) +
        " · toca " + esc(corto(r.proximaFechaEstimada)) +
        (r.activa ? "" : ' <span class="pill gris">Pausada</span>') + "</div>";
    });
    html += "</div>";

    html += '<div class="item"><div class="item-t">Últimas citas</div>';
    if (!d.ultimasCitas.length) {
      html += '<div class="item-s">Todavía no hay citas.</div>';
    }
    d.ultimasCitas.forEach(function (ct) {
      var costo = ct.costoReal != null
        ? dinero(ct.costoReal) + " pagados"
        : dinero(ct.costoConfirmado);
      html += '<div class="item-s" style="margin-top:6px">' +
        esc(fechaHora(ct.fecha, d.clienta.zonaHoraria)) + " · " + esc(ct.servicio) + " de " + esc(ct.mascota) +
        "<br>" + esc(ct.proveedor) + " · " + esc(ESTADO_CITA[ct.estado] || ct.estado) + " · " + esc(costo) +
        "</div>";
    });
    html += "</div>";

    html += '<div class="item-s" style="margin-top:10px">Zona horaria: ' + esc(d.clienta.zonaHoraria) +
      " · aviso del día a las " + esc(String(d.clienta.horaAvisoDia).slice(0, 5)) + "</div>";

    return html + "</div>";
  }

  /**
   * Alta de clienta, mascota y rutina en una sola captura.
   *
   * La referencia tenía tres formularios encadenados. Aquí es uno solo porque el
   * servidor los crea en una sola transacción: si algo falla a media captura no
   * queda una clienta sin mascota ni una mascota sin rutina.
   */
  function formAlta() {
    return '<form class="f" data-form="alta"><h3>Nueva clienta</h3>' +

      "<h4>Clienta</h4>" +
      '<label for="c-nombre">Nombre</label>' +
      '<input id="c-nombre" name="nombre" required placeholder="María Fernanda Ruiz">' +
      '<div class="f-grid">' +
      '<div><label for="c-wa">WhatsApp</label>' +
      '<input id="c-wa" name="celular" required inputmode="tel" placeholder="55 1234 5678"></div>' +
      '<div><label for="c-hora">Hora del aviso del día</label>' +
      '<input id="c-hora" name="horaAvisoDia" type="time" value="08:00"></div>' +
      "</div>" +
      '<label for="c-estado">¿Aceptó?</label>' +
      '<select id="c-estado" name="estado">' +
      '<option value="prueba">Sí, la doy de alta</option>' +
      '<option value="no_acepto">No aceptó</option>' +
      "</select>" +
      '<span class="pista">Registrar a quien dijo que no es lo que hace que la tasa de aceptación signifique algo.</span>' +

      "<h4>Mascota</h4>" +
      '<div class="f-grid">' +
      '<div><label for="m-nombre">Nombre</label>' +
      '<input id="m-nombre" name="mNombre" required placeholder="Lola"></div>' +
      '<div><label for="m-especie">Especie</label>' +
      '<select id="m-especie" name="mEspecie">' +
      '<option value="perro">Perro</option><option value="gato">Gato</option>' +
      '<option value="otra">Otra</option></select></div>' +
      '<div><label for="m-raza">Raza</label>' +
      '<input id="m-raza" name="mRaza" placeholder="Schnauzer"></div>' +
      '<div><label for="m-peso">Peso (kg)</label>' +
      '<input id="m-peso" name="mPeso" type="number" step="0.5" min="0" placeholder="8"></div>' +
      "</div>" +
      '<label for="m-notas">Manejo</label>' +
      '<input id="m-notas" name="mNotas" placeholder="Tranquila, piel sensible">' +
      '<span class="pista">Lo que el negocio necesita saber: si es nerviosa, reactiva o tiene alergias.</span>' +

      "<h4>Negocio</h4>" +
      '<label for="p-negocio">Negocio y sucursal</label>' +
      '<input id="p-negocio" name="pNegocio" required placeholder="Petco Polanco">' +
      '<label for="p-dir">Dirección</label>' +
      '<input id="p-dir" name="pDireccion" placeholder="Av. Masaryk 275">' +
      '<label for="p-tel">Teléfono del negocio</label>' +
      '<input id="p-tel" name="pTelefono" inputmode="tel" placeholder="55 8765 4321">' +
      '<span class="pista">Con el teléfono, el negocio se reconoce solo si otra clienta ya lo registró.</span>' +

      "<h4>Rutina</h4>" +
      '<label for="r-servicio">Servicio</label>' +
      '<select id="r-servicio" name="rServicio" required><option value="">Cargando…</option></select>' +
      '<div class="f-grid">' +
      '<div><label for="r-cada">Cada cuántos meses</label>' +
      '<input id="r-cada" name="rCada" type="number" min="1" max="52" value="1" required></div>' +
      '<div><label for="r-costo">Costo aproximado</label>' +
      '<input id="r-costo" name="rCosto" type="number" min="0" placeholder="450"></div>' +
      '<div><label for="r-hora">Hora que suele pedir</label>' +
      '<input id="r-hora" name="rHora" type="time" value="11:00"></div>' +
      '<div><label for="r-prox">Próxima vez (aprox.)</label>' +
      '<input id="r-prox" name="rProxima" type="date"></div>' +
      "</div>" +

      '<div class="row" style="margin-top:6px">' +
      '<button class="btn primary" type="submit">Guardar</button>' +
      '<button class="btn quiet" type="button" data-accion="form" data-arg="clienta">Cancelar</button>' +
      "</div></form>";
  }

  // ------------------------------------------------------------ Citas

  function renderCitas() {
    var cts = datos.citas;
    var rutinas = datos.rutinas;
    if (!cts || !rutinas) { app.innerHTML = '<div class="empty"><p>Cargando…</p></div>'; return; }

    var encabezado = forms.cita
      ? formCita(rutinas)
      : '<div class="row" style="margin-bottom:16px">' +
        '<button class="btn primary" data-accion="form" data-arg="cita"' +
        (rutinas.length ? "" : " disabled") + ">+ Nueva cita</button></div>";

    if (!rutinas.length) {
      app.innerHTML = encabezado + '<div class="empty"><h2>Sin rutinas todavía</h2>' +
        "<p>Primero da de alta una clienta con su mascota y su rutina. Después podrás agendarle citas.</p>" +
        '<button class="btn primary" data-accion="irClientas">Dar de alta una clienta</button></div>';
      return;
    }

    if (!cts.length) {
      app.innerHTML = encabezado + '<div class="empty"><p>Todavía no hay citas agendadas.</p></div>';
      return;
    }

    app.innerHTML = bannerPendiente() + encabezado + cts.map(function (ct) {
      var cumplida = ct.estado === "cumplida";
      var mensajeNegocio = msgNegocio(ct);
      var costo = ct.costo_real != null ? ct.costo_real : ct.costo_confirmado;

      return '<div class="card">' +
        '<span class="card-kind' + (cumplida ? " verde" : "") + '">' + esc(ESTADO_CITA[ct.estado] || ct.estado) + "</span>" +
        "<h3>" + esc(ct.mascota) + " · " + esc(ct.servicio) + "</h3>" +
        '<p class="meta">' + esc(fechaHora(ct.inicia_en, ct.zona_horaria)) + " · " + esc(ct.proveedor) +
          "<br>" + esc(ct.usuaria || ct.celular) + " · " + esc(dinero(costo)) +
          " · avisos enviados: " + ct.avisos_enviados + " de " + ct.avisos_totales +
          (ct.tiene_evidencia ? "" : " · sin evidencia") + "</p>" +
        '<div class="row">' +
        (ct.proveedor_telefono
          ? '<a class="btn" href="tel:' + esc(ct.proveedor_telefono) + '">Llamar al negocio</a>' : "") +
        (ct.proveedor_whatsapp || ct.proveedor_telefono
          ? '<a class="btn" target="_blank" rel="noopener" href="' +
            esc(waLink(ct.proveedor_whatsapp || ct.proveedor_telefono, mensajeNegocio)) +
            '">WhatsApp al negocio</a>' : "") +
        (cumplida ? "" :
          '<button class="btn quiet" data-accion="cumplida" data-arg="' + esc(ct.id) + '">Marcar cumplida</button>') +
        "</div></div>";
    }).join("");
  }

  /**
   * Alta de cita: la operadora ya habló con el negocio y lo captura.
   *
   * El costo se pide como «lo que te dijeron» y no como estimado: es el dato
   * que el agente de la sección 05 tiene que arrancarle al proveedor, y sin él
   * la cita queda marcada «por confirmar» y así se le dice a la clienta.
   */
  function formCita(rutinas) {
    var opciones = rutinas.map(function (r) {
      return '<option value="' + esc(r.id) + '" data-costo="' + esc(r.costoReferencia == null ? "" : r.costoReferencia) +
        '" data-fecha="' + esc(r.proximaFechaEstimada) + '">' + esc(r.etiqueta) + "</option>";
    }).join("");

    return '<form class="f" data-form="cita"><h3>Nueva cita</h3>' +
      '<label for="ct-rutina">¿De quién?</label>' +
      '<select id="ct-rutina" name="rutinaId" required>' + opciones + "</select>" +
      '<div class="f-grid">' +
      '<div><label for="ct-fecha">Fecha</label>' +
      '<input id="ct-fecha" name="fecha" type="date" required></div>' +
      '<div><label for="ct-hora">Hora</label>' +
      '<input id="ct-hora" name="hora" type="time" value="11:00" required></div>' +
      "</div>" +
      '<label for="ct-costo">Costo que te dijeron</label>' +
      '<input id="ct-costo" name="costoInformado" type="number" min="0" placeholder="450">' +
      '<span class="pista">Si el negocio no lo dio, déjalo vacío: la cita queda «por confirmar» y así se le avisa a la clienta.</span>' +
      '<label for="ct-ind">Indicaciones del negocio</label>' +
      '<input id="ct-ind" name="indicaciones" placeholder="Llegar en ayuno, traer transportadora">' +
      '<div class="row"><button class="btn primary" type="submit">Guardar</button>' +
      '<button class="btn quiet" type="button" data-accion="form" data-arg="cita">Cancelar</button></div></form>';
  }

  var ESTADO_CITA = {
    solicitada: "Solicitada",
    por_confirmar_con_proveedor: "Por confirmar con el negocio",
    confirmada: "Confirmada",
    cumplida: "Cumplida",
    requiere_atencion_humana: "Requiere atención"
  };

  /**
   * Mensaje para el negocio.
   *
   * Éste sí se arma en el panel, y es el único: el servidor no lo genera porque
   * en Fase 1 el contacto con el proveedor es humano (sección 10). El texto es
   * el de la referencia, con la regla de la sección 05 respetada — se dice de
   * parte de quién se escribe y se pregunta el costo.
   */
  function msgNegocio(ct) {
    var d = parse(String(ct.inicia_en).slice(0, 10));
    var cuando = d ? largo(d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0")) : "—";

    return "Buenas tardes. Le escribo de parte de " + (ct.usuaria || "una clienta") +
      " para agendar " + String(ct.servicio).toLowerCase() + " de " + ct.mascota +
      (ct.raza ? ", " + ct.raza : "") +
      (ct.peso_kg ? " de " + ct.peso_kg + " kilos" : "") +
      ". ¿Tendrían lugar el " + cuando + "? Y ¿me confirma el costo, por favor? Gracias.";
  }

  // ------------------------------------------------------------ Números

  function renderNumeros() {
    var n = datos.numeros;
    if (!n) { app.innerHTML = '<div class="empty"><p>Cargando…</p></div>'; return; }

    var e = n.envios || {};
    // Los siete de la referencia, en su mismo orden y con sus mismas palabras.
    var tiles = [
      [n.personasInvitadas, "Personas invitadas"],
      [n.clientasActivas, "Clientas activas"],
      [n.pagando, "Pagando"],
      [n.tasaAceptacion === null ? "—" : n.tasaAceptacion + "%", "Tasa de aceptación"],
      [n.citasAgendadas, "Citas agendadas"],
      [n.citasCumplidas, "Citas cumplidas"],
      [n.pendientesDeHoy, "Pendientes de hoy"]
    ];

    var alerta = "";
    if (e.fueraDeTolerancia) {
      var uno = e.fueraDeTolerancia === 1;
      alerta = '<div class="banner mal"><b>' + e.fueraDeTolerancia + "</b> de los últimos " +
        e.muestra + (e.muestra === 1 ? " aviso " : " avisos ") +
        (uno ? "salió" : "salieron") +
        " con más de 15 minutos de retraso. El criterio de la sección 12 pide cero.</div>";
    }

    app.innerHTML =
      '<div class="banner">Estos son los números que le vas a enseñar al ingeniero o a un inversionista. ' +
      "La meta del piloto: <b>20 clientas y que la mitad pague el segundo mes.</b></div>" +
      alerta +
      '<div class="stats">' + tiles.map(function (t) {
        return '<div class="stat"><div class="stat-n">' + esc(t[0] == null ? "—" : t[0]) +
          '</div><div class="stat-l">' + esc(t[1]) + "</div></div>";
      }).join("") + "</div>";
  }

  // ------------------------------------------------------------ eventos

  document.querySelector(".tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]");
    if (!b) return;
    tab = b.dataset.tab;
    document.querySelectorAll(".tabs button").forEach(function (x) {
      x.setAttribute("aria-selected", String(x === b));
    });
    cargar();
  });

  document.getElementById("salir").addEventListener("click", salir);

  document.getElementById("form-acceso").addEventListener("submit", function (e) {
    e.preventDefault();
    var caja = document.getElementById("error-acceso");
    var boton = e.target.querySelector("button[type=submit]");
    caja.hidden = true;
    boton.setAttribute("aria-busy", "true");
    boton.disabled = true;

    entrar(document.getElementById("correo").value.trim(),
           document.getElementById("clave").value)
      .catch(function (err) {
        // El mensaje viene del servidor tal cual: sabe distinguir entre una
        // contraseña que no coincide y una base sin sembrar, y esa diferencia
        // es justo la que desatora.
        caja.textContent = err.message;
        caja.hidden = false;
      })
      .then(function () {
        boton.removeAttribute("aria-busy");
        boton.disabled = false;
      });
  });

  app.addEventListener("click", function (e) {
    var b = e.target.closest("[data-accion]");
    if (!b) return;
    var a = b.dataset.accion, arg = b.dataset.arg;

    if (a === "irClientas") {
      tab = "clientas";
      forms.clienta = true;
      document.querySelectorAll(".tabs button").forEach(function (x) {
        x.setAttribute("aria-selected", String(x.dataset.tab === "clientas"));
      });
      return cargar();
    }

    if (a === "form") {
      forms[arg] = !forms[arg];
      render();
      if (forms[arg] && arg === "clienta") llenarServicios();
      if (forms[arg] && arg === "cita") prellenarCita();
      return;
    }

    if (a === "toggle") { abiertas[arg] = !abiertas[arg]; return render(); }

    if (a === "invitar") {
      b.disabled = true;
      b.setAttribute("aria-busy", "true");
      pedir("/clientas/" + arg + "/invitacion", { method: "POST" })
        .then(function (r) {
          // Se copia solo: el siguiente paso de la operadora es pegarlo en el
          // hilo de WhatsApp donde ya está hablando con ella.
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(r.enlace)
              .then(function () { toast("Enlace copiado. Pégaselo por WhatsApp."); },
                    function () { window.prompt("Copia este enlace y mándaselo:", r.enlace); });
          }
          window.prompt("Copia este enlace y mándaselo:", r.enlace);
        })
        .catch(function (err) { toast(err.message); })
        .then(function () {
          b.disabled = false;
          b.removeAttribute("aria-busy");
          cargar();
        });
      return;
    }

    if (a === "copiar") {
      var el = document.getElementById(arg);
      if (!el) return;
      var txt = el.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(
          function () { toast("Mensaje copiado"); },
          function () { seleccionar(el); });
      } else { seleccionar(el); }
      return;
    }

    if (a === "enviado") {
      var tarjeta = b.closest(".card");
      var texto = tarjeta ? tarjeta.querySelector(".preview").textContent : "";
      b.disabled = true;
      b.setAttribute("aria-busy", "true");
      pedir("/avisos/" + arg + "/enviado", {
        method: "POST",
        body: { texto: texto, canal: b.dataset.canal || "whatsapp" }
      })
        .then(function () { toast("Marcado como enviado"); cargar(); })
        .catch(function (err) {
          toast(err.message);
          b.disabled = false;
          b.removeAttribute("aria-busy");
        });
      return;
    }

    if (a === "cumplida") {
      var cuanto = prompt("¿Cuánto acabó pagando? (déjalo vacío si no sabes)");
      if (cuanto === null) return;
      var costo = cuanto.trim() === "" ? null : Number(cuanto.replace(/[^\d.]/g, ""));
      if (costo !== null && isNaN(costo)) { toast("Ese monto no se entiende"); return; }
      b.disabled = true;
      pedir("/citas/" + arg + "/cumplida", { method: "POST", body: { costoReal: costo } })
        .then(function (r) {
          toast(r.siguienteFecha ? "Cerrada y reprogramada" : "Marcada como cumplida");
          cargar();
        })
        .catch(function (err) { toast(err.message); b.disabled = false; });
      return;
    }
  });

  function seleccionar(el) {
    try {
      var rg = document.createRange();
      rg.selectNodeContents(el);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(rg);
      toast("Selecciónalo y cópialo");
    } catch (e) { toast("Cópialo a mano"); }
  }

  /**
   * Prellena fecha y costo con lo que la rutina ya sabe.
   *
   * La operadora casi siempre agenda para la fecha estimada y al costo de
   * referencia; que vengan puestos le ahorra teclear lo que el sistema ya
   * conoce, y puede cambiarlos.
   */
  function prellenarCita() {
    var sel = document.getElementById("ct-rutina");
    if (!sel) return;

    function aplicar() {
      var op = sel.options[sel.selectedIndex];
      if (!op) return;
      var fecha = document.getElementById("ct-fecha");
      var costo = document.getElementById("ct-costo");
      if (fecha && op.dataset.fecha) fecha.value = op.dataset.fecha;
      if (costo) costo.value = op.dataset.costo || "";
    }

    sel.addEventListener("change", aplicar);
    aplicar();
  }

  /** El catálogo de servicios sale de la base (RF-06), no de una lista fija. */
  function llenarServicios() {
    var sel = document.getElementById("r-servicio");
    if (!sel) return;
    fetch("/catalogo/servicios")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        sel.innerHTML = d.servicios.map(function (s) {
          return '<option value="' + esc(s.codigo) + '">' + esc(s.nombre) + "</option>";
        }).join("");
        sel.value = "bano";
      })
      .catch(function () { sel.innerHTML = '<option value="bano">Baño</option>'; });
  }

  var ETIQUETA_OMITIDO = {
    confirmacion: "la confirmación",
    t_7: "el de 7 días",
    t_3: "el de 3 días",
    t_0: "el del día"
  };

  app.addEventListener("submit", function (e) {
    if (e.target.dataset.form === "cita") return guardarCita(e);

    e.preventDefault();
    var f = e.target;
    if (f.dataset.form !== "alta") return;

    var d = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (el.name) d[el.name] = el.value.trim();
    });

    var cuerpo = {
      clienta: {
        nombre: d.nombre,
        celular: d.celular,
        horaAvisoDia: d.horaAvisoDia || undefined,
        estado: d.estado || "prueba"
      },
      mascota: {
        nombre: d.mNombre,
        especie: d.mEspecie,
        raza: d.mRaza || null,
        pesoKg: d.mPeso ? Number(d.mPeso) : null,
        notasManejo: d.mNotas || null
      },
      proveedor: {
        negocio: d.pNegocio,
        direccion: d.pDireccion || null,
        telefono: d.pTelefono || null,
        whatsapp: d.pTelefono || null
      },
      rutina: {
        tipoServicio: d.rServicio,
        frecuenciaCantidad: Number(d.rCada || 1),
        frecuenciaUnidad: "meses",
        costoReferencia: d.rCosto ? Number(d.rCosto) : null,
        horaPreferida: d.rHora || undefined,
        proximaFechaEstimada: d.rProxima || undefined
      }
    };

    var boton = f.querySelector("button[type=submit]");
    boton.disabled = true;
    boton.setAttribute("aria-busy", "true");

    pedir("/clientas", { method: "POST", body: cuerpo })
      .then(function (r) {
        forms.clienta = false;
        if (r.estado !== "no_acepto") abiertas[r.usuariaId] = true;
        toast(r.estado === "no_acepto"
          ? "Registrada como que no aceptó"
          : r.proveedorYaExistia
            ? "Clienta guardada. El negocio ya estaba en el catálogo."
            : "Clienta guardada");
        cargar();
      })
      .catch(function (err) {
        var caja = document.createElement("div");
        caja.className = "banner mal";
        caja.textContent = err.message;
        f.insertBefore(caja, f.firstChild);
        boton.disabled = false;
        boton.removeAttribute("aria-busy");
      });
  });

  function guardarCita(e) {
    e.preventDefault();
    var f = e.target;
    var d = {};
    Array.prototype.forEach.call(f.elements, function (el) { if (el.name) d[el.name] = el.value.trim(); });

    var boton = f.querySelector("button[type=submit]");
    boton.disabled = true;
    boton.setAttribute("aria-busy", "true");

    pedir("/citas", {
      method: "POST",
      body: {
        rutinaId: d.rutinaId,
        fecha: d.fecha,
        hora: d.hora,
        costoInformado: d.costoInformado ? Number(d.costoInformado) : null,
        indicaciones: d.indicaciones || null
      }
    })
      .then(function (r) {
        forms.cita = false;
        // Si algún aviso quedó fuera por haber vencido ya, se dice aquí y
        // ahora: la operadora tiene que saberlo antes de colgar el teléfono,
        // no cuando la clienta reclame que nunca le avisaron.
        if (r.omitidosPorVencidos && r.omitidosPorVencidos.length) {
          var cuales = r.omitidosPorVencidos.map(function (m) { return ETIQUETA_OMITIDO[m] || m; });
          avisoPendiente = "Cita guardada, pero " + cuales.join(" y ") +
            " no se programaron: su momento ya pasó.";
        } else {
          toast("Cita guardada. Ya salió la confirmación.");
        }
        cargar();
      })
      .catch(function (err) {
        var caja = document.createElement("div");
        caja.className = "banner mal";
        caja.textContent = err.message;
        f.insertBefore(caja, f.firstChild);
        boton.disabled = false;
        boton.removeAttribute("aria-busy");
      });
  }

  // ------------------------------------------------------------ arranque

  var d0 = new Date();
  document.getElementById("hoy-fecha").textContent =
    DIAS[d0.getDay()] + " " + d0.getDate() + " de " + MESES[d0.getMonth()];

  try { credencial = sessionStorage.getItem(LLAVE); } catch (e) { credencial = null; }

  if (credencial) {
    pedir("/numeros").then(mostrarPanel).catch(salir);
  } else {
    acceso.hidden = false;
  }
})();
