-- 004_ciclo_de_rutina.sql
--
-- RF-08: "Disparo automatico de la consulta de disponibilidad 21 dias antes de
-- la fecha estimada de cada rutina."
--
-- El barrido que dispara esas consultas corre cada pocos minutos y necesita
-- saber si YA disparo la de este ciclo. Deducirlo mirando si existe una cita
-- cercana es fragil: una cita cancelada, o dos rutinas del mismo servicio con
-- el mismo proveedor, y el barrido vuelve a preguntar o deja de preguntar.
--
-- Guardar explicitamente para que fecha estimada se genero ya la cita hace la
-- pregunta trivial y el barrido idempotente.
ALTER TABLE rutina
  ADD COLUMN cita_generada_para date;

CREATE INDEX rutina_por_disparar
  ON rutina (proxima_fecha_estimada)
  WHERE activa AND cita_generada_para IS DISTINCT FROM proxima_fecha_estimada;

-- Hora local por defecto de una cita recien solicitada, antes de que la usuaria
-- elija franja y el proveedor confirme. No se le muestra como hora definitiva:
-- el aviso de T-21 solo ofrece dias y franjas.
ALTER TABLE rutina
  ADD COLUMN hora_preferida time NOT NULL DEFAULT '10:00';
