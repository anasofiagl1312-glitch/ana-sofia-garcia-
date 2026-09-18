import { describe, expect, it } from 'vitest';
import { type Permiso, type RolInterno, SinPermiso, asegurarPermiso, puede } from '../../src/modules/panel/servicio.js';

const ROLES: RolInterno[] = ['operadora', 'supervisora', 'administradora'];

describe('control por rol del panel interno (RNF-06)', () => {
  it('toda operadora puede atender la bandeja y dar de alta clientas', () => {
    for (const rol of ROLES) {
      expect(puede(rol, 'ver_bandeja'), rol).toBe(true);
      expect(puede(rol, 'resolver_caso'), rol).toBe(true);
      expect(puede(rol, 'alta_clienta'), rol).toBe(true);
    }
  });

  it('solo la administradora puede borrar los datos de una usuaria', () => {
    expect(puede('operadora', 'borrar_datos')).toBe(false);
    expect(puede('supervisora', 'borrar_datos')).toBe(false);
    expect(puede('administradora', 'borrar_datos')).toBe(true);
  });

  it('la operadora no ve el estado comercial', () => {
    expect(puede('operadora', 'ver_suscripciones')).toBe(false);
    expect(puede('supervisora', 'ver_suscripciones')).toBe(true);
  });

  it('los permisos crecen con el rol, sin huecos', () => {
    const permisos: Permiso[] = [
      'alta_clienta', 'ver_bandeja', 'resolver_caso', 'ver_expediente', 'ver_conversaciones',
      'ver_suscripciones', 'exportar_datos', 'borrar_datos', 'administrar_equipo',
    ];
    const deOperadora = permisos.filter((p) => puede('operadora', p));
    const deSupervisora = permisos.filter((p) => puede('supervisora', p));
    const deAdministradora = permisos.filter((p) => puede('administradora', p));

    expect(deOperadora.every((p) => deSupervisora.includes(p))).toBe(true);
    expect(deSupervisora.every((p) => deAdministradora.includes(p))).toBe(true);
  });

  it('asegurarPermiso lanza con el rol y el permiso en el mensaje', () => {
    const operadora = { id: '1', nombre: 'Ana', rol: 'operadora' as const };
    expect(() => asegurarPermiso(operadora, 'borrar_datos')).toThrow(SinPermiso);
    expect(() => asegurarPermiso(operadora, 'borrar_datos')).toThrow(/operadora.*borrar_datos/);
    expect(() => asegurarPermiso(operadora, 'ver_bandeja')).not.toThrow();
  });
});
