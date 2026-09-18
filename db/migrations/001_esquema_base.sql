-- 001_esquema_base.sql
-- Modelo de datos de la seccion 07 del documento de requerimientos v1.0.
--
-- Dos decisiones de la seccion 11 ("Consecuencia para el diseno actual") estan
-- incorporadas desde esta primera migracion, porque cambiarlas despues obliga a
-- rehacer el sistema:
--
--   1. Proveedor es una entidad COMPARTIDA entre usuarias, no un contacto
--      privado de cada una. La relacion usuaria<->proveedor vive en su propia
--      tabla (usuaria_proveedor). Asi el catalogo que las usuarias construyen
--      al registrar a sus negocios es ya la semilla del directorio de Fase 4.
--
--   2. El proveedor guarda ubicacion geografica desde ahora, aunque la busqueda
--      por cercania (RF-29) sea de Fase 4. Rellenar coordenadas despues, sobre
--      miles de registros hechos a mano, es mucho mas caro que capturarlas al
--      vuelo.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Usuaria
-- ---------------------------------------------------------------------------

CREATE TYPE estado_suscripcion AS ENUM (
  'prueba',
  'activa',
  'pago_pendiente',
  'cancelada'
);

CREATE TABLE usuaria (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  celular                 text NOT NULL,          -- E.164, p. ej. +5215512345678
  celular_verificado_en   timestamptz,
  nombre                  text,
  zona_horaria            text NOT NULL DEFAULT 'America/Mexico_City',
  -- RF-13: hora local a la que se envia el aviso del dia (T-0).
  hora_aviso_dia          time NOT NULL DEFAULT '08:00',
  estado                  estado_suscripcion NOT NULL DEFAULT 'prueba',
  creada_en               timestamptz NOT NULL DEFAULT now(),
  actualizada_en          timestamptz NOT NULL DEFAULT now(),
  -- Baja de datos (seccion 09, derecho de cancelacion). Se conserva la fila
  -- anonimizada para no romper el historial contable de la suscripcion.
  anonimizada_en          timestamptz
);

-- Un celular identifica a una sola usuaria activa. Las anonimizadas liberan el
-- numero para que la persona pueda volver a darse de alta.
CREATE UNIQUE INDEX usuaria_celular_unico
  ON usuaria (celular)
  WHERE anonimizada_en IS NULL;

-- RF-01: codigo de verificacion por SMS/WhatsApp.
CREATE TABLE codigo_verificacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  celular         text NOT NULL,
  codigo_hash     text NOT NULL,      -- nunca se guarda el codigo en claro
  expira_en       timestamptz NOT NULL,
  intentos        int NOT NULL DEFAULT 0,
  consumido_en    timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX codigo_verificacion_celular ON codigo_verificacion (celular, creado_en DESC);

-- Seccion 09: hay que registrar QUE version del aviso acepto y CUANDO, no solo
-- que acepto.
CREATE TABLE consentimiento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuaria_id      uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  tipo            text NOT NULL,      -- aviso_privacidad | representacion | grabacion_llamadas
  version         text NOT NULL,
  aceptado_en     timestamptz NOT NULL DEFAULT now(),
  revocado_en     timestamptz,
  evidencia       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX consentimiento_usuaria ON consentimiento (usuaria_id, tipo);

-- RF-03: dias y franjas viables, con orden de prioridad. Alimentan las opciones
-- que se ofrecen en T-21.
CREATE TABLE preferencia_agenda (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuaria_id      uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  dia_semana      int NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),  -- 1=lunes, ISO-8601
  hora_inicio     time NOT NULL,
  hora_fin        time NOT NULL,
  prioridad       int NOT NULL DEFAULT 1,
  CHECK (hora_fin > hora_inicio)
);

CREATE INDEX preferencia_agenda_usuaria ON preferencia_agenda (usuaria_id, prioridad);

-- ---------------------------------------------------------------------------
-- Mascota
-- ---------------------------------------------------------------------------

CREATE TYPE especie AS ENUM ('perro', 'gato', 'otra');
CREATE TYPE sexo_mascota AS ENUM ('macho', 'hembra', 'desconocido');

CREATE TABLE mascota (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuaria_id          uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  nombre              text NOT NULL,
  especie             especie NOT NULL,
  raza                text,
  -- "fecha de nacimiento aproximada" (RF-02): se guarda la fecha y con que
  -- precision se conoce, para no mostrar un dia exacto que la usuaria invento.
  nacimiento          date,
  nacimiento_precision text NOT NULL DEFAULT 'dia' CHECK (nacimiento_precision IN ('dia','mes','anio')),
  peso_kg             numeric(5,2),
  sexo                sexo_mascota NOT NULL DEFAULT 'desconocido',
  esterilizada        boolean,
  foto_documento_id   uuid,           -- FK diferida a documento
  -- RF-02: notas de manejo (nerviosa, reactiva, alergias). Viajan al proveedor
  -- cuando el agente agenda, asi que son parte del mensaje, no un comentario.
  notas_manejo        text,
  creada_en           timestamptz NOT NULL DEFAULT now(),
  actualizada_en      timestamptz NOT NULL DEFAULT now(),
  archivada_en        timestamptz
);

CREATE INDEX mascota_usuaria ON mascota (usuaria_id) WHERE archivada_en IS NULL;

-- ---------------------------------------------------------------------------
-- Proveedor  (entidad compartida -- ver nota de cabecera)
-- ---------------------------------------------------------------------------

CREATE TYPE canal_contacto AS ENUM ('whatsapp', 'telefono', 'integracion');

CREATE TABLE proveedor (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio             text NOT NULL,
  sucursal            text,
  direccion           text,
  telefono            text,            -- E.164
  whatsapp            text,            -- E.164
  canal_preferido     canal_contacto NOT NULL DEFAULT 'whatsapp',
  -- Fase 4 (RF-29, busqueda por cercania). Se captura desde Fase 1.
  latitud             numeric(9,6),
  longitud            numeric(9,6),
  -- Horarios conocidos, aprendidos de las conversaciones reales.
  -- { "1": [["09:00","18:00"]], ... } con 1=lunes.
  horarios_conocidos  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Clave de deduplicacion: dos usuarias que registran "Petco Polanco" deben
  -- caer en la MISMA fila. Se deriva del telefono normalizado o, si no hay,
  -- del nombre+sucursal normalizados. Ver src/modules/proveedores/dedup.ts.
  clave_dedup         text NOT NULL,
  -- Fase 4: un proveedor puede reclamar su perfil y pasar a integracion directa.
  reclamado_en        timestamptz,
  verificado_en       timestamptz,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX proveedor_clave_dedup_unica ON proveedor (clave_dedup);
CREATE INDEX proveedor_geo ON proveedor (latitud, longitud) WHERE latitud IS NOT NULL;

-- Relacion usuaria<->proveedor: "mi estetica". Lo privado de cada usuaria vive
-- aqui; lo compartido vive en proveedor.
CREATE TABLE usuaria_proveedor (
  usuaria_id      uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  proveedor_id    uuid NOT NULL REFERENCES proveedor(id) ON DELETE CASCADE,
  alias           text,               -- como lo llama ella: "la estetica de la esquina"
  notas           text,
  agregado_en     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuaria_id, proveedor_id)
);

CREATE INDEX usuaria_proveedor_por_proveedor ON usuaria_proveedor (proveedor_id);

-- ---------------------------------------------------------------------------
-- Catalogo de servicios (RF-06)
-- ---------------------------------------------------------------------------

CREATE TABLE tipo_servicio (
  codigo                  text PRIMARY KEY,
  nombre                  text NOT NULL,
  -- Periodicidad sugerida en dias; NULL cuando no es recurrente por si sola.
  periodicidad_dias       int,
  -- Marca los servicios que generan una Aplicacion con refuerzo (RF-14).
  genera_aplicacion       boolean NOT NULL DEFAULT false,
  orden                   int NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Rutina (RF-05)
-- ---------------------------------------------------------------------------

CREATE TABLE rutina (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuaria_id              uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  mascota_id              uuid NOT NULL REFERENCES mascota(id) ON DELETE CASCADE,
  proveedor_id            uuid NOT NULL REFERENCES proveedor(id),
  tipo_servicio           text NOT NULL REFERENCES tipo_servicio(codigo),
  -- Frecuencia "en semanas o meses" (RF-05): se guarda la unidad, no solo un
  -- numero de dias, porque "cada mes" y "cada 30 dias" se desfasan al cabo de
  -- un ano y la usuaria espera "el mismo dia del mes".
  frecuencia_cantidad     int NOT NULL CHECK (frecuencia_cantidad > 0),
  frecuencia_unidad       text NOT NULL CHECK (frecuencia_unidad IN ('semanas','meses')),
  costo_referencia        numeric(10,2),
  -- RF-08: el disparo de la consulta de disponibilidad es configurable por rutina.
  dias_anticipacion       int NOT NULL DEFAULT 21 CHECK (dias_anticipacion > 0),
  proxima_fecha_estimada  date NOT NULL,
  activa                  boolean NOT NULL DEFAULT true,
  creada_en               timestamptz NOT NULL DEFAULT now(),
  actualizada_en          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rutina_proxima ON rutina (proxima_fecha_estimada) WHERE activa;
CREATE INDEX rutina_usuaria ON rutina (usuaria_id);
CREATE INDEX rutina_mascota ON rutina (mascota_id);

-- ---------------------------------------------------------------------------
-- Cita (RF-07)
-- ---------------------------------------------------------------------------

-- Estados de la seccion 07, tal cual.
CREATE TYPE estado_cita AS ENUM (
  'solicitada',
  'por_confirmar_con_proveedor',
  'confirmada',
  'cumplida',
  'reagendada',
  'cancelada',
  'requiere_atencion_humana'
);

CREATE TABLE cita (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuaria_id              uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  mascota_id              uuid NOT NULL REFERENCES mascota(id) ON DELETE CASCADE,
  proveedor_id            uuid NOT NULL REFERENCES proveedor(id),
  -- NULL cuando es una cita puntual (RF-07).
  rutina_id               uuid REFERENCES rutina(id) ON DELETE SET NULL,
  tipo_servicio           text NOT NULL REFERENCES tipo_servicio(codigo),
  estado                  estado_cita NOT NULL DEFAULT 'solicitada',
  -- Instante exacto de la cita. Se almacena en UTC (RNF-02); la zona horaria
  -- para presentarla sale de usuaria.zona_horaria.
  inicia_en               timestamptz NOT NULL,
  -- Costo que el proveedor confirmo al apartar. NULL = "costo por confirmar",
  -- y asi se le comunica a la usuaria (seccion 05).
  costo_confirmado        numeric(10,2),
  -- Costo que realmente se pago, capturado en el cierre T+1 (RF-21).
  costo_real              numeric(10,2),
  -- Indicaciones del proveedor para el aviso del dia: ayuno, llevar carnet,
  -- transportadora.
  indicaciones            text,
  -- Cita que la sustituye cuando se reagenda.
  reagendada_a_cita_id    uuid REFERENCES cita(id),
  motivo_cancelacion      text,
  creada_en               timestamptz NOT NULL DEFAULT now(),
  actualizada_en          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cita_usuaria_fecha ON cita (usuaria_id, inicia_en DESC);
CREATE INDEX cita_mascota_fecha ON cita (mascota_id, inicia_en DESC);
CREATE INDEX cita_proveedor_fecha ON cita (proveedor_id, inicia_en);
CREATE INDEX cita_estado ON cita (estado, inicia_en);

-- ---------------------------------------------------------------------------
-- Recordatorio (RF-12, RF-15)
-- ---------------------------------------------------------------------------

CREATE TYPE momento_recordatorio AS ENUM ('t_21', 't_7', 't_3', 't_0', 'cierre');
CREATE TYPE estado_entrega AS ENUM ('programado', 'enviando', 'enviado', 'entregado', 'leido', 'fallido', 'cancelado');

CREATE TABLE recordatorio (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cita_id             uuid NOT NULL REFERENCES cita(id) ON DELETE CASCADE,
  usuaria_id          uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  momento             momento_recordatorio NOT NULL,
  canal               text NOT NULL DEFAULT 'whatsapp',
  programado_para     timestamptz NOT NULL,
  -- Contenido exacto que se envio, congelado. Si manana cambia la plantilla,
  -- la bitacora debe seguir mostrando lo que la usuaria realmente leyo.
  contenido_enviado   text,
  plantilla           text,
  estado              estado_entrega NOT NULL DEFAULT 'programado',
  enviado_en          timestamptz,
  entregado_en        timestamptz,
  leido_en            timestamptz,
  intentos            int NOT NULL DEFAULT 0,
  ultimo_error        text,
  -- id del mensaje en el proveedor de WhatsApp, para casar los webhooks de
  -- entrega y lectura (RF-15).
  id_externo          text,
  creado_en           timestamptz NOT NULL DEFAULT now()
);

-- Un solo recordatorio por momento y por cita.
CREATE UNIQUE INDEX recordatorio_cita_momento ON recordatorio (cita_id, momento);
CREATE INDEX recordatorio_pendientes ON recordatorio (programado_para)
  WHERE estado IN ('programado', 'enviando', 'fallido');
CREATE INDEX recordatorio_id_externo ON recordatorio (id_externo) WHERE id_externo IS NOT NULL;

-- RF-13: la usuaria puede desactivar recordatorios individuales.
CREATE TABLE recordatorio_desactivado (
  usuaria_id      uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  momento         momento_recordatorio NOT NULL,
  PRIMARY KEY (usuaria_id, momento)
);

-- ---------------------------------------------------------------------------
-- Documento (RF-16) y Aplicacion (RF-17)
-- ---------------------------------------------------------------------------

CREATE TYPE tipo_documento AS ENUM ('carnet', 'receta', 'estudio', 'comprobante', 'foto', 'otro');

CREATE TABLE documento (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuaria_id          uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  mascota_id          uuid REFERENCES mascota(id) ON DELETE CASCADE,
  tipo                tipo_documento NOT NULL,
  -- Ruta en el almacen de archivos con acceso restringido (seccion 08).
  ruta_archivo        text NOT NULL,
  nombre_original     text,
  tipo_mime           text NOT NULL,
  bytes               bigint NOT NULL,
  -- Checksum para detectar cargas duplicadas del mismo carnet.
  sha256              text,
  cargado_en          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documento_mascota ON documento (mascota_id, cargado_en DESC);

ALTER TABLE mascota
  ADD CONSTRAINT mascota_foto_fk
  FOREIGN KEY (foto_documento_id) REFERENCES documento(id) ON DELETE SET NULL;

CREATE TABLE aplicacion (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mascota_id              uuid NOT NULL REFERENCES mascota(id) ON DELETE CASCADE,
  -- Puede venir de una Cita (seccion 07) o capturarse suelta desde el carnet.
  cita_id                 uuid REFERENCES cita(id) ON DELETE SET NULL,
  documento_id            uuid REFERENCES documento(id) ON DELETE SET NULL,
  tipo_servicio           text REFERENCES tipo_servicio(codigo),
  producto                text NOT NULL,      -- vacuna o producto
  marca                   text,
  lote                    text,
  fecha_aplicacion        date NOT NULL,
  fecha_refuerzo          date,               -- alimenta RF-14
  veterinario             text,
  cedula_profesional      text,
  creada_en               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX aplicacion_mascota ON aplicacion (mascota_id, fecha_aplicacion DESC);
CREATE INDEX aplicacion_refuerzo ON aplicacion (fecha_refuerzo) WHERE fecha_refuerzo IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Interaccion (evidencia, seccion 05 y RNF-09)
-- ---------------------------------------------------------------------------

CREATE TYPE direccion_interaccion AS ENUM ('saliente', 'entrante');

CREATE TABLE interaccion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cita_id             uuid REFERENCES cita(id) ON DELETE CASCADE,
  proveedor_id        uuid REFERENCES proveedor(id) ON DELETE SET NULL,
  usuaria_id          uuid REFERENCES usuaria(id) ON DELETE SET NULL,
  canal               text NOT NULL,          -- whatsapp | llamada | integracion | manual
  direccion           direccion_interaccion NOT NULL,
  -- Transcripcion de la llamada o captura del hilo de WhatsApp. Es la evidencia
  -- que exige la seccion 05 y que debe quedar junto a la cita.
  contenido           text,
  resultado           text,                   -- cita_apartada | sin_respuesta | horario_no_disponible | ambiguo | ...
  -- Quien actuo: 'agente' o el id de la operadora interna.
  actor               text NOT NULL DEFAULT 'agente',
  ocurrio_en          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX interaccion_cita ON interaccion (cita_id, ocurrio_en);
-- Sirve para el limite de contacto por proveedor (pregunta abierta 4): cuantas
-- veces se le ha escrito o llamado a este negocio en las ultimas N horas.
CREATE INDEX interaccion_proveedor ON interaccion (proveedor_id, ocurrio_en DESC);

-- ---------------------------------------------------------------------------
-- Bandeja de excepciones (RF-10, RF-24)
-- ---------------------------------------------------------------------------

CREATE TYPE estado_caso AS ENUM ('abierto', 'en_proceso', 'resuelto', 'descartado');

CREATE TABLE caso_excepcion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cita_id             uuid REFERENCES cita(id) ON DELETE CASCADE,
  usuaria_id          uuid REFERENCES usuaria(id) ON DELETE CASCADE,
  motivo              text NOT NULL,          -- proveedor_sin_respuesta | horario_no_disponible | respuesta_ambigua | envio_fallido
  detalle             text,
  estado              estado_caso NOT NULL DEFAULT 'abierto',
  -- Criterio de aceptacion: un caso no resuelto aparece en la bandeja en menos
  -- de una hora. Se mide contra este campo.
  abierto_en          timestamptz NOT NULL DEFAULT now(),
  asignado_a          uuid,
  resuelto_en         timestamptz,
  resolucion          text
);

CREATE INDEX caso_excepcion_abiertos ON caso_excepcion (abierto_en) WHERE estado IN ('abierto','en_proceso');

-- ---------------------------------------------------------------------------
-- Suscripcion (RF-23)
-- ---------------------------------------------------------------------------

CREATE TABLE suscripcion (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuaria_id              uuid NOT NULL REFERENCES usuaria(id) ON DELETE CASCADE,
  estado                  estado_suscripcion NOT NULL DEFAULT 'prueba',
  prueba_termina_en       timestamptz,
  periodo_actual_termina_en timestamptz,
  precio_mensual          numeric(10,2) NOT NULL,
  id_externo              text,               -- id en la pasarela de cobro
  metodo_pago_resumen     text,               -- "Visa ****4242"
  cancelada_en            timestamptz,
  creada_en               timestamptz NOT NULL DEFAULT now(),
  actualizada_en          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX suscripcion_usuaria_unica ON suscripcion (usuaria_id) WHERE cancelada_en IS NULL;

CREATE TABLE cobro (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suscripcion_id  uuid NOT NULL REFERENCES suscripcion(id) ON DELETE CASCADE,
  monto           numeric(10,2) NOT NULL,
  estado          text NOT NULL,              -- exitoso | fallido | reembolsado
  id_externo      text,
  ocurrio_en      timestamptz NOT NULL DEFAULT now(),
  detalle         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX cobro_suscripcion ON cobro (suscripcion_id, ocurrio_en DESC);

-- ---------------------------------------------------------------------------
-- Equipo interno: control por rol y bitacora de consultas (RNF-06)
-- ---------------------------------------------------------------------------

CREATE TYPE rol_interno AS ENUM ('operadora', 'supervisora', 'administradora');

CREATE TABLE usuario_interno (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correo          text NOT NULL UNIQUE,
  nombre          text NOT NULL,
  rol             rol_interno NOT NULL DEFAULT 'operadora',
  contrasena_hash text NOT NULL,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now()
);

-- RNF-06: bitacora de consultas. Toda lectura de datos personales desde el
-- panel queda registrada, no solo las escrituras.
CREATE TABLE bitacora_acceso (
  id                  bigserial PRIMARY KEY,
  usuario_interno_id  uuid REFERENCES usuario_interno(id) ON DELETE SET NULL,
  accion              text NOT NULL,          -- consulta | modificacion | exportacion | borrado
  entidad             text NOT NULL,
  entidad_id          text,
  usuaria_afectada_id uuid,
  detalle             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ocurrio_en          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bitacora_acceso_fecha ON bitacora_acceso (ocurrio_en DESC);
CREATE INDEX bitacora_acceso_usuaria ON bitacora_acceso (usuaria_afectada_id, ocurrio_en DESC);

-- RNF-09: bitacora de lo que hace el agente automatico. Separada de la de
-- accesos humanos porque se consulta para otra cosa: depurar al agente.
CREATE TABLE bitacora_agente (
  id                  bigserial PRIMARY KEY,
  cita_id             uuid REFERENCES cita(id) ON DELETE SET NULL,
  proveedor_id        uuid REFERENCES proveedor(id) ON DELETE SET NULL,
  accion              text NOT NULL,
  detalle             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ocurrio_en          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bitacora_agente_fecha ON bitacora_agente (ocurrio_en DESC);
