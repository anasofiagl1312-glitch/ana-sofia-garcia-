-- 006_no_acepto_y_confirmacion.sql
--
-- Dos valores de enum que faltaban, cada uno por una razón distinta.
--
-- 1) `no_acepto` en estado_suscripcion.
--
--    Hasta ahora solo se guardaba a quien aceptaba, así que la tasa de
--    aceptación dividía entre las que aceptaron: daba 100 % por construcción y
--    no medía nada. Para que la tasa signifique algo hay que poder registrar
--    también a quien dijo que no.
--
-- 2) `confirmacion` en momento_recordatorio.
--
--    El mensaje de confirmación existía como texto (seccion 03: "el sistema
--    agenda y confirma") pero no como momento programable, así que no quedaba
--    registro de si salió. Al crear una cita desde el panel es el primero de
--    los cuatro avisos y tiene que poder seguirse igual que los demás.
--
-- Nota de operación: en PostgreSQL 12 y posteriores ALTER TYPE ... ADD VALUE
-- corre dentro de una transacción, pero el valor nuevo NO se puede usar hasta
-- que ésta confirme. Por eso esta migración solo agrega los valores y no
-- inserta ni actualiza ninguna fila con ellos.

ALTER TYPE estado_suscripcion ADD VALUE IF NOT EXISTS 'no_acepto';

ALTER TYPE momento_recordatorio ADD VALUE IF NOT EXISTS 'confirmacion' BEFORE 't_21';
