-- 003_entrega_y_refuerzos.sql
--
-- Dos cosas que hacen falta para cumplir RNF-03 y RNF-04 sin romper la medicion
-- del retraso, y para que RF-14 no repita avisos.

-- RNF-04: reintento automatico de envios fallidos.
--
-- El reintento NO mueve programado_para. Ese campo es la hora a la que el aviso
-- DEBIA salir y es contra la que se mide la tolerancia de 15 minutos de RNF-03;
-- si el reintento lo recorriera, un aviso que salio con media hora de retraso
-- se veria puntual en la bitacora y el criterio de aceptacion de la seccion 12
-- ("ningun recordatorio con mas de 15 minutos de retraso en una muestra de 50")
-- seria incomprobable.
ALTER TABLE recordatorio
  ADD COLUMN proximo_intento_en timestamptz;

-- El barrido busca por esta columna; cuando esta en NULL, el aviso todavia no
-- se ha intentado y vale programado_para.
CREATE INDEX recordatorio_por_intentar
  ON recordatorio (COALESCE(proximo_intento_en, programado_para))
  WHERE estado IN ('programado', 'fallido');

-- Retraso real de cada envio, en segundos. Se calcula una sola vez al enviar
-- para que el panel y las pruebas de aceptacion no tengan que recalcularlo.
ALTER TABLE recordatorio
  ADD COLUMN retraso_segundos int;

-- RF-14: alertas de refuerzo de vacuna o desparasitacion.
--
-- Tabla propia y no `recordatorio`, porque un refuerzo no cuelga de una cita:
-- la usuaria lo recibe aunque nunca haya agendado nada. La llave unica evita
-- que el barrido diario mande dos veces el mismo aviso.
CREATE TABLE alerta_refuerzo (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuaria_id          uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  mascota_id          uuid NOT NULL REFERENCES mascota(id) ON DELETE CASCADE,
  aplicacion_id       uuid NOT NULL REFERENCES aplicacion(id) ON DELETE CASCADE,
  clase               text NOT NULL CHECK (clase IN ('proxima','hoy','vencida')),
  fecha_refuerzo      date NOT NULL,
  dias_de_retraso     int NOT NULL,
  programado_para     timestamptz NOT NULL,
  contenido_enviado   text,
  plantilla           text,
  estado              estado_entrega NOT NULL DEFAULT 'programado',
  enviado_en          timestamptz,
  id_externo          text,
  intentos            int NOT NULL DEFAULT 0,
  ultimo_error        text,
  proximo_intento_en  timestamptz,
  creada_en           timestamptz NOT NULL DEFAULT now()
);

-- Un aviso por aplicacion y por hito (14 dias antes, el dia, 7 y 30 despues).
CREATE UNIQUE INDEX alerta_refuerzo_unica
  ON alerta_refuerzo (aplicacion_id, dias_de_retraso);

CREATE INDEX alerta_refuerzo_pendientes
  ON alerta_refuerzo (COALESCE(proximo_intento_en, programado_para))
  WHERE estado IN ('programado', 'fallido');
