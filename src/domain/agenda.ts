/**
 * Calculo de cuando ocurre cada cosa: el disparo de la consulta de
 * disponibilidad (RF-08) y los cuatro avisos de una cita (RF-12).
 *
 * Todo lo de aqui es funcion pura. El flujo de la seccion 03 es la promesa
 * central del producto, asi que conviene poder probarlo sin base de datos,
 * sin reloj y sin cola de trabajos.
 */
import {
  type FechaLocal,
  type HoraLocal,
  type ZonaHoraria,
  fechaLocalDe,
  instanteDesdeLocal,
  sumarDias,
  sumarFrecuencia,
} from './tiempo.js';

/**
 * Los momentos de un aviso.
 *
 * `confirmacion` sale en cuanto el proveedor aparta, no a un numero de dias de
 * la cita, asi que no tiene desplazamiento y queda fuera de los calculos de
 * este modulo. El tipo `MomentoConOffset` es el que sirve para programar; que
 * sean dos tipos y no uno evita que alguien pida el instante de la
 * confirmacion y reciba una fecha inventada.
 */
export type MomentoRecordatorio = 'confirmacion' | 't_21' | 't_7' | 't_3' | 't_0' | 'cierre';

export type MomentoConOffset = Exclude<MomentoRecordatorio, 'confirmacion'>;

/** Dias antes de la cita a los que corresponde cada momento. */
export const OFFSET_DIAS: Record<MomentoConOffset, number> = {
  t_21: -21,
  t_7: -7,
  t_3: -3,
  t_0: 0,
  cierre: 1,
};

/**
 * Hora local a la que salen los avisos que no son el del dia.
 * Suficientemente tarde para no despertar a nadie y suficientemente temprano
 * para que quede margen de reaccionar el mismo dia.
 */
export const HORA_AVISO_POR_DEFECTO: HoraLocal = '10:00';

/**
 * Margen minimo entre el aviso del dia y la cita. Si la cita es a las 8:00 y la
 * usuaria pidio su aviso del dia a las 8:00, el aviso no sirve de nada: se
 * adelanta para que llegue con una hora de holgura.
 */
export const MINUTOS_MINIMOS_ANTES_DE_LA_CITA = 60;

/**
 * RF-13: la usuaria puede desactivar recordatorios individuales.
 *
 * Solo se pueden apagar los tres avisos intermedios. El de T-21 es la pregunta
 * de disponibilidad -- sin el no hay cita que recordar -- y el cierre es el que
 * registra el costo real y programa el siguiente ciclo. Apagar cualquiera de
 * esos dos no es "menos mensajes", es romper el flujo de la seccion 03.
 */
export const MOMENTOS_DESACTIVABLES: readonly MomentoConOffset[] = ['t_7', 't_3', 't_0'];

export function esDesactivable(momento: MomentoRecordatorio): boolean {
  return (MOMENTOS_DESACTIVABLES as readonly string[]).includes(momento);
}

export interface RecordatorioProgramado {
  momento: MomentoConOffset;
  /** Instante UTC en el que debe salir el aviso. */
  programadoPara: Date;
}

export interface OpcionesProgramacion {
  /** Instante UTC de la cita. */
  iniciaEn: Date;
  zona: ZonaHoraria;
  /** RF-13: hora local del aviso del dia, por usuaria. */
  horaAvisoDia: HoraLocal;
  /** Momentos que la usuaria apago (RF-13). */
  desactivados?: readonly MomentoConOffset[];
  /**
   * Instante de referencia. Los avisos que ya quedaron atras no se programan:
   * una cita agendada con cinco dias de anticipacion no puede tener un aviso
   * de T-21, y mandarlo tarde seria peor que no mandarlo (RNF-03).
   */
  ahora?: Date;
  /** Momentos a considerar. Por omision, los cuatro avisos mas el cierre. */
  momentos?: readonly MomentoConOffset[];
}

const TODOS_LOS_MOMENTOS: readonly MomentoConOffset[] = ['t_21', 't_7', 't_3', 't_0', 'cierre'];

/**
 * Calcula el instante UTC de un momento concreto respecto de una cita.
 *
 * El calculo pasa SIEMPRE por la fecha local: se toma el dia local de la cita,
 * se le suman o restan dias de calendario, y esa fecha local se combina con la
 * hora local del aviso. Asi un cambio de horario entre el aviso y la cita no
 * corre el aviso (RNF-02).
 */
export function instanteDelMomento(
  momento: MomentoConOffset,
  opciones: Pick<OpcionesProgramacion, 'iniciaEn' | 'zona' | 'horaAvisoDia'>,
): Date {
  const { iniciaEn, zona, horaAvisoDia } = opciones;
  const fechaCita: FechaLocal = fechaLocalDe(iniciaEn, zona);
  const fechaAviso = sumarDias(fechaCita, OFFSET_DIAS[momento]);

  if (momento !== 't_0') {
    return instanteDesdeLocal(fechaAviso, HORA_AVISO_POR_DEFECTO, zona);
  }

  // Aviso del dia: a la hora que la usuaria eligio, pero nunca pegado a la cita.
  const deseado = instanteDesdeLocal(fechaAviso, horaAvisoDia, zona);
  const limite = new Date(iniciaEn.getTime() - MINUTOS_MINIMOS_ANTES_DE_LA_CITA * 60_000);
  return deseado.getTime() > limite.getTime() ? limite : deseado;
}

/**
 * Programa de avisos de una cita.
 *
 * Devuelve solo los que todavia pueden salir a tiempo y que la usuaria no
 * apago, ordenados cronologicamente.
 */
export function programaDeRecordatorios(opciones: OpcionesProgramacion): RecordatorioProgramado[] {
  const { desactivados = [], ahora = new Date(), momentos = TODOS_LOS_MOMENTOS } = opciones;
  const apagados = new Set(desactivados.filter(esDesactivable));

  return momentos
    .filter((momento) => !apagados.has(momento))
    .map((momento) => ({ momento, programadoPara: instanteDelMomento(momento, opciones) }))
    .filter(({ programadoPara }) => programadoPara.getTime() > ahora.getTime())
    .sort((a, b) => a.programadoPara.getTime() - b.programadoPara.getTime());
}

/**
 * RF-08: instante en que hay que preguntarle a la usuaria por su disponibilidad,
 * `diasAnticipacion` dias antes de la fecha estimada de la rutina.
 */
export function instanteDeConsultaDisponibilidad(
  proximaFechaEstimada: FechaLocal,
  diasAnticipacion: number,
  zona: ZonaHoraria,
): Date {
  const fecha = sumarDias(proximaFechaEstimada, -diasAnticipacion);
  return instanteDesdeLocal(fecha, HORA_AVISO_POR_DEFECTO, zona);
}

/**
 * Siguiente fecha estimada de una rutina despues de cumplirse una cita.
 *
 * Se cuenta desde la fecha en que REALMENTE ocurrio la cita, no desde la fecha
 * que estaba estimada. Si el baño de octubre se recorrio una semana, el de
 * noviembre se recorre tambien; si no, la rutina arrastraria el desfase y
 * acabaria pidiendo dos baños en quince dias.
 */
export function siguienteFechaEstimada(
  fechaCumplida: FechaLocal,
  frecuenciaCantidad: number,
  frecuenciaUnidad: 'semanas' | 'meses',
): FechaLocal {
  return sumarFrecuencia(fechaCumplida, frecuenciaCantidad, frecuenciaUnidad);
}

/**
 * Cuando una cita se reagenda hay que recalcular los avisos pendientes
 * (criterio de aceptacion de la seccion 12).
 *
 * Los que ya salieron se quedan como estan -- son historia, y la bitacora debe
 * seguir mostrando lo que la usuaria leyo. Los pendientes se recalculan contra
 * la fecha nueva.
 */
export function recalcularPendientes(
  yaEnviados: readonly MomentoConOffset[],
  opciones: OpcionesProgramacion,
): RecordatorioProgramado[] {
  const enviados = new Set(yaEnviados);
  return programaDeRecordatorios({
    ...opciones,
    momentos: TODOS_LOS_MOMENTOS.filter((m) => !enviados.has(m)),
  });
}
