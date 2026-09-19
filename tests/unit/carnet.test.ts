/**
 * Lo que se lee del carnet, puesto en orden.
 *
 * Estas pruebas son la red de la automatización: el lector puede equivocarse
 * —es una foto de una libreta llena a mano— y lo que no puede pasar es que un
 * error se guarde como si fuera un dato. Cada caso de aquí salió de pensar en
 * cómo se ve un carnet de verdad, no de la forma del código.
 */
import { describe, expect, it } from 'vitest';
import {
  type LecturaCruda,
  MAXIMO_DE_APLICACIONES,
  normalizarEspecie,
  normalizarFecha,
  normalizarLectura,
  normalizarSexo,
} from '../../src/domain/carnet.js';

const HOY = new Date('2026-09-19T12:00:00Z');

/** Un carnet vacío, para llenar sólo lo que cada prueba necesita. */
function carnet(parcial: Partial<LecturaCruda> = {}): LecturaCruda {
  return {
    mascota: {
      nombre: null, especie: null, raza: null, sexo: null,
      nacimiento: null, pesoKg: null, esterilizada: null,
      ...(parcial.mascota ?? {}),
    },
    aplicaciones: parcial.aplicaciones ?? [],
    veterinaria: { negocio: null, direccion: null, telefono: null, ...(parcial.veterinaria ?? {}) },
    camposDudosos: parcial.camposDudosos ?? [],
    notas: parcial.notas ?? null,
  };
}

function aplicacion(parcial: Partial<LecturaCruda['aplicaciones'][number]> = {}) {
  return {
    producto: 'Rabia', marca: null, lote: null,
    fechaAplicacion: '2026-03-10', fechaRefuerzo: null,
    veterinario: null, cedulaProfesional: null,
    ...parcial,
  };
}

const leer = (c: LecturaCruda) => normalizarLectura(c, { hoy: HOY });

describe('la especie, como la escribe una veterinaria', () => {
  it('reconoce lo que de verdad dicen los carnets', () => {
    for (const dice of ['Canino', 'canino', 'CAN', 'perro', 'Perra', 'cachorro']) {
      expect(normalizarEspecie(dice), dice).toBe('perro');
    }
    for (const dice of ['Felino', 'felina', 'gato', 'Gata', 'minino']) {
      expect(normalizarEspecie(dice), dice).toBe('gato');
    }
  });

  it('lo que no reconoce lo deja vacío, no lo manda a "otra"', () => {
    // "otra" es una respuesta. Aquí no hubo respuesta, y confundir las dos deja
    // un conejo registrado como "otra" cuando en realidad nadie leyó nada.
    expect(normalizarEspecie('C4N1N0')).toBeNull();
    expect(normalizarEspecie('')).toBeNull();
    expect(normalizarEspecie(null)).toBeNull();
  });
});

describe('el sexo', () => {
  it('entiende la letra sola, que es como viene en la casilla', () => {
    expect(normalizarSexo('M')).toBe('macho');
    expect(normalizarSexo('H')).toBe('hembra');
    expect(normalizarSexo('hembra')).toBe('hembra');
  });

  it('no adivina', () => {
    expect(normalizarSexo('?')).toBeNull();
    expect(normalizarSexo('esterilizado')).toBeNull();
  });
});

describe('las fechas', () => {
  it('lee el formato de México: el día va primero', () => {
    // Ésta es la que puede arruinar un refuerzo sin que nadie se dé cuenta:
    // leída al revés, "03/04/2025" se convierte en 4 de marzo.
    expect(normalizarFecha('03/04/2025')?.fecha).toBe('2025-04-03');
    expect(normalizarFecha('3-4-2025')?.fecha).toBe('2025-04-03');
    expect(normalizarFecha('03.04.25')?.fecha).toBe('2025-04-03');
  });

  it('guarda con qué precisión se conoce, para no inventar un día', () => {
    expect(normalizarFecha('2021')).toEqual({ fecha: '2021-01-01', precision: 'anio' });
    expect(normalizarFecha('2021-04')).toEqual({ fecha: '2021-04-01', precision: 'mes' });
    expect(normalizarFecha('2021-04-12')).toEqual({ fecha: '2021-04-12', precision: 'dia' });
  });

  it('rechaza una fecha que no existe en vez de correrla', () => {
    // El Date de JavaScript convierte el 31 de febrero en 3 de marzo sin avisar.
    // Una fecha corrida ya no es la que decía el carnet.
    expect(normalizarFecha('31/02/2025')).toBeNull();
    expect(normalizarFecha('2025-13-01')).toBeNull();
    expect(normalizarFecha('00/04/2025')).toBeNull();
  });

  it('no intenta con lo que no es una fecha', () => {
    expect(normalizarFecha('próxima visita')).toBeNull();
    expect(normalizarFecha('—')).toBeNull();
    expect(normalizarFecha(null)).toBeNull();
  });
});

describe('la mascota', () => {
  it('propone lo que se leyó y dice con qué precisión sabe el nacimiento', () => {
    const p = leer(carnet({
      mascota: { nombre: '  Canela  ', especie: 'Canino', raza: 'Schnauzer',
                 sexo: 'H', nacimiento: '2021', pesoKg: 8.456, esterilizada: true },
    }));

    expect(p.mascota).toMatchObject({
      nombre: 'Canela', especie: 'perro', raza: 'Schnauzer', sexo: 'hembra',
      nacimiento: '2021-01-01', nacimientoPrecision: 'anio', esterilizada: true,
    });
    expect(p.mascota.pesoKg).toBe(8.46);
  });

  it('descarta un nacimiento en el futuro y dice por qué', () => {
    const p = leer(carnet({ mascota: { nacimiento: '2030-01-01' } as never }));

    expect(p.mascota.nacimiento).toBeNull();
    expect(p.descartados).toContainEqual({
      campo: 'mascota.nacimiento', valor: '2030-01-01',
      porque: 'La fecha de nacimiento queda en el futuro.',
    });
  });

  it('descarta un nacimiento que daría un perro de 40 años', () => {
    const p = leer(carnet({ mascota: { nacimiento: '1986-05-04' } as never }));

    expect(p.mascota.nacimiento).toBeNull();
    expect(p.descartados[0]?.porque).toContain('más de 30 años');
  });

  it('descarta un peso que no es de un perro ni de un gato', () => {
    // Un "850" en la casilla del peso son gramos, o la báscula mal leída.
    const p = leer(carnet({ mascota: { pesoKg: 850 } as never }));

    expect(p.mascota.pesoKg).toBeNull();
    expect(p.descartados[0]?.porque).toContain('no es de un perro');
  });
});

describe('las vacunas', () => {
  it('propone las que están completas, de la más reciente a la más vieja', () => {
    const p = leer(carnet({
      aplicaciones: [
        aplicacion({ producto: 'Parvovirus', fechaAplicacion: '2025-11-02' }),
        aplicacion({ producto: 'Rabia', fechaAplicacion: '2026-03-10', fechaRefuerzo: '2027-03-10' }),
      ],
    }));

    expect(p.aplicaciones.map((a) => a.producto)).toEqual(['Rabia', 'Parvovirus']);
    expect(p.aplicaciones[0]?.fechaRefuerzo).toBe('2027-03-10');
  });

  it('un renglón sin fecha no se guarda, y el descarte dice de qué vacuna era', () => {
    // Producto y fecha son NOT NULL. Lo que importa del mensaje es que ella
    // pueda completarlo sin volver a buscar qué renglón fue.
    const p = leer(carnet({ aplicaciones: [aplicacion({ producto: 'Rabia', fechaAplicacion: 'ilegible' })] }));

    expect(p.aplicaciones).toHaveLength(0);
    expect(p.descartados[0]).toMatchObject({
      campo: 'aplicaciones.0.fechaAplicacion',
      porque: 'No se lee la fecha de Rabia.',
    });
  });

  it('una aplicación en el futuro se descarta: está mal leída', () => {
    const p = leer(carnet({ aplicaciones: [aplicacion({ fechaAplicacion: '2027-01-15' })] }));

    expect(p.aplicaciones).toHaveLength(0);
    expect(p.descartados[0]?.porque).toContain('queda en el futuro');
  });

  it('el refuerzo sí puede ser futuro: para eso sirve', () => {
    const p = leer(carnet({
      aplicaciones: [aplicacion({ fechaAplicacion: '2026-03-10', fechaRefuerzo: '2027-03-10' })],
    }));

    expect(p.aplicaciones[0]?.fechaRefuerzo).toBe('2027-03-10');
    expect(p.descartados).toHaveLength(0);
  });

  it('un refuerzo anterior a la aplicación se cae solo, sin tirar la vacuna', () => {
    // Pasa cuando se confunden las dos columnas del renglón. La vacuna se puso:
    // eso no está en duda. Lo que no se sabe es cuándo toca la siguiente.
    const p = leer(carnet({
      aplicaciones: [aplicacion({ producto: 'Rabia', fechaAplicacion: '2026-03-10', fechaRefuerzo: '2025-03-10' })],
    }));

    expect(p.aplicaciones).toHaveLength(1);
    expect(p.aplicaciones[0]?.fechaRefuerzo).toBeNull();
    expect(p.descartados[0]?.porque).toContain('antes de habérsela puesto');
  });

  it('no acepta un carnet con cientos de renglones', () => {
    const muchas = Array.from({ length: MAXIMO_DE_APLICACIONES + 12 }, () => aplicacion());

    const p = leer(carnet({ aplicaciones: muchas }));

    expect(p.aplicaciones).toHaveLength(MAXIMO_DE_APLICACIONES);
    expect(p.descartados.some((d) => d.campo === 'aplicaciones')).toBe(true);
  });
});

describe('la veterinaria', () => {
  it('la propone cuando trae nombre, y deja el teléfono en puros dígitos', () => {
    const p = leer(carnet({
      veterinaria: { negocio: 'Veterinaria San Ángel', direccion: 'Av. Revolución 1877', telefono: '(55) 3344-5566' },
    }));

    expect(p.veterinaria).toEqual({
      negocio: 'Veterinaria San Ángel',
      direccion: 'Av. Revolución 1877',
      telefono: '5533445566',
    });
  });

  it('sin nombre no hay proveedor que registrar', () => {
    const p = leer(carnet({ veterinaria: { negocio: null, direccion: 'Av. Revolución 1877', telefono: null } }));

    expect(p.veterinaria).toBeNull();
    expect(p.descartados[0]?.campo).toBe('veterinaria.direccion');
  });
});

describe('lo que se le enseña a la clienta', () => {
  it('no marca como dudoso un campo que ya se descartó', () => {
    // Mandarla a revisar un campo que quedó vacío es mandarla a revisar nada.
    const p = leer(carnet({
      mascota: { nacimiento: '2030-01-01' } as never,
      camposDudosos: ['mascota.nacimiento', 'mascota.raza'],
    }));

    expect(p.dudosos).toEqual(['mascota.raza']);
  });

  it('un carnet ilegible devuelve una propuesta vacía, no un error', () => {
    // La pantalla necesita poder decir "no pude leerlo, captúralo tú". Si esto
    // lanzara, la clienta vería una falla del sistema por una foto borrosa.
    const p = leer(carnet({ notas: 'La foto salió muy oscura, no alcanzo a leer nada.' }));

    expect(p.cuantosDatos).toBe(0);
    expect(p.aplicaciones).toEqual([]);
    expect(p.notas).toContain('muy oscura');
  });

  it('cuenta cuántos datos trae, para saber si valió la pena la foto', () => {
    const p = leer(carnet({
      mascota: { nombre: 'Canela', especie: 'canino' } as never,
      aplicaciones: [aplicacion(), aplicacion({ producto: 'Parvovirus', fechaAplicacion: '2025-11-02' })],
      veterinaria: { negocio: 'Veterinaria San Ángel', direccion: null, telefono: null },
    }));

    expect(p.cuantosDatos).toBe(5); // nombre + especie + dos vacunas + la veterinaria
  });
});
