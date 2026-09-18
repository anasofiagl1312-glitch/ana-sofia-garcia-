/**
 * Redaccion de los avisos que recibe la usuaria.
 *
 * REGLA DE CONTENIDO (seccion 03 del documento, recuadro):
 *
 *   "Todo aviso, sin excepcion, incluye los cuatro datos: que servicio, cuando,
 *    donde y cuanto cuesta. Un recordatorio incompleto obliga a la usuaria a
 *    buscar la informacion, que es justo lo que el producto elimina."
 *
 * Por eso los mensajes no se arman con cadenas sueltas sino a partir de un
 * `DatosAviso` que obliga a tener los cuatro datos a la mano, y cada composer
 * pasa su resultado por `asegurarReglaDeContenido()` antes de devolverlo. La
 * prueba tests/unit/contenido.test.ts recorre TODOS los momentos, con y sin
 * direccion, con y sin precio, y falla si alguno pierde uno de los cuatro.
 *
 * Cada aviso viaja ademas con la plantilla de WhatsApp que le corresponde y sus
 * variables ya resueltas, de forma que renderizar la plantilla reproduce
 * exactamente el texto de aqui (ver src/channels/whatsapp/plantillas.ts).
 */
import type { MomentoRecordatorio } from '../../domain/agenda.js';
import type { FechaLocal, ZonaHoraria } from '../../domain/tiempo.js';
import { type NombrePlantilla, PLANTILLAS, renderizar } from '../../channels/whatsapp/plantillas.js';
import { fechaYHora, franja, monto, nombreDia } from './formato.js';

export interface DatosAviso {
  /** Como se llama el servicio en el catalogo: "Baño", "Vacunación". */
  servicio: string;
  mascota: string;
  /** Instante UTC de la cita. */
  iniciaEn: Date;
  zona: ZonaHoraria;
  /** Negocio y sucursal: "Petco Polanco". */
  proveedor: string;
  direccion?: string | null;
  /**
   * Costo confirmado por el proveedor. `null` significa "costo por confirmar"
   * y asi se le dice a la usuaria (seccion 05); nunca se omite el dato.
   */
  costo: number | null;
  /** Solo para el aviso del dia: ayuno, llevar carnet, transportadora. */
  indicaciones?: string | null;
}

/** Como se nombra al costo cuando el proveedor no lo quiso dar. */
export const TEXTO_COSTO_POR_CONFIRMAR = 'Costo por confirmar';

export type DatoObligatorio = 'servicio' | 'cuando' | 'donde' | 'cuanto';

export interface Aviso {
  momento: MomentoRecordatorio | 'confirmacion';
  /** Texto exacto que lee la usuaria. */
  texto: string;
  plantilla: NombrePlantilla;
  /** Valores de la plantilla, en el orden {{1}}..{{N}}. */
  variables: string[];
}

function textoCosto(costo: number | null): string {
  return costo === null ? TEXTO_COSTO_POR_CONFIRMAR : `Costo estimado: ${monto(costo)}`;
}

function textoLugar(datos: DatosAviso): string {
  return datos.direccion ? `${datos.proveedor} (${datos.direccion})` : datos.proveedor;
}

function servicioEnMinusculas(datos: DatosAviso): string {
  return datos.servicio.toLocaleLowerCase('es-MX');
}

/**
 * Comprueba que un texto ya redactado contenga los cuatro datos.
 *
 * Devuelve los que falten. Es la red de seguridad antes de enviar: si alguien
 * agrega un aviso nuevo y se le olvida el precio, el envio se detiene y el caso
 * entra a la bandeja, en vez de mandarle a la usuaria un aviso incompleto.
 */
export function datosFaltantes(texto: string, datos: DatosAviso): DatoObligatorio[] {
  const faltan: DatoObligatorio[] = [];
  const plano = texto.toLocaleLowerCase('es-MX');

  if (!plano.includes(servicioEnMinusculas(datos))) faltan.push('servicio');

  // "Cuando" exige fecha Y hora: "el jueves" sin hora no le sirve a nadie.
  const tieneHora = /\b\d{1,2}:\d{2}\b/.test(texto);
  const tieneFecha = /\b\d{1,2} de [a-záéíóú]+/i.test(texto);
  if (!tieneHora || !tieneFecha) faltan.push('cuando');

  if (!plano.includes(datos.proveedor.toLocaleLowerCase('es-MX'))) faltan.push('donde');

  const tieneCosto =
    texto.includes(TEXTO_COSTO_POR_CONFIRMAR) || (datos.costo !== null && texto.includes(monto(datos.costo)));
  if (!tieneCosto) faltan.push('cuanto');

  return faltan;
}

export class AvisoIncompleto extends Error {
  constructor(
    readonly momento: string,
    readonly faltantes: DatoObligatorio[],
  ) {
    super(`El aviso "${momento}" no cumple la regla de contenido; faltan: ${faltantes.join(', ')}.`);
    this.name = 'AvisoIncompleto';
  }
}

/** Lanza si el aviso no trae los cuatro datos. */
export function asegurarReglaDeContenido(aviso: Aviso, datos: DatosAviso): Aviso {
  const faltantes = datosFaltantes(aviso.texto, datos);
  if (faltantes.length > 0) throw new AvisoIncompleto(aviso.momento, faltantes);
  return aviso;
}

/**
 * Arma el aviso renderizando su plantilla, en lugar de escribir el texto a mano
 * y ademas declarar la plantilla. Asi es imposible que el texto que se prueba
 * aqui y el que Meta tiene aprobado se separen.
 */
function componer(
  momento: Aviso['momento'],
  nombrePlantilla: NombrePlantilla,
  variables: string[],
  datos: DatosAviso,
): Aviso {
  const texto = renderizar(PLANTILLAS[nombrePlantilla], variables);
  return asegurarReglaDeContenido({ momento, texto, plantilla: nombrePlantilla, variables }, datos);
}

// ---------------------------------------------------------------------------
// Redaccion de cada momento
// ---------------------------------------------------------------------------

export interface OpcionHorario {
  fecha: FechaLocal;
  /** Dia ISO de la semana (1=lunes). */
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
}

export class SinOpcionesDeHorario extends Error {
  constructor() {
    super('La consulta de disponibilidad necesita al menos una opción concreta de día y franja.');
    this.name = 'SinOpcionesDeHorario';
  }
}

/**
 * T-21: consulta de disponibilidad.
 *
 * Ofrece opciones concretas derivadas de las preferencias guardadas (RF-03), no
 * un "¿cuando te acomoda?" abierto: la usuaria responde con un numero. Sin al
 * menos una opcion el mensaje no tiene sentido, asi que se niega a redactarlo.
 */
export function avisoDisponibilidad(datos: DatosAviso, opciones: readonly OpcionHorario[]): Aviso {
  if (opciones.length === 0) throw new SinOpcionesDeHorario();

  const lista = opciones
    .map((o, i) => `${i + 1}) ${nombreDia(o.diaSemana)} ${diaYMes(o.fecha)}, ${franja(o.horaInicio, o.horaFin)}`)
    .join('\n');

  return componer(
    't_21',
    'huella_disponibilidad_v1',
    [servicioEnMinusculas(datos), datos.mascota, textoLugar(datos), textoCosto(datos.costo), lista],
    datos,
  );
}

/** Confirmacion, el mismo dia del T-21, una vez que el proveedor aparto. */
export function avisoConfirmacion(datos: DatosAviso): Aviso {
  return componer(
    'confirmacion',
    'huella_confirmacion_v1',
    [
      servicioEnMinusculas(datos),
      datos.mascota,
      fechaYHora(datos.iniciaEn, datos.zona),
      textoLugar(datos),
      textoCosto(datos.costo),
    ],
    datos,
  );
}

/**
 * T-7 y T-3: recordatorio. Sigue el ejemplo textual del documento:
 *
 *   "Recordatorio: el jueves 25 de octubre a las 11:00 tienes el baño de Lola
 *    en Petco Polanco (Av. Presidente Masaryk 275). Costo estimado: $450.
 *    ¿Necesitas cambiarla? Responde REAGENDAR."
 */
export function avisoRecordatorio(datos: DatosAviso, momento: 't_7' | 't_3'): Aviso {
  return componer(
    momento,
    'huella_recordatorio_v1',
    [
      fechaYHora(datos.iniciaEn, datos.zona),
      servicioEnMinusculas(datos),
      datos.mascota,
      textoLugar(datos),
      textoCosto(datos.costo),
    ],
    datos,
  );
}

/**
 * T-0: aviso del dia.
 *
 * Dos plantillas en vez de una con variable opcional, porque Meta rechaza las
 * variables vacias (ver la nota de plantillas.ts).
 */
export function avisoDelDia(datos: DatosAviso): Aviso {
  const comunes = [
    datos.mascota,
    servicioEnMinusculas(datos),
    fechaYHora(datos.iniciaEn, datos.zona),
    textoLugar(datos),
    textoCosto(datos.costo),
  ];

  const indicaciones = datos.indicaciones?.trim();
  return indicaciones
    ? componer('t_0', 'huella_aviso_dia_indicaciones_v1', [...comunes, indicaciones], datos)
    : componer('t_0', 'huella_aviso_dia_v1', comunes, datos);
}

/** T+1: cierre. Confirma que se cumplio y pide el costo real (RF-21). */
export function avisoCierre(datos: DatosAviso): Aviso {
  return componer(
    'cierre',
    'huella_cierre_v1',
    [
      datos.mascota,
      servicioEnMinusculas(datos),
      fechaYHora(datos.iniciaEn, datos.zona),
      textoLugar(datos),
      textoCosto(datos.costo),
    ],
    datos,
  );
}

/** Despacha al redactor que corresponde al momento. */
export function redactarAviso(
  momento: MomentoRecordatorio,
  datos: DatosAviso,
  opciones: readonly OpcionHorario[] = [],
): Aviso {
  switch (momento) {
    case 't_21':
      return avisoDisponibilidad(datos, opciones);
    case 't_7':
    case 't_3':
      return avisoRecordatorio(datos, momento);
    case 't_0':
      return avisoDelDia(datos);
    case 'cierre':
      return avisoCierre(datos);
  }
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

function diaYMes(fecha: FechaLocal): string {
  const [, mes, dia] = fecha.split('-');
  return `${Number(dia)} de ${MESES[Number(mes) - 1]}`;
}
