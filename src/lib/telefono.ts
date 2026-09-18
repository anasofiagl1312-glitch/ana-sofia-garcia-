/**
 * Normalizacion de numeros telefonicos a E.164, con Mexico como pais por
 * omision.
 *
 * Hace falta en dos lugares distintos y por dos razones distintas:
 *   - La usuaria (RF-01): el celular es su identidad, asi que "55 1234 5678" y
 *     "+52 55 1234 5678" tienen que ser la misma persona.
 *   - El proveedor (seccion 11): el telefono es lo que permite reconocer que la
 *     "Petco Polanco" que registro una usuaria y la que registro otra son el
 *     mismo negocio.
 *
 * Sobre el "1" de los celulares mexicanos: Mexico dejo de usarlo para marcar en
 * 2019, pero WhatsApp sigue devolviendo muchos numeros como +521XXXXXXXXXX. Un
 * sistema que no los unifique acaba con la misma persona dos veces, asi que
 * aqui se normaliza siempre a +52 mas diez digitos.
 */

export class TelefonoInvalido extends Error {
  constructor(valor: string) {
    super(`No parece un número de teléfono válido: "${valor}"`);
    this.name = 'TelefonoInvalido';
  }
}

const LADA_MEXICO = '52';

/**
 * Devuelve el numero en E.164 ("+525512345678") o lanza si no lo parece.
 */
export function normalizarTelefono(valor: string, ladaPorDefecto = LADA_MEXICO): string {
  const crudo = valor.trim();
  if (crudo === '') throw new TelefonoInvalido(valor);

  const traiaMas = crudo.startsWith('+');
  let digitos = crudo.replace(/\D/g, '');
  if (digitos === '') throw new TelefonoInvalido(valor);

  // Prefijos de marcacion internacional y el viejo "044"/"045" de celular.
  if (!traiaMas) {
    if (digitos.startsWith('00')) digitos = digitos.slice(2);
    else if (digitos.startsWith('044') || digitos.startsWith('045')) digitos = digitos.slice(3);
  }

  if (digitos.length === 10) digitos = ladaPorDefecto + digitos;

  // +52 1 XXXXXXXXXX -> +52 XXXXXXXXXX
  if (digitos.length === 13 && digitos.startsWith(`${LADA_MEXICO}1`)) {
    digitos = LADA_MEXICO + digitos.slice(3);
  }

  if (digitos.length < 11 || digitos.length > 15) throw new TelefonoInvalido(valor);
  return `+${digitos}`;
}

/** Igual que `normalizarTelefono` pero devuelve null en vez de lanzar. */
export function normalizarTelefonoOpcional(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined || valor.trim() === '') return null;
  try {
    return normalizarTelefono(valor);
  } catch {
    return null;
  }
}

/** "+525512345678" -> "55 1234 5678", para mostrarlo en el panel. */
export function formatearTelefono(e164: string): string {
  const digitos = e164.replace(/\D/g, '');
  if (digitos.startsWith(LADA_MEXICO) && digitos.length === 12) {
    const nacional = digitos.slice(2);
    return `${nacional.slice(0, 2)} ${nacional.slice(2, 6)} ${nacional.slice(6)}`;
  }
  return e164;
}
