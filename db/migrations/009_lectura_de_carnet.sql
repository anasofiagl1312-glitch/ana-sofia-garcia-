-- 009: dejar rastro de cuándo se leyó un carnet y qué costó leerlo.
--
-- Lo que se lee del carnet NO se guarda aquí. La lectura trae el nombre de la
-- dueña, la dirección de su veterinaria y la cédula profesional de un médico:
-- exactamente lo que RNF-06 manda tener cifrado en reposo. Guardarla en una
-- columna jsonb la dejaría en claro en cada respaldo de la base.
--
-- En su lugar, la propuesta se guarda como un archivo al lado del documento,
-- por el mismo almacén cifrado que ya usa el carnet. Estas columnas sólo llevan
-- el rastro: cuándo, con qué y cuánto, que no dice nada de la mascota y sí
-- permite saber si la automatización vale lo que cuesta.

ALTER TABLE documento
  ADD COLUMN leido_en      timestamptz,
  -- 'claude', 'ninguno', o lo que venga después. Sin FK: es el nombre de un
  -- adaptador, no una entidad del negocio.
  ADD COLUMN lector        text,
  ADD COLUMN lector_modelo text,
  ADD COLUMN lector_tokens integer,
  ADD COLUMN lector_ms     integer,
  -- Cuántos datos acabó proponiendo. Es la medida de si la foto sirvió: un
  -- carnet leído que propone cero es una foto que hay que volver a tomar.
  ADD COLUMN lectura_datos integer;

COMMENT ON COLUMN documento.leido_en IS
  'Cuándo se leyó el carnet. La propuesta vive cifrada junto al archivo, no en la base.';

-- Para saber cuánto se está gastando en leer carnets sin recorrer la tabla.
CREATE INDEX documento_leidos ON documento (leido_en) WHERE leido_en IS NOT NULL;
