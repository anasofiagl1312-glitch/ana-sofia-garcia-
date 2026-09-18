/**
 * Programador de tareas (seccion 08).
 *
 * "Cola confiable de trabajos futuros que dispare cada recordatorio y cada
 *  consulta de disponibilidad. Es el componente del que depende toda la promesa
 *  del producto."
 *
 * Se eligio pg-boss: una cola de trabajos que vive DENTRO de Postgres. Las
 * razones, en orden de peso para este producto:
 *
 *   1. Un componente menos que operar y monitorear. A 500 usuarias y 1,500
 *      citas al mes (RNF-08) el volumen de trabajos es de unos pocos miles al
 *      dia; eso no justifica levantar y vigilar un Redis aparte, con su propia
 *      persistencia y su propio respaldo.
 *   2. Encolar y escribir en la base ocurren en la MISMA transaccion. Con una
 *      cola externa existe siempre la ventana en la que la cita se guardo pero
 *      el trabajo no se encolo (o al reves) y la usuaria se queda sin aviso.
 *   3. El respaldo diario de RNF-07 cubre la cola sin trabajo extra.
 *
 * Si algun dia el volumen lo pide, cambiar a otra cola es reemplazar este
 * archivo: nada del dominio sabe que existe pg-boss.
 *
 * Los trabajos son BARRIDOS periodicos, no un trabajo por aviso; el porque esta
 * explicado en src/modules/recordatorios/servicio.ts.
 */
import PgBoss from 'pg-boss';
import type pg from 'pg';
import type { CanalWhatsApp } from '../channels/whatsapp/index.js';
import { barrerRecordatorios } from '../modules/recordatorios/servicio.js';
import { enviarAlertasDeRefuerzo, generarAlertasDeRefuerzo } from '../modules/recordatorios/refuerzos.js';
import { dispararConsultasDeDisponibilidad } from '../modules/agendamiento/servicio.js';

export const TRABAJOS = {
  /**
   * Cada minuto. La tolerancia de RNF-03 es de 15 minutos, asi que un minuto
   * deja margen de sobra incluso si un barrido se atrasa o falla.
   */
  barridoRecordatorios: 'barrido-recordatorios',
  /**
   * Cada cinco minutos. El disparo de T-21 no necesita precision de minutos:
   * lo que importa es que salga el dia que toca.
   */
  barridoRutinas: 'barrido-rutinas',
  /** Cada hora: genera las alertas de refuerzo del dia en cada zona horaria. */
  generacionRefuerzos: 'generacion-refuerzos',
  /** Cada cinco minutos: saca las alertas de refuerzo ya generadas. */
  envioRefuerzos: 'envio-refuerzos',
} as const;

export const HORARIOS: Record<string, string> = {
  [TRABAJOS.barridoRecordatorios]: '* * * * *',
  [TRABAJOS.barridoRutinas]: '*/5 * * * *',
  [TRABAJOS.generacionRefuerzos]: '0 * * * *',
  [TRABAJOS.envioRefuerzos]: '*/5 * * * *',
};

export interface DependenciasTrabajos {
  pool: pg.Pool;
  whatsapp: CanalWhatsApp;
  registrar?: (mensaje: string, datos?: unknown) => void;
}

export function crearCola(connectionString: string): PgBoss {
  return new PgBoss({
    connectionString,
    // Un barrido que tarda mas de un minuto no debe solaparse con el siguiente.
    // pg-boss ya lo evita por politica de cola; esto acota cuanto puede tardar.
    max: 5,
  });
}

/**
 * Deja la cola lista: crea las colas, registra los trabajadores y programa los
 * barridos periodicos.
 */
export async function iniciarTrabajos(boss: PgBoss, deps: DependenciasTrabajos): Promise<void> {
  const registrar = deps.registrar ?? (() => {});

  for (const nombre of Object.values(TRABAJOS)) {
    // `singleton` evita que dos instancias del servicio corran el mismo barrido
    // a la vez. El bloqueo de filas del barrido ya protege contra el envio
    // duplicado, pero no tiene sentido pagar dos veces el trabajo.
    await boss.createQueue(nombre, { name: nombre, policy: 'singleton' });
  }

  await boss.work(TRABAJOS.barridoRecordatorios, async () => {
    const resumen = await barrerRecordatorios(deps);
    if (resumen.enviados || resumen.fallidos || resumen.cancelados) {
      registrar('barrido de recordatorios', resumen);
    }
    if (resumen.fueraDeTolerancia > 0) {
      registrar('AVISOS FUERA DE TOLERANCIA (RNF-03)', { cuantos: resumen.fueraDeTolerancia });
    }
  });

  await boss.work(TRABAJOS.barridoRutinas, async () => {
    const resumen = await dispararConsultasDeDisponibilidad(deps.pool);
    if (resumen.citasCreadas > 0) registrar('consultas de disponibilidad disparadas', resumen);
  });

  await boss.work(TRABAJOS.generacionRefuerzos, async () => {
    const resumen = await generarAlertasDeRefuerzo(deps.pool);
    if (resumen.generadas > 0) registrar('alertas de refuerzo generadas', resumen);
  });

  await boss.work(TRABAJOS.envioRefuerzos, async () => {
    const resumen = await enviarAlertasDeRefuerzo(deps);
    if (resumen.enviadas || resumen.fallidas) registrar('alertas de refuerzo enviadas', resumen);
  });

  for (const [nombre, cron] of Object.entries(HORARIOS)) {
    await boss.schedule(nombre, cron);
  }
}
