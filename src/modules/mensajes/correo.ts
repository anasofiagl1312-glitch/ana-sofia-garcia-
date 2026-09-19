/**
 * El mismo aviso, por correo.
 *
 * El CUERPO es exactamente el de WhatsApp. No se reescribe, a propósito: dos
 * redacciones del mismo mensaje se separan a la primera corrección que alguien
 * hace en una y olvida en la otra, y entonces la clienta recibe una cosa u otra
 * según el canal. El copy está validado con usuarias reales una vez.
 *
 * Lo único que el correo necesita de más es el ASUNTO, que WhatsApp no tiene.
 * Ahí está casi todo el trabajo de este módulo: un asunto que se entienda en la
 * bandeja de entrada sin abrirlo, porque es lo único que se ve desde la lista.
 */
import type { MomentoRecordatorio } from '../../domain/agenda.js';
import type { DatosAviso } from './contenido.js';
import { fechaLarga, hora } from './formato.js';

export interface AvisoPorCorreo {
  asunto: string;
  cuerpo: string;
}

/** "el baño", "la vacunación". */
function servicio(datos: DatosAviso): string {
  return `${datos.articuloServicio ?? 'el'} ${datos.servicio.toLocaleLowerCase('es-MX')}`;
}

/**
 * Asunto del correo.
 *
 * Dice qué pasa y de quién, en ese orden, porque la bandeja de entrada corta
 * por la derecha: "Falta una semana para el baño de Lola" sobrevive al corte;
 * "Recordatorio de Huella sobre tu próxima cita" no dice nada.
 */
export function asuntoDeAviso(momento: MomentoRecordatorio, datos: DatosAviso): string {
  const que = servicio(datos);
  const cuando = fechaLarga(datos.iniciaEn, datos.zona);

  switch (momento) {
    case 't_21':
      return `¿Qué día te acomoda para ${que} de ${datos.mascota}?`;
    case 'confirmacion':
      return `Listo: ${que} de ${datos.mascota} quedó el ${cuando}`;
    case 't_7':
      return `Falta una semana para ${que} de ${datos.mascota}`;
    case 't_3':
      return `Faltan 3 días para ${que} de ${datos.mascota}`;
    case 't_0':
      return `Hoy es ${que} de ${datos.mascota}, a las ${hora(datos.iniciaEn, datos.zona)}`;
    case 'cierre':
      return `¿Cómo les fue ayer con ${datos.mascota}?`;
  }
}

/** Arma el correo a partir de un aviso ya redactado. */
export function avisoPorCorreo(
  momento: MomentoRecordatorio,
  datos: DatosAviso,
  texto: string,
): AvisoPorCorreo {
  return { asunto: asuntoDeAviso(momento, datos), cuerpo: texto };
}

/**
 * Enlace `mailto:` que abre el correo ya escrito.
 *
 * En el piloto no hay servidor de correo saliente: la operadora pica el enlace,
 * se le abre su propio cliente con todo puesto y le da enviar. Cuesta cero y
 * los correos salen de una dirección real que la clienta reconoce, que es
 * justo lo que un servidor recién configurado no consigue —termina en spam.
 */
export function enlaceCorreo(destino: string, correo: AvisoPorCorreo): string {
  const parametros = new URLSearchParams({ subject: correo.asunto, body: correo.cuerpo });
  // URLSearchParams codifica el espacio como "+", que en el cuerpo de un
  // mailto: se ve literalmente como un "+". Tiene que ser %20.
  return `mailto:${encodeURIComponent(destino)}?${parametros.toString().replace(/\+/g, '%20')}`;
}
