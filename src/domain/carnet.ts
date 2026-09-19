/**
 * Lo que se lee de un carnet de vacunación, puesto en orden.
 *
 * El carnet es una libreta de papel que llena a mano quien atiende: hay
 * abreviaturas, letra de médico, fechas en tres formatos distintos en la misma
 * página y columnas que a veces se saltan. Lo que salga de leerlo es una
 * PROPUESTA, no un hecho: aquí se decide qué está lo bastante claro para
 * proponerlo y qué se descarta, y el descarte siempre dice por qué.
 *
 * La razón de que esto sea una capa aparte —y pura— es que las reglas que
 * importan no dependen de quién leyó el carnet:
 *
 * - Una fecha de aplicación en el futuro está mal leída. Si se guarda, el
 *   refuerzo se programa mal y el aviso sale tarde, que es justo lo que el
 *   producto promete que no pasa (RNF-03).
 * - Una fecha ambigua NO se adivina. "03/04/2025" en México es 3 de abril;
 *   si el lector devuelve algo que no se puede resolver sin adivinar, se
 *   descarta y se le pregunta a la clienta.
 * - Un nacimiento que se lee como "2021" se guarda como 2021 con precisión de
 *   año, no como el 1 de enero de 2021. La columna `nacimiento_precision`
 *   existe para eso (RF-02): no se le enseña a nadie un día que nadie dijo.
 */

export type Especie = 'perro' | 'gato' | 'otra';
export type SexoMascota = 'macho' | 'hembra' | 'desconocido';
export type PrecisionNacimiento = 'dia' | 'mes' | 'anio';

/** Lo que devuelve quien leyó el carnet, tal cual, sin limpiar. */
export interface LecturaCruda {
  mascota: {
    nombre: string | null;
    especie: string | null;
    raza: string | null;
    sexo: string | null;
    nacimiento: string | null;
    pesoKg: number | null;
    esterilizada: boolean | null;
  };
  aplicaciones: Array<{
    producto: string | null;
    marca: string | null;
    lote: string | null;
    fechaAplicacion: string | null;
    fechaRefuerzo: string | null;
    veterinario: string | null;
    cedulaProfesional: string | null;
  }>;
  veterinaria: {
    negocio: string | null;
    direccion: string | null;
    telefono: string | null;
  };
  /** Rutas de lo que no se vio claro: "mascota.nacimiento", "aplicaciones.0.lote". */
  camposDudosos: string[];
  /** Lo que no se pudo leer, en español, para enseñárselo a la clienta. */
  notas: string | null;
}

export interface MascotaPropuesta {
  nombre: string | null;
  especie: Especie | null;
  raza: string | null;
  sexo: SexoMascota | null;
  nacimiento: string | null;
  nacimientoPrecision: PrecisionNacimiento | null;
  pesoKg: number | null;
  esterilizada: boolean | null;
}

export interface AplicacionPropuesta {
  producto: string;
  marca: string | null;
  lote: string | null;
  fechaAplicacion: string;
  fechaRefuerzo: string | null;
  veterinario: string | null;
  cedulaProfesional: string | null;
}

export interface VeterinariaPropuesta {
  negocio: string;
  direccion: string | null;
  telefono: string | null;
}

/** Algo que se leyó pero no se propone, y la razón, que se le dice a la clienta. */
export interface Descartado {
  campo: string;
  valor: string;
  porque: string;
}

export interface PropuestaDeCarnet {
  mascota: MascotaPropuesta;
  aplicaciones: AplicacionPropuesta[];
  veterinaria: VeterinariaPropuesta | null;
  /** Lo que sí se propone pero conviene que revise. */
  dudosos: string[];
  descartados: Descartado[];
  notas: string | null;
  /** Cuántos datos trae la propuesta. Cero significa que la foto no sirvió. */
  cuantosDatos: number;
}

/** Un perro no vive 30 años; más atrás que esto es una fecha mal leída. */
const ANIOS_MAXIMOS_DE_VIDA = 30;

/** Un carnet con más de esto es que el lector se repitió o alucinó filas. */
export const MAXIMO_DE_APLICACIONES = 60;

const ESPECIES: Array<[RegExp, Especie]> = [
  [/^(perr[oa]s?|can(in[oa])?s?|cachorr[oa]s?)$/i, 'perro'],
  [/^(gat[oa]s?|felin[oa]s?|minin[oa]s?)$/i, 'gato'],
];

const SEXOS: Array<[RegExp, SexoMascota]> = [
  [/^(macho|m|masculino|male)$/i, 'macho'],
  [/^(hembra|h|f|femenino|female)$/i, 'hembra'],
];

/**
 * La especie, en las palabras del carnet.
 *
 * Los carnets de veterinaria dicen "canino" y "felino" mucho más seguido que
 * "perro" y "gato". Lo que no se reconoce se queda en `null` en vez de caer a
 * 'otra': 'otra' es una respuesta, y aquí no hubo respuesta.
 */
export function normalizarEspecie(texto: string | null): Especie | null {
  const limpio = (texto ?? '').trim();
  if (!limpio) return null;
  for (const [patron, especie] of ESPECIES) if (patron.test(limpio)) return especie;
  return null;
}

/** El sexo. Igual que la especie: lo que no se reconoce no se inventa. */
export function normalizarSexo(texto: string | null): SexoMascota | null {
  const limpio = (texto ?? '').trim();
  if (!limpio) return null;
  for (const [patron, sexo] of SEXOS) if (patron.test(limpio)) return sexo;
  return null;
}

export interface FechaNormalizada {
  /** Siempre ISO y siempre completa, para poder guardarla en una columna `date`. */
  fecha: string;
  precision: PrecisionNacimiento;
}

/**
 * Una fecha del carnet, en ISO.
 *
 * Acepta lo que de verdad aparece escrito: ISO completo, año y mes, sólo año,
 * y el formato de México (día primero). NO acepta el formato de Estados Unidos:
 * "03/04/2025" es 3 de abril, y con dos lecturas posibles y ninguna forma de
 * distinguirlas, adivinar es peor que preguntar.
 */
export function normalizarFecha(texto: string | null): FechaNormalizada | null {
  const limpio = (texto ?? '').trim();
  if (!limpio) return null;

  const iso = limpio.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return armar(Number(iso[1]), Number(iso[2]), Number(iso[3]), 'dia');

  const anioMes = limpio.match(/^(\d{4})-(\d{2})$/);
  if (anioMes) return armar(Number(anioMes[1]), Number(anioMes[2]), 1, 'mes');

  const soloAnio = limpio.match(/^(\d{4})$/);
  if (soloAnio) return armar(Number(soloAnio[1]), 1, 1, 'anio');

  // Día primero, que es como se escribe aquí. Separador / . o -.
  const mexicana = limpio.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (mexicana) {
    const anio = Number(mexicana[3]!.length === 2 ? `20${mexicana[3]}` : mexicana[3]);
    return armar(anio, Number(mexicana[2]), Number(mexicana[1]), 'dia');
  }

  const mesAnio = limpio.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (mesAnio) return armar(Number(mesAnio[2]), Number(mesAnio[1]), 1, 'mes');

  return null;
}

function armar(anio: number, mes: number, dia: number, precision: PrecisionNacimiento): FechaNormalizada | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  // El Date de JS acomoda el 31 de febrero al 3 de marzo sin decir nada. Una
  // fecha que se corrió no es la que decía el carnet: se rechaza.
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;

  const dosDigitos = (n: number) => String(n).padStart(2, '0');
  return { fecha: `${anio}-${dosDigitos(mes)}-${dosDigitos(dia)}`, precision };
}

/** El teléfono tal como se escribe, sin adornos, para poder compararlo. */
function soloDigitos(texto: string | null): string | null {
  const digitos = (texto ?? '').replace(/\D/g, '');
  return digitos.length >= 8 ? digitos : null;
}

function texto(valor: string | null, maximo: number): string | null {
  const limpio = (valor ?? '').trim().replace(/\s+/g, ' ');
  if (!limpio) return null;
  return limpio.length > maximo ? limpio.slice(0, maximo) : limpio;
}

export interface OpcionesDeNormalizacion {
  /** Hoy, para poder probar el rechazo de fechas futuras sin depender del reloj. */
  hoy?: Date;
}

/**
 * Convierte lo que se leyó en algo que se le puede proponer a la clienta.
 *
 * Nunca lanza: un carnet ilegible produce una propuesta vacía con notas, que es
 * una respuesta válida y es lo que la pantalla necesita para decir "no pude
 * leerlo, captúralo tú".
 */
export function normalizarLectura(
  cruda: LecturaCruda,
  opciones: OpcionesDeNormalizacion = {},
): PropuestaDeCarnet {
  const hoy = opciones.hoy ?? new Date();
  const hoyISO = hoy.toISOString().slice(0, 10);
  const masViejaAceptable = new Date(
    Date.UTC(hoy.getUTCFullYear() - ANIOS_MAXIMOS_DE_VIDA, hoy.getUTCMonth(), hoy.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);

  const descartados: Descartado[] = [];
  const descartar = (campo: string, valor: unknown, porque: string) => {
    descartados.push({ campo, valor: String(valor), porque });
  };

  // ---------------------------------------------------------------- mascota

  const nacimientoLeido = normalizarFecha(cruda.mascota.nacimiento);
  let nacimiento: FechaNormalizada | null = nacimientoLeido;

  if (nacimientoLeido && nacimientoLeido.fecha > hoyISO) {
    descartar('mascota.nacimiento', cruda.mascota.nacimiento, 'La fecha de nacimiento queda en el futuro.');
    nacimiento = null;
  } else if (nacimientoLeido && nacimientoLeido.fecha < masViejaAceptable) {
    descartar(
      'mascota.nacimiento',
      cruda.mascota.nacimiento,
      `La fecha de nacimiento daría más de ${ANIOS_MAXIMOS_DE_VIDA} años.`,
    );
    nacimiento = null;
  } else if (cruda.mascota.nacimiento && !nacimientoLeido) {
    descartar('mascota.nacimiento', cruda.mascota.nacimiento, 'No se entiende qué fecha es.');
  }

  const especie = normalizarEspecie(cruda.mascota.especie);
  if (cruda.mascota.especie && !especie) {
    descartar('mascota.especie', cruda.mascota.especie, 'No se reconoce la especie.');
  }

  const sexo = normalizarSexo(cruda.mascota.sexo);
  if (cruda.mascota.sexo && !sexo) {
    descartar('mascota.sexo', cruda.mascota.sexo, 'No se reconoce el sexo.');
  }

  let pesoKg: number | null = null;
  if (cruda.mascota.pesoKg != null && Number.isFinite(cruda.mascota.pesoKg)) {
    // La columna es numeric(5,2). Un peso de tres dígitos en un carnet de perro
    // o gato es la báscula mal leída, o gramos apuntados como kilos.
    if (cruda.mascota.pesoKg > 0 && cruda.mascota.pesoKg <= 120) {
      pesoKg = Math.round(cruda.mascota.pesoKg * 100) / 100;
    } else {
      descartar('mascota.pesoKg', cruda.mascota.pesoKg, 'Ese peso no es de un perro ni de un gato.');
    }
  }

  const mascota: MascotaPropuesta = {
    nombre: texto(cruda.mascota.nombre, 60),
    especie,
    raza: texto(cruda.mascota.raza, 60),
    sexo,
    nacimiento: nacimiento?.fecha ?? null,
    nacimientoPrecision: nacimiento?.precision ?? null,
    pesoKg,
    esterilizada: typeof cruda.mascota.esterilizada === 'boolean' ? cruda.mascota.esterilizada : null,
  };

  // ----------------------------------------------------------- aplicaciones

  const aplicaciones: AplicacionPropuesta[] = [];
  const filas = (cruda.aplicaciones ?? []).slice(0, MAXIMO_DE_APLICACIONES);

  filas.forEach((fila, i) => {
    const donde = `aplicaciones.${i}`;
    const producto = texto(fila.producto, 120);
    const aplicacion = normalizarFecha(fila.fechaAplicacion);

    // Producto y fecha son NOT NULL en la tabla: sin los dos no hay renglón que
    // guardar. Se descarta con el nombre de lo que sí se leyó, para que la
    // clienta pueda completarlo en vez de tener que buscar qué faltó.
    if (!producto) {
      descartar(`${donde}.producto`, fila.producto ?? '(vacío)', 'No se lee qué le aplicaron.');
      return;
    }
    if (!aplicacion) {
      descartar(`${donde}.fechaAplicacion`, fila.fechaAplicacion ?? '(vacío)', `No se lee la fecha de ${producto}.`);
      return;
    }
    if (aplicacion.fecha > hoyISO) {
      descartar(`${donde}.fechaAplicacion`, fila.fechaAplicacion, `La fecha de ${producto} queda en el futuro.`);
      return;
    }
    if (aplicacion.fecha < masViejaAceptable) {
      descartar(`${donde}.fechaAplicacion`, fila.fechaAplicacion, `La fecha de ${producto} es demasiado vieja.`);
      return;
    }

    // El refuerzo sí puede ser futuro: es justo para lo que sirve (RF-14).
    let refuerzo = normalizarFecha(fila.fechaRefuerzo);
    if (refuerzo && refuerzo.fecha < aplicacion.fecha) {
      descartar(
        `${donde}.fechaRefuerzo`,
        fila.fechaRefuerzo,
        `El refuerzo de ${producto} quedaría antes de habérsela puesto.`,
      );
      refuerzo = null;
    } else if (fila.fechaRefuerzo && !refuerzo) {
      descartar(`${donde}.fechaRefuerzo`, fila.fechaRefuerzo, `No se lee el refuerzo de ${producto}.`);
    }

    aplicaciones.push({
      producto,
      marca: texto(fila.marca, 80),
      lote: texto(fila.lote, 60),
      fechaAplicacion: aplicacion.fecha,
      fechaRefuerzo: refuerzo?.fecha ?? null,
      veterinario: texto(fila.veterinario, 120),
      cedulaProfesional: texto(fila.cedulaProfesional, 40),
    });
  });

  if ((cruda.aplicaciones ?? []).length > MAXIMO_DE_APLICACIONES) {
    descartar(
      'aplicaciones',
      (cruda.aplicaciones ?? []).length,
      `Vinieron más de ${MAXIMO_DE_APLICACIONES} renglones: se tomaron los primeros.`,
    );
  }

  // De la más reciente a la más vieja, que es como se lee un carnet.
  aplicaciones.sort((a, b) => b.fechaAplicacion.localeCompare(a.fechaAplicacion));

  // ------------------------------------------------------------ veterinaria

  const negocio = texto(cruda.veterinaria?.negocio ?? null, 120);
  const veterinaria: VeterinariaPropuesta | null = negocio
    ? {
        negocio,
        direccion: texto(cruda.veterinaria?.direccion ?? null, 300),
        telefono: soloDigitos(cruda.veterinaria?.telefono ?? null),
      }
    : null;

  if (!negocio && cruda.veterinaria?.direccion) {
    descartar('veterinaria.direccion', cruda.veterinaria.direccion, 'Hay dirección pero no el nombre del negocio.');
  }

  // --------------------------------------------------------------- resumen

  const cuantosDatos =
    Object.values(mascota).filter((v) => v !== null).length +
    aplicaciones.length +
    (veterinaria ? 1 : 0);

  return {
    mascota,
    aplicaciones,
    veterinaria,
    // Sólo se marcan como dudosos los campos que de verdad se están proponiendo:
    // señalar algo que ya se descartó manda a revisar un campo vacío.
    dudosos: (cruda.camposDudosos ?? []).filter((campo) => seProponeTodavia(campo, descartados)),
    descartados,
    notas: texto(cruda.notas, 600),
    cuantosDatos,
  };
}

function seProponeTodavia(campo: string, descartados: Descartado[]): boolean {
  return !descartados.some((d) => d.campo === campo);
}
