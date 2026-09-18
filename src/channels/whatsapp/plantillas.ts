/**
 * Plantillas de WhatsApp (seccion 08).
 *
 * "Punto critico: los mensajes que el sistema inicia fuera de la ventana de 24
 *  horas deben usar plantillas aprobadas previamente por Meta, y todos los
 *  recordatorios caen en ese caso. Hay que disenar y dar de alta las plantillas
 *  desde el inicio, contemplando los campos variables."
 *
 * Todos los avisos de Huella son mensajes que inicia el sistema dias despues de
 * la ultima respuesta de la usuaria, asi que TODOS viajan como plantilla. La
 * aprobacion de Meta tarda de horas a dias y una plantilla rechazada detiene el
 * producto entero, por eso viven aqui desde la primera version y no se tocan
 * sin volver a darlas de alta.
 *
 * Restricciones de Meta que condicionan el diseno de los textos:
 *   - El cuerpo no puede empezar ni terminar con una variable.
 *   - Ninguna variable puede ir vacia ni con solo espacios.
 *   - Dos variables no pueden ir pegadas.
 *   - Las variables se numeran {{1}}..{{N}}, seguidas y sin huecos.
 *
 * De ahi salen dos decisiones visibles en el texto: los avisos no llevan el
 * nombre de la usuaria al inicio (seria una variable en primera posicion, y
 * ademas RF-01 no obliga a capturar nombre), y el aviso del dia tiene dos
 * plantillas -- con y sin indicaciones del proveedor -- en vez de una con una
 * variable que a veces va vacia.
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

export const PLANTILLAS = {
  huella_disponibilidad_v1: {
    nombre: 'huella_disponibilidad_v1',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'Hola. Se acerca el {{1}} de {{2}} en {{3}}. {{4}}.\n\n' +
      '¿Qué día te acomoda?\n{{5}}\n\n' +
      'Responde con el número de la opción que prefieras.',
    variables: ['servicio', 'mascota', 'lugar', 'costo', 'opciones'],
  },

  huella_confirmacion_v1: {
    nombre: 'huella_confirmacion_v1',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo: 'Listo. El {{1}} de {{2}} quedó {{3}} en {{4}}. {{5}}.',
    variables: ['servicio', 'mascota', 'fecha_y_hora', 'lugar', 'costo'],
  },

  huella_recordatorio_v1: {
    nombre: 'huella_recordatorio_v1',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'Recordatorio: {{1}} tienes el {{2}} de {{3}} en {{4}}. {{5}}. ' +
      '¿Necesitas cambiarla? Responde REAGENDAR.',
    variables: ['fecha_y_hora', 'servicio', 'mascota', 'lugar', 'costo'],
  },

  huella_aviso_dia_v1: {
    nombre: 'huella_aviso_dia_v1',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'Hoy {{1}} tiene su {{2}}, {{3}}, en {{4}}. {{5}}. ' +
      '¿Necesitas cambiarla? Responde REAGENDAR.',
    variables: ['mascota', 'servicio', 'fecha_y_hora', 'lugar', 'costo'],
  },

  huella_aviso_dia_indicaciones_v1: {
    nombre: 'huella_aviso_dia_indicaciones_v1',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'Hoy {{1}} tiene su {{2}}, {{3}}, en {{4}}. {{5}}. ' +
      'Indicaciones del negocio: {{6}}. ' +
      '¿Necesitas cambiarla? Responde REAGENDAR.',
    variables: ['mascota', 'servicio', 'fecha_y_hora', 'lugar', 'costo', 'indicaciones'],
  },

  huella_cierre_v1: {
    nombre: 'huella_cierre_v1',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      '¿Cómo les fue ayer? {{1}} tenía su {{2}}, {{3}}, en {{4}}. {{5}}. ' +
      'Responde SÍ para confirmar que se cumplió, o dime cuánto pagaste para dejarlo registrado.',
    variables: ['mascota', 'servicio', 'fecha_y_hora', 'lugar', 'costo'],
  },

  // RF-14. No cuelga de una cita, asi que no le aplica la regla de los cuatro
  // datos de la seccion 03 -- todavia no hay lugar ni costo que dar. Lo que si
  // debe traer es todo lo necesario para actuar: de que mascota, que refuerzo,
  // para cuando, y como agendarlo sin tener que preguntar.
  huella_refuerzo_v1: {
    nombre: 'huella_refuerzo_v1',
    categoria: 'UTILITY',
    idioma: 'es_MX',
    cuerpo:
      'A {{1}} le toca {{2}}: {{3}}. ' +
      'Responde AGENDAR y te consigo la cita con tu veterinaria.',
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
  if (/^\s*\{\{\d+\}\}/.test(p.cuerpo)) {
    throw new PlantillaInvalida(`${p.nombre}: el cuerpo no puede empezar con una variable.`);
  }
  if (/\{\{\d+\}\}\s*$/.test(p.cuerpo)) {
    throw new PlantillaInvalida(`${p.nombre}: el cuerpo no puede terminar con una variable.`);
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(p.cuerpo)) {
    throw new PlantillaInvalida(`${p.nombre}: dos variables no pueden ir pegadas.`);
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
  valores.forEach((valor, i) => {
    if (valor.trim() === '') {
      throw new PlantillaInvalida(`${p.nombre}: la variable {{${i + 1}}} (${p.variables[i]}) llego vacia.`);
    }
  });
  return p.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => valores[Number(n) - 1]!);
}

/**
 * Payload para dar de alta la plantilla en la API de Meta.
 * Se usa desde `npm run plantillas:alta` y desde la documentacion de operacion.
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
        example: {
          body_text: [p.variables.map((v) => `ejemplo_${v}`)],
        },
      },
    ],
  };
}
