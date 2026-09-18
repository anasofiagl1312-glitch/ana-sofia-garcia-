-- 002_catalogo_servicios.sql
-- RF-06: catalogo interno de tipos de servicio con su periodicidad sugerida.
--
-- La periodicidad es una SUGERENCIA que prellena la rutina al crearla; la
-- usuaria puede cambiarla. Los valores salen de la practica comun en Mexico y
-- conviene revisarlos con una veterinaria antes del lanzamiento.

INSERT INTO tipo_servicio (codigo, nombre, periodicidad_dias, genera_aplicacion, orden) VALUES
  ('bano',            'Baño',                   30,   false, 10),
  ('corte',           'Corte de pelo',          60,   false, 20),
  ('bano_y_corte',    'Baño y corte',           60,   false, 30),
  ('consulta',        'Consulta veterinaria',   365,  false, 40),
  ('vacunacion',      'Vacunación',             365,  true,  50),
  ('desparasitacion', 'Desparasitación',        90,   true,  60),
  ('antipulgas',      'Antipulgas',             30,   true,  70),
  ('limpieza_dental', 'Limpieza dental',        365,  false, 80),
  ('guarderia',       'Guardería',              NULL, false, 90),
  ('paseo',           'Paseo',                  7,    false, 100),
  ('corte_unas',      'Corte de uñas',          30,   false, 110);
