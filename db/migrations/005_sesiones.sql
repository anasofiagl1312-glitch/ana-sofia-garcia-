-- 005_sesiones.sql
--
-- Sesiones de la usuaria. Token opaco y aleatorio, guardado como hash: si la
-- base se filtra, los tokens no sirven, y revocar una sesion es borrar o marcar
-- una fila (lo que hace falta al ejercer el derecho de cancelacion, seccion 09).

CREATE TABLE sesion (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuaria_id    uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  creada_en     timestamptz NOT NULL DEFAULT now(),
  expira_en     timestamptz NOT NULL,
  revocada_en   timestamptz
);

CREATE INDEX sesion_usuaria ON sesion (usuaria_id) WHERE revocada_en IS NULL;
