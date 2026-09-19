-- 008_correo_e_invitaciones.sql
--
-- Lo que hace falta para el piloto manual: avisar también por correo, y dejar
-- que la clienta llene sus propios datos desde su teléfono.
--
-- ---------------------------------------------------------------------------
-- 1) Correo como segundo canal
--
-- RF-12 no dice "por WhatsApp": dice que el aviso salga. En el piloto los manda
-- una persona a mano, y algunas clientas prefieren el correo. El canal se
-- guarda por clienta porque es de ella, no del sistema.

CREATE TYPE canal_aviso AS ENUM ('whatsapp', 'correo', 'ambos');

ALTER TABLE usuaria
  ADD COLUMN correo text,
  ADD COLUMN canal_preferido canal_aviso NOT NULL DEFAULT 'whatsapp';

-- Un correo identifica a una sola clienta activa, igual que el celular.
CREATE UNIQUE INDEX usuaria_correo_unico
  ON usuaria (lower(correo))
  WHERE correo IS NOT NULL AND anonimizada_en IS NULL;

-- No se puede preferir el correo sin haberlo dado. La restricción vive en la
-- base y no solo en el formulario porque el panel también escribe aquí.
ALTER TABLE usuaria
  ADD CONSTRAINT usuaria_correo_si_lo_prefiere
  CHECK (canal_preferido = 'whatsapp' OR correo IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2) Qué relación tiene cada negocio con la clienta
--
-- "Mi veterinaria" y "mi estética" no son lo mismo aunque los dos sean
-- proveedores. La relación es de la clienta con el negocio, así que vive en el
-- vínculo y no en el proveedor, que es compartido (sección 11).

ALTER TABLE usuaria_proveedor
  ADD COLUMN relacion text NOT NULL DEFAULT 'otro'
  CHECK (relacion IN ('veterinaria', 'estetica', 'guarderia', 'paseador', 'otro'));

-- ---------------------------------------------------------------------------
-- 3) Enlace de alta
--
-- En el piloto no hay API de WhatsApp que mande un código de verificación
-- (RF-01), así que el acceso de la clienta a su propia alta es un enlace que la
-- operadora le manda a mano por el mismo hilo donde ya están hablando.
--
-- Se guarda solo el hash: si la base se filtra, los enlaces no sirven.

CREATE TABLE invitacion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuaria_id          uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  token_hash          text NOT NULL UNIQUE,
  creada_por          uuid REFERENCES usuario_interno(id) ON DELETE SET NULL,
  creada_en           timestamptz NOT NULL DEFAULT now(),
  expira_en           timestamptz NOT NULL,
  -- Se marca la primera vez que la clienta lo abre, no cuando termina: sirve
  -- para saber si siquiera entró.
  abierta_en          timestamptz,
  -- Cuando la clienta da por terminada su alta.
  completada_en       timestamptz,
  revocada_en         timestamptz
);

CREATE INDEX invitacion_usuaria ON invitacion (usuaria_id, creada_en DESC);
CREATE INDEX invitacion_vigentes ON invitacion (expira_en)
  WHERE revocada_en IS NULL AND completada_en IS NULL;
