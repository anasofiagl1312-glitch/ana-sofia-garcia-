/**
 * Datos de ejemplo para desarrollo: la usuaria del documento, su perra Lola y
 * su rutina de baño mensual en Petco Polanco.
 */
import { cargarConfig } from '../config/index.js';
import { crearPool } from '../db/pool.js';
import { registrarProveedorDeUsuaria } from '../modules/proveedores/servicio.js';
import { createHash } from 'node:crypto';

const config = cargarConfig();
const pool = crearPool(config.databaseUrl);

const { rows: usuarias } = await pool.query<{ id: string }>(
  `INSERT INTO usuaria (celular, celular_verificado_en, nombre, zona_horaria, estado)
   VALUES ('+525512345678', now(), 'Ana', 'America/Mexico_City', 'prueba')
   ON CONFLICT (celular) WHERE anonimizada_en IS NULL DO UPDATE SET nombre = EXCLUDED.nombre
   RETURNING id`,
);
const usuariaId = usuarias[0]!.id;

await pool.query(
  `INSERT INTO preferencia_agenda (usuaria_id, dia_semana, hora_inicio, hora_fin, prioridad)
   VALUES ($1,4,'10:00','13:00',1), ($1,6,'09:00','12:00',2)
   ON CONFLICT DO NOTHING`,
  [usuariaId],
);

const { rows: mascotas } = await pool.query<{ id: string }>(
  `INSERT INTO mascota (usuaria_id, nombre, especie, raza, peso_kg, sexo, notas_manejo)
   VALUES ($1,'Lola','perro','Schnauzer',8.5,'hembra','Se pone nerviosa con la secadora')
   RETURNING id`,
  [usuariaId],
);

const proveedor = await registrarProveedorDeUsuaria(pool, usuariaId, {
  negocio: 'Petco',
  sucursal: 'Polanco',
  direccion: 'Av. Presidente Masaryk 275',
  telefono: '+525511223344',
  whatsapp: '+525511223344',
});

await pool.query(
  `INSERT INTO rutina (usuaria_id, mascota_id, proveedor_id, tipo_servicio,
                       frecuencia_cantidad, frecuencia_unidad, costo_referencia,
                       hora_preferida, proxima_fecha_estimada)
   VALUES ($1,$2,$3,'bano',1,'meses',450,'11:00', (current_date + 25))`,
  [usuariaId, mascotas[0]!.id, proveedor.id],
);

await pool.query(
  `INSERT INTO usuario_interno (correo, nombre, rol, contrasena_hash)
   VALUES ($1,$2,'administradora',$3)
   ON CONFLICT (correo) DO NOTHING`,
  ['operadora@huella.mx', 'Operadora de ejemplo', createHash('sha256').update('huella').digest('hex')],
);

console.log('Datos de ejemplo listos.');
console.log(`  usuaria:  +525512345678 (${usuariaId})`);
console.log('  panel:    operadora@huella.mx / huella');
await pool.end();
