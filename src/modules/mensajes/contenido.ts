/**
 * Redaccion de los avisos que recibe la usuaria.
 *
 * El copy es el validado con usuarias reales que vive en
 * docs/referencia-panel.html. No se reescribe aqui: los composers rellenan las
 * plantillas de src/channels/whatsapp/plantillas.ts, que son las que Meta
 * aprueba, de modo que el texto probado y el texto aprobado no se pueden
 * separar.
 *
 * REGLA DE CONTENIDO (seccion 03 del documento, recuadro):
 *
 *   "Todo aviso, sin excepcion, incluye los cuatro datos: que servicio, cuando,
 *    donde y cuanto cuesta. Un recordatorio incompleto obliga a la usuaria a
 *    buscar la informacion, que es justo lo que el producto elimina."
 *
 * Cada composer pasa su resultado por `asegurarReglaDeContenido()` antes de
 * devolverlo, y la prueba recorre TODOS los momentos con y sin direccion, con y
 * sin precio y con y sin nombre de pila.
 */
import type { MomentoRecordatorio } from '../../domain/agenda.js';
import type { FechaLocal, ZonaHoraria } from '../../domain/tiempo.js';
import { type NombrePlantilla, PLANTILLAS, renderizar } from '../../channels/whatsapp/plantillas.js';
import { fechaLarga, fechaLargaConAnio, fechaYHora, franja, hora, monto, nombreDia } from './formato.js';
import { DateTime } from 'luxon';

export interface DatosAviso {
  /** Como se llama el servicio en el catalogo: "Baño", "Vacunación". */
  servicio: string;
  /**
   * Articulo que le corresponde al servicio, del catalogo (RF-06): "el" o "la".
   * El copy dice "se acerca EL baño" y "falta una semana para LA vacunacion";
   * sin esto queda "se acerca baño", que no es espanol.
   */
  articuloServicio?: 'el' | 'la' | null;
  mascota: string;
  /**
   * Nombre de pila de la usuaria. El copy es personal ("Hola María 👋"), y
   * cuando no se tiene se usa la variante sin nombre: Meta rechaza una variable
   * vacia, y dejar de mandar el aviso por un dato de cortesia seria peor que
   * mandarlo sin el (RNF-03: un aviso tarde es un aviso inutil).
   */
  nombrePila?: string | null;
  /** Instante UTC de la cita. */
  iniciaEn: Date;
  zona: ZonaHoraria;
  /** Negocio y sucursal: "Petco Polanco". */
  proveedor: string;
  direccion?: string | null;
  /**
   * Costo confirmado por el proveedor. `null` significa "por confirmar" y asi
   * se le dice a la usuaria (seccion 05); la linea del costo nunca se omite.
   */
  costo: number | null;
  /** Solo para el aviso del dia: ayuno, llevar carnet, transportadora. */
  indicaciones?: string | null;
  /**
   * Mes del siguiente ciclo, para el cierre de una rutina ("noviembre").
   * `null` en una cita puntual, que no tiene siguiente que prometer.
   */
  mesSiguiente?: string | null;
}

/** Como se nombra al costo cuando el proveedor no lo quiso dar. */
export const TEXTO_COSTO_POR_CONFIRMAR = 'por confirmar';

export type DatoObligatorio = 'servicio' | 'cuando' | 'donde' | 'cuanto';

export interface Aviso {
  momento: MomentoRecordatorio;
  /** Texto exacto que lee la usuaria. */
  texto: string;
  plantilla: NombrePlantilla;
  /** Valores de la plantilla, en el orden {{1}}..{{N}}. */
  variables: string[];
}

// ---------------------------------------------------------------------------
// Piezas de texto
// ---------------------------------------------------------------------------

/** El emoji 💲 lo pone la plantilla; esto es solo el monto. */
function textoCosto(costo: number | null): string {
  return costo === null ? TEXTO_COSTO_POR_CONFIRMAR : monto(costo);
}

/**
 * Donde es la cita, en un solo renglon.
 *
 * Negocio y direccion van juntos porque la direccion puede faltar: separados,
 * una direccion nula deja "Petco Polanco, " colgando o una linea de pin vacia,
 * y Meta rechaza la variable vacia.
 */
function textoLugar(datos: DatosAviso): string {
  return datos.direccion ? `${datos.proveedor}, ${datos.direccion}` : datos.proveedor;
}

function servicioEnMinusculas(datos: DatosAviso): string {
  return datos.servicio.toLocaleLowerCase('es-MX');
}

/** "el baño", "la vacunación". */
function servicioConArticulo(datos: DatosAviso): string {
  return `${datos.articuloServicio ?? 'el'} ${servicioEnMinusculas(datos)}`;
}

/** "jueves 22 de octubre", con el ano solo cuando la cita cae en otro. */
function textoFecha(datos: DatosAviso, referencia: Date = new Date()): string {
  const cita = DateTime.fromJSDate(datos.iniciaEn).setZone(datos.zona);
  const hoy = DateTime.fromJSDate(referencia).setZone(datos.zona);
  return cita.year === hoy.year
    ? fechaLarga(datos.iniciaEn, datos.zona)
    : fechaLargaConAnio(datos.iniciaEn, datos.zona);
}

function textoHora(datos: DatosAviso): string {
  return hora(datos.iniciaEn, datos.zona);
}

/** Primer nombre, para el saludo. */
export function nombreDePila(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? '').trim();
  if (limpio === '') return null;
  return limpio.split(/\s+/)[0]!;
}

// ---------------------------------------------------------------------------
// Regla de contenido
// ---------------------------------------------------------------------------

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

  // "Cuando" exige fecha Y hora. El aviso del dia dice "hoy", que es una fecha
  // tan exacta como la del calendario y no obliga a buscar nada.
  const tieneHora = /\b\d{1,2}:\d{2}\b/.test(texto);
  const tieneFecha = /\b\d{1,2} de [a-záéíóú]+/i.test(texto) || /\bhoy\b/i.test(plano);
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
  momento: MomentoRecordatorio,
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

/** Cuantas opciones pide el copy de T-21. Son tres renglones numerados. */
export const OPCIONES_REQUERIDAS = 3;

export class OpcionesDeHorarioInsuficientes extends Error {
  constructor(readonly recibidas: number) {
    super(
      `La consulta de disponibilidad necesita exactamente ${OPCIONES_REQUERIDAS} opciones de día y franja; ` +
        `llegaron ${recibidas}.`,
    );
    this.name = 'OpcionesDeHorarioInsuficientes';
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

/** "jueves 8 de octubre, de 10:00 a 13:00" */
function textoOpcion(o: OpcionHorario): string {
  return `${nombreDia(o.diaSemana)} ${diaYMes(o.fecha)}, ${franja(o.horaInicio, o.horaFin)}`;
}

/**
 * T-21: consulta de disponibilidad.
 *
 * Ofrece tres opciones concretas derivadas de las preferencias guardadas
 * (RF-03), no un "¿cuando te acomoda?" abierto: la usuaria contesta con un
 * numero. Son tres variables y no una lista en una sola, porque Meta rechaza un
 * parametro con saltos de linea.
 */
export function avisoDisponibilidad(datos: DatosAviso, opciones: readonly OpcionHorario[]): Aviso {
  if (opciones.length !== OPCIONES_REQUERIDAS) throw new OpcionesDeHorarioInsuficientes(opciones.length);

  const tres = opciones.map(textoOpcion);
  const comunes = [
    servicioConArticulo(datos),
    datos.mascota,
    textoLugar(datos),
    tres[0]!,
    tres[1]!,
    tres[2]!,
    textoCosto(datos.costo),
  ];

  const nombre = nombreDePila(datos.nombrePila);
  return nombre
    ? componer('t_21', 'huella_disponibilidad_v2', [nombre, ...comunes], datos)
    : componer('t_21', 'huella_disponibilidad_sin_nombre_v2', comunes, datos);
}

/** Confirmacion: el proveedor aparto y la cita quedo. */
export function avisoConfirmacion(datos: DatosAviso): Aviso {
  return componer(
    'confirmacion',
    'huella_confirmacion_v2',
    [
      datos.mascota,
      datos.servicio,
      textoFecha(datos),
      textoHora(datos),
      textoLugar(datos),
      textoCosto(datos.costo),
    ],
    datos,
  );
}

/** T-7 y T-3: recordatorios. */
export function avisoRecordatorio(datos: DatosAviso, momento: 't_7' | 't_3'): Aviso {
  return componer(
    momento,
    momento === 't_7' ? 'huella_recordatorio_7_v2' : 'huella_recordatorio_3_v2',
    [
      servicioConArticulo(datos),
      datos.mascota,
      textoFecha(datos),
      textoHora(datos),
      textoLugar(datos),
      textoCosto(datos.costo),
    ],
    datos,
  );
}

/**
 * T-0: aviso del dia.
 *
 * Dos plantillas en vez de una con variable opcional: sin indicaciones la linea
 * del 📋 no debe quedar huerfana, y Meta rechaza las variables vacias.
 */
export function avisoDelDia(datos: DatosAviso): Aviso {
  const comunes = [
    datos.mascota,
    servicioEnMinusculas(datos),
    textoHora(datos),
    textoLugar(datos),
    textoCosto(datos.costo),
  ];

  const indicaciones = datos.indicaciones?.trim();
  return indicaciones
    ? componer('t_0', 'huella_aviso_dia_indicaciones_v2', [...comunes, indicaciones], datos)
    : componer('t_0', 'huella_aviso_dia_v2', comunes, datos);
}

/** T+1: cierre. Pide el costo real y, si hay rutina, anuncia el siguiente ciclo. */
export function avisoCierre(datos: DatosAviso): Aviso {
  const comunes = [
    servicioConArticulo(datos),
    datos.mascota,
    fechaYHora(datos.iniciaEn, datos.zona),
    textoLugar(datos),
    textoCosto(datos.costo),
  ];

  const nombre = nombreDePila(datos.nombrePila);
  const mes = datos.mesSiguiente?.trim();

  if (mes) {
    return nombre
      ? componer('cierre', 'huella_cierre_v2', [nombre, ...comunes, mes], datos)
      : componer('cierre', 'huella_cierre_sin_nombre_v2', [...comunes, mes], datos);
  }
  return nombre
    ? componer('cierre', 'huella_cierre_puntual_v2', [nombre, ...comunes], datos)
    : componer('cierre', 'huella_cierre_puntual_sin_nombre_v2', comunes, datos);
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
    case 'confirmacion':
      return avisoConfirmacion(datos);
    case 't_7':
    case 't_3':
      return avisoRecordatorio(datos, momento);
    case 't_0':
      return avisoDelDia(datos);
    case 'cierre':
      return avisoCierre(datos);
  }
}

/** Nombre del mes de una fecha local, para el cierre. */
export function mesDe(fecha: FechaLocal): string {
  return MESES[Number(fecha.split('-')[1]) - 1]!;
}
