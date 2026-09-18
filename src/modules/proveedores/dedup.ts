/**
 * Identidad de un proveedor compartido.
 *
 * Responde a la pregunta abierta 4 del documento: "¿Como se maneja que un mismo
 * negocio sea proveedor de varias usuarias sin duplicar registros ni saturarlo
 * con llamadas?" -- la primera mitad, la de no duplicar.
 *
 * La regla es una sola: DOS REGISTROS SON EL MISMO NEGOCIO SI COMPARTEN
 * TELEFONO. Un telefono es el identificador mas estable que hay en este
 * dominio; el nombre no lo es ("Petco", "PETCO Polanco", "petco masaryk") y la
 * direccion menos todavia.
 *
 * Cuando no hay telefono -- pasa, una usuaria que solo sabe donde queda -- se
 * cae a nombre + sucursal normalizados. Es peor, y por eso el registro queda
 * marcado para que la operadora lo complete: un proveedor sin telefono tampoco
 * se puede contactar, asi que igual hay que conseguirlo.
 */
import { normalizarTelefonoOpcional } from '../../lib/telefono.js';

export interface DatosProveedor {
  negocio: string;
  sucursal?: string | null;
  telefono?: string | null;
  whatsapp?: string | null;
}

/** Quita acentos, signos y espacios de mas; deja solo letras, numeros y guiones. */
export function normalizarNombre(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Clave de deduplicacion. Dos altas con la misma clave son el mismo proveedor. */
export function claveDedup(datos: DatosProveedor): string {
  const telefono = normalizarTelefonoOpcional(datos.telefono) ?? normalizarTelefonoOpcional(datos.whatsapp);
  if (telefono) return `tel:${telefono}`;

  const negocio = normalizarNombre(datos.negocio);
  const sucursal = normalizarNombre(datos.sucursal ?? '');
  if (negocio === '') throw new Error('El proveedor necesita al menos un nombre de negocio.');
  return `nom:${negocio}${sucursal ? `|${sucursal}` : ''}`;
}

/** Un proveedor identificado solo por nombre necesita que alguien lo complete. */
export function requiereRevision(datos: DatosProveedor): boolean {
  return claveDedup(datos).startsWith('nom:');
}
