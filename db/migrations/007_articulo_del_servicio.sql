-- 007_articulo_del_servicio.sql
--
-- El copy validado dice "Ya se acerca el baño de Lola" y "Falta una semana para
-- la vacunación de Bruno". Sin el artículo queda "Ya se acerca baño de Lola",
-- que no es español.
--
-- El artículo se guarda en el catálogo y no se adivina con una regla sobre la
-- terminación de la palabra: la regla acierta con los once servicios de hoy y
-- falla el día que alguien dé de alta uno nuevo, y nadie se entera hasta que
-- una usuaria recibe el mensaje mal escrito.

ALTER TABLE tipo_servicio
  ADD COLUMN articulo text NOT NULL DEFAULT 'el' CHECK (articulo IN ('el', 'la'));

UPDATE tipo_servicio SET articulo = 'la'
 WHERE codigo IN ('consulta', 'vacunacion', 'desparasitacion', 'limpieza_dental', 'guarderia');
