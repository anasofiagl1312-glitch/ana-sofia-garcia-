/**
 * Plantillas de WhatsApp (seccion 08).
 *
 * "Punto critico: los mensajes que el sistema inicia fuera de la ventana de 24
 *  horas deben usar plantillas aprobadas previamente por Meta, y todos los
 *  recordatorios caen en ese caso."
 *
 * Los cuerpos son el copy validado con usuarias reales que vive en
 * docs/referencia-panel.html. No es preferencia estetica: es requisito de
 * producto, y por eso manda sobre cualquier redaccion anterior.
 *
 * --- Reglas de Meta que condicionan el diseno ------------------------------
 *
 *   - El cuerpo no puede empezar ni terminar con una variable.
 *   - Dos variables no pueden ir separadas solo por espacios en blanco.
 *   - Las variables se numeran {{1}}..{{N}}, seguidas y sin huecos.
 *   - NINGUNA variable puede ir vacia.
 *   - El VALOR de una variable no puede traer saltos de linea, tabuladores ni
 *     cuatro espacios seguidos.
 *
 * Esas dos ultimas explican por que hay mas plantillas de las que se esperaria:
 * cada dato opcional (el nombre de pila, las indicaciones del negocio) obliga a
 * una variante en vez de una variable que a veces va vacia, y una lista de
 * varias lineas no cabe en una sola variable, asi que las tres opciones de
 * horario son tres variables y no una.
 *
 * Version v2: el copy cambio por completo. El nombre de la plantilla lleva la
 * version a proposito, porque Meta aprueba por nombre y cambiarle el cuerpo a
 * una plantilla ya aprobada exige volver a darla de alta; un nombre nuevo hace
 * ese tramite explicito en vez de silencioso.
 */

export type CategoriaPlantilla = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

export interface Plantilla {
  nombre: string;
  /** Todos los avisos de este producto son transaccionales. */
  categoria: CategoriaPlantilla;
  idioma: 'es_MX';
  /** Cuerpo en formato Meta, con {{1}}..{{N}}. */
  cuerpo: string;
  /** Para que sirve cada variable; el orden es el de {{1}}..{{N}}. */
  variables: readonly string[];
}

/** El bloque de "dos cositas" del cierre, identico en sus cuatro variantes. */
const DOS_COSITAS =
  'Dos cositas:\n' +
  '- ¿Cuánto acabaste pagando?\n' +
  '- ¿Le aplicaron alguna vacuna o desparasitación? Si sí, mándame foto del carnet y lo actualizo.';

export const PLANTILLAS = {
  // --- T-21: consulta de disponibilidad -----------------------------------
  //
  // Se le agrego al copy "en {{lugar}}" y la linea del costo: la regla de
  // contenido de la seccion 03 exige los cuatro datos en TODO aviso, y el copy
  // original no traia ni donde ni cuanto.
  huella_disponibilidad_v2: {
    nombre: 'huella_disponibilidad_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'Hola {{1}} 👋 Ya se acerca {{2}} de {{3}} en {{4}}.\n\n' +
      '¿Qué día te acomoda?\n' +
      '1) {{5}}\n' +
      '2) {{6}}\n' +
      '3) {{7}}\n\n' +
      '💲 {{8}}\n\n' +
      'Contéstame con el número y yo agendo.',
    variables: ['nombre', 'servicio', 'mascota', 'lugar', 'opcion1', 'opcion2', 'opcion3', 'costo'],
  },

  huella_disponibilidad_sin_nombre_v2: {
    nombre: 'huella_disponibilidad_sin_nombre_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'Hola 👋 Ya se acerca {{1}} de {{2}} en {{3}}.\n\n' +
      '¿Qué día te acomoda?\n' +
      '1) {{4}}\n' +
      '2) {{5}}\n' +
      '3) {{6}}\n\n' +
      '💲 {{7}}\n\n' +
      'Contéstame con el número y yo agendo.',
    variables: ['servicio', 'mascota', 'lugar', 'opcion1', 'opcion2', 'opcion3', 'costo'],
  },

  // --- Confirmacion --------------------------------------------------------
  //
  // El copy traia "📍 {{negocio}}, {{direccion}}". La direccion puede no estar
  // —el modelo la deja nula— y una variable vacia la rechaza Meta, asi que las
  // dos van juntas en {{5}}: "Petco Polanco, Av. Masaryk 275" cuando hay
  // direccion y "Petco Polanco" cuando no. El texto que lee la usuaria es el
  // mismo; lo que se evita es una variante mas o un "Petco Polanco, " colgando.
  huella_confirmacion_v2: {
    nombre: 'huella_confirmacion_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      '✅ Listo, ya quedó.\n\n' +
      '{{1}} · {{2}}\n' +
      '📅 {{3}} a las {{4}}\n' +
      '📍 {{5}}\n' +
      '💲 {{6}}\n\n' +
      'Yo te vuelvo a escribir una semana antes. Si necesitas moverla, escribe REAGENDAR y yo me encargo.',
    variables: ['mascota', 'servicio', 'fecha', 'hora', 'lugar', 'costo'],
  },

  // --- T-7 -----------------------------------------------------------------
  //
  // El copy decia "la cita de {{mascota}}", que no dice QUE servicio es. Se
  // cambio a "{{servicio}} de {{mascota}}" para no perder el primero de los
  // cuatro datos.
  huella_recordatorio_7_v2: {
    nombre: 'huella_recordatorio_7_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'Recordatorio 📌 Falta una semana para {{1}} de {{2}}.\n\n' +
      '📅 {{3}} a las {{4}}\n' +
      '📍 {{5}}\n' +
      '💲 {{6}}\n\n' +
      '¿Todo bien con esa fecha? Si no, escribe REAGENDAR.',
    variables: ['servicio', 'mascota', 'fecha', 'hora', 'lugar', 'costo'],
  },

  // --- T-3 -----------------------------------------------------------------
  huella_recordatorio_3_v2: {
    nombre: 'huella_recordatorio_3_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'Faltan 3 días para {{1}} de {{2}} 🐶\n\n' +
      '📅 {{3}} a las {{4}}\n' +
      '📍 {{5}}\n' +
      '💲 {{6}}\n\n' +
      'Te vuelvo a escribir ese mismo día en la mañana.',
    variables: ['servicio', 'mascota', 'fecha', 'hora', 'lugar', 'costo'],
  },

  // --- T-0: aviso del dia --------------------------------------------------
  //
  // El copy ponia el negocio en la frase y la direccion en la linea del pin.
  // Sin direccion esa linea quedaba huerfana, asi que el pin lleva las dos
  // juntas y la frase ya no repite el negocio.
  huella_aviso_dia_v2: {
    nombre: 'huella_aviso_dia_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      '¡Hoy es el día! 🎉\n\n' +
      '{{1}} tiene su {{2}} hoy a las {{3}}.\n' +
      '📍 {{4}}\n' +
      '💲 {{5}}\n\n' +
      'Si necesitas el carnet, dime y te lo mando.',
    variables: ['mascota', 'servicio', 'hora', 'lugar', 'costo'],
  },

  huella_aviso_dia_indicaciones_v2: {
    nombre: 'huella_aviso_dia_indicaciones_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      '¡Hoy es el día! 🎉\n\n' +
      '{{1}} tiene su {{2}} hoy a las {{3}}.\n' +
      '📍 {{4}}\n' +
      '💲 {{5}}\n' +
      '📋 {{6}}\n\n' +
      'Si necesitas el carnet, dime y te lo mando.',
    variables: ['mascota', 'servicio', 'hora', 'lugar', 'costo', 'indicaciones'],
  },

  // --- Cierre (T+1) --------------------------------------------------------
  //
  // El copy no traia ninguno de los cuatro datos: decia "¿cómo les fue ayer?"
  // sin decir de que cita. Se agrego el renglon con servicio, mascota, cuando,
  // donde y cuanto, que ademas es lo que permite contestar sin preguntarle a la
  // usuaria de cual de sus mascotas se trata.
  huella_cierre_v2: {
    nombre: 'huella_cierre_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'Hola {{1}}, ¿cómo les fue ayer? 🐾\n\n' +
      '{{2}} de {{3}} · 📅 {{4}} · 📍 {{5}} · 💲 {{6}}\n\n' +
      DOS_COSITAS + '\n\n' +
      'Ya dejé programado el siguiente para {{7}}. Yo te busco.',
    variables: ['nombre', 'servicio', 'mascota', 'fecha_y_hora', 'lugar', 'costo', 'mes'],
  },

  huella_cierre_sin_nombre_v2: {
    nombre: 'huella_cierre_sin_nombre_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      '¿Cómo les fue ayer? 🐾\n\n' +
      '{{1}} de {{2}} · 📅 {{3}} · 📍 {{4}} · 💲 {{5}}\n\n' +
      DOS_COSITAS + '\n\n' +
      'Ya dejé programado el siguiente para {{6}}. Yo te busco.',
    variables: ['servicio', 'mascota', 'fecha_y_hora', 'lugar', 'costo', 'mes'],
  },

  // Una cita puntual (RF-07) no tiene rutina, asi que no hay siguiente ciclo
  // que prometer.
  huella_cierre_puntual_v2: {
    nombre: 'huella_cierre_puntual_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'Hola {{1}}, ¿cómo les fue ayer? 🐾\n\n' +
      '{{2}} de {{3}} · 📅 {{4}} · 📍 {{5}} · 💲 {{6}}\n\n' +
      DOS_COSITAS + '\n\n' +
      'Cualquier cosa que necesites, aquí ando.',
    variables: ['nombre', 'servicio', 'mascota', 'fecha_y_hora', 'lugar', 'costo'],
  },

  huella_cierre_puntual_sin_nombre_v2: {
    nombre: 'huella_cierre_puntual_sin_nombre_v2',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      '¿Cómo les fue ayer? 🐾\n\n' +
      '{{1}} de {{2}} · 📅 {{3}} · 📍 {{4}} · 💲 {{5}}\n\n' +
      DOS_COSITAS + '\n\n' +
      'Cualquier cosa que necesites, aquí ando.',
    variables: ['servicio', 'mascota', 'fecha_y_hora', 'lugar', 'costo'],
  },

  // --- RF-14: refuerzos ----------------------------------------------------
  //
  // No cuelga de una cita, asi que no le aplica la regla de los cuatro datos:
  // todavia no hay lugar ni costo. Lo que si trae es todo lo necesario para
  // actuar sin preguntar.
  huella_refuerzo_v1: {
    nombre: 'huella_refuerzo_v1',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo: 'A {{1}} le toca {{2}}: {{3}}. Responde AGENDAR y te consigo la cita con tu veterinaria.',
    variables: ['mascota', 'producto', 'vencimiento'],
  },
} as const satisfies Record<string, Plantilla>;

export type NombrePlantilla = keyof typeof PLANTILLAS;

export function plantilla(nombre: NombrePlantilla): Plantilla {
  return PLANTILLAS[nombre];
}

/** Numeros de variable que aparecen en un cuerpo, en orden de aparicion. */
export function variablesDe(cuerpo: string): number[] {
  return [...cuerpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
}

export class PlantillaInvalida extends Error {}

/**
 * Comprueba que una plantilla cumpla las reglas de Meta antes de darla de alta.
 * Correr esto en las pruebas evita descubrir el rechazo con la cuenta ya
 * conectada y los recordatorios sin salir.
 */
export function validarPlantilla(p: Plantilla): void {
  const numeros = variablesDe(p.cuerpo);
  const unicos = [...new Set(numeros)].sort((a, b) => a - b);

  if (unicos.length !== p.variables.length) {
    throw new PlantillaInvalida(
      `${p.nombre}: el cuerpo usa ${unicos.length} variables y se documentaron ${p.variables.length}.`,
    );
  }
  for (let i = 0; i < unicos.length; i++) {
    if (unicos[i] !== i + 1) {
      throw new PlantillaInvalida(`${p.nombre}: las variables deben ir de {{1}} a {{N}} sin huecos.`);
    }
  }
  if (numeros.length !== unicos.length) {
    throw new PlantillaInvalida(`${p.nombre}: una misma variable no debe repetirse en el cuerpo.`);
  }
  if (/^\s*\{\{\d+\}\}/.test(p.cuerpo)) {
    throw new PlantillaInvalida(`${p.nombre}: el cuerpo no puede empezar con una variable.`);
  }
  if (/\{\{\d+\}\}\s*$/.test(p.cuerpo)) {
    throw new PlantillaInvalida(`${p.nombre}: el cuerpo no puede terminar con una variable.`);
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(p.cuerpo)) {
    throw new PlantillaInvalida(`${p.nombre}: dos variables no pueden ir separadas solo por espacios.`);
  }
}

/**
 * Comprueba que el VALOR de una variable sea aceptable para Meta.
 *
 * El salto de linea es el que muerde: una lista de opciones armada como un solo
 * parametro con "\n" entre renglones se ve bien en pantalla y la API la rechaza.
 * Por eso las tres opciones de horario son tres variables.
 */
export function validarValor(p: Plantilla, indice: number, valor: string): void {
  const nombre = p.variables[indice] ?? String(indice + 1);
  if (valor.trim() === '') {
    throw new PlantillaInvalida(`${p.nombre}: la variable {{${indice + 1}}} (${nombre}) llego vacia.`);
  }
  if (/[\n\r\t]/.test(valor)) {
    throw new PlantillaInvalida(
      `${p.nombre}: la variable {{${indice + 1}}} (${nombre}) trae saltos de linea o tabuladores, que Meta rechaza.`,
    );
  }
  if (/ {4}/.test(valor)) {
    throw new PlantillaInvalida(
      `${p.nombre}: la variable {{${indice + 1}}} (${nombre}) trae cuatro o mas espacios seguidos, que Meta rechaza.`,
    );
  }
}

/**
 * Sustituye las variables en el cuerpo.
 *
 * Este es el texto EXACTO que le llega a la usuaria. Las pruebas comparan el
 * resultado de renderizar contra el texto que redactan los composers de
 * src/modules/mensajes/contenido.ts: si alguien cambia la redaccion y se le
 * olvida actualizar la plantilla dada de alta en Meta, la prueba falla antes de
 * que la diferencia llegue a produccion.
 */
export function renderizar(p: Plantilla, valores: readonly string[]): string {
  if (valores.length !== p.variables.length) {
    throw new PlantillaInvalida(
      `${p.nombre}: se esperaban ${p.variables.length} valores y llegaron ${valores.length}.`,
    );
  }
  valores.forEach((valor, i) => validarValor(p, i, valor));
  return p.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => valores[Number(n) - 1]!);
}

/**
 * Payload para dar de alta la plantilla en la API de Meta.
 * Se usa desde la documentacion de operacion y desde el alta automatizada.
 */
export function payloadDeAlta(p: Plantilla): Record<string, unknown> {
  return {
    name: p.nombre,
    language: p.idioma,
    category: p.categoria,
    components: [
      {
        type: 'BODY',
        text: p.cuerpo,
        example: { body_text: [p.variables.map((v) => `ejemplo_${v}`)] },
      },
    ],
  };
}
