# Huella — Documento de requerimientos · v1.0

> Transcripción del documento de negocio original (PDF) a Markdown, para poder
> versionarlo junto al código y citarlo desde los comentarios. **El contenido no
> se modificó.** Si alguna vez discrepan, manda el PDF firmado.

**Autora:** Ana Sofía García León · **Fecha:** 17 de septiembre de 2026
**Mercado inicial:** Ciudad de México · **Nombre:** provisional

Asistente que agenda, recuerda y documenta el cuidado de una mascota: baños,
veterinario y carnet de vacunación, en un solo lugar.

---

## 01 · Qué resuelve

Quien tiene perro o gato repite las mismas tareas todo el año: baño y corte cada
cierto tiempo, vacunas, desparasitación, consultas. Cada una implica acordarse,
llamar o escribir al negocio, negociar un horario y preguntar el precio. Es
trabajo pequeño pero constante, y lo que falla no es la intención sino la
memoria.

Hoy los sistemas que mandan recordatorios pertenecen a cada clínica o estética
por separado, y solo sirven para sus propios clientes. Nadie cubre el lado de la
dueña, que suele usar dos o tres negocios distintos.

Huella hace el trabajo por ella. La usuaria registra a su mascota y sus rutinas
una sola vez; el sistema le pregunta con anticipación qué fecha le acomoda,
agenda la cita con el negocio, y luego la avisa varias veces con fecha, hora,
lugar y costo. Además guarda el carnet de vacunación en digital para no cargar
papeles.

## 02 · Usuaria y actores

**Actores del sistema**

- **Usuaria final.** Dueña de una o más mascotas. Es quien paga la suscripción.
  Interactúa por WhatsApp o por la app.
- **Proveedor.** Estética canina, veterinaria, guardería o paseador. En la
  primera etapa no usa el sistema: se le contacta por teléfono o WhatsApp como
  lo haría cualquier cliente.
- **Agente de agendamiento.** Componente del sistema que contacta al proveedor
  para pedir la cita y confirmar el precio. Puede ser un agente de voz con IA, un
  flujo de WhatsApp, o una persona del equipo en la etapa piloto.
- **Operadora interna.** Persona del equipo que supervisa, resuelve casos que el
  agente no pudo cerrar y atiende reclamos.

**Fuera de alcance en la primera versión**

- Panel o software de gestión para el proveedor (agenda, inventario, punto de
  venta). Ese mercado ya está atendido.
- Consulta veterinaria en línea o cualquier orientación médica.
- Cobro del servicio de la estética o la veterinaria. La usuaria paga directo en
  el negocio.
- Directorio de proveedores con precios y reseñas. Es una etapa posterior ya
  contemplada, descrita en la sección 11; conviene que la arquitectura la
  anticipe, no que se construya ahora.

## 03 · Flujo principal

Este es el corazón del producto y la secuencia debe respetarse tal cual.
Ejemplo: la usuaria registró «baño mensual en Petco Polanco».

| Momento | Qué pasa |
|---|---|
| **Registro** (una sola vez) | La usuaria define la rutina: mascota, servicio, proveedor y sucursal, frecuencia, y sus preferencias de horario y días. |
| **T − 21 días** | El sistema pregunta disponibilidad. Mensaje con opciones concretas de día y franja horaria, derivadas de las preferencias guardadas. La usuaria responde eligiendo una. |
| **T − 21 días** (mismo día) | El sistema agenda y confirma. Contacta al proveedor, aparta la cita, confirma el costo y le avisa a la usuaria: fecha, hora, sucursal, dirección y precio. Si el horario elegido no estaba libre, ofrece la alternativa más cercana antes de cerrar. |
| **T − 7 días** | Recordatorio. Mismos datos completos. Incluye opción de reagendar o cancelar. |
| **T − 3 días** | Recordatorio. Mismos datos completos. |
| **T − 0, en la mañana** | Aviso del día. Mismos datos, más indicaciones del proveedor si las hay (ayuno, llevar carnet, transportadora). |
| **T + 1 día** | Cierre. Confirma que la cita se cumplió, registra el costo real y programa el siguiente ciclo de la rutina. |

> ### REGLA DE CONTENIDO
>
> Todo aviso, sin excepción, incluye los cuatro datos: **qué servicio, cuándo,
> dónde y cuánto cuesta.** Un recordatorio incompleto obliga a la usuaria a
> buscar la información, que es justo lo que el producto elimina.

**Ejemplo de mensaje — T − 7 días**

> Recordatorio: el jueves 25 de octubre a las 11:00 tienes el baño de Lola en
> Petco Polanco (Av. Presidente Masaryk 275). Costo estimado: $450. ¿Necesitas
> cambiarla? Responde REAGENDAR.

## 04 · Requerimientos funcionales

Las etiquetas marcan si el requerimiento entra en el producto mínimo o en una
etapa posterior.

### Perfil y mascotas

| # | Requerimiento | Etapa |
|---|---|---|
| RF-01 | Alta de usuaria con número de celular verificado por código. | MVP |
| RF-02 | Registro de una o varias mascotas: nombre, especie, raza, fecha de nacimiento aproximada, peso, sexo, esterilización, foto y notas de manejo (nerviosa, reactiva, alergias conocidas). | MVP |
| RF-03 | Preferencias de agenda por usuaria: días y franjas horarias viables, con orden de prioridad. Estas preferencias alimentan las opciones que se le ofrecen en T − 21 días. | MVP |

### Proveedores y rutinas

| # | Requerimiento | Etapa |
|---|---|---|
| RF-04 | Alta de proveedor por parte de la usuaria: nombre del negocio, sucursal, dirección, teléfono y WhatsApp, y canal preferido de contacto. | MVP |
| RF-05 | Alta de rutina recurrente: mascota, tipo de servicio, proveedor, frecuencia (en semanas o meses) y costo de referencia. | MVP |
| RF-06 | Catálogo interno de tipos de servicio con su periodicidad sugerida: baño, corte, consulta, vacunación, desparasitación, antipulgas, limpieza dental, guardería. | MVP |
| RF-07 | Cita de una sola vez, sin rutina asociada, para necesidades puntuales. | MVP |

### Agendamiento

| # | Requerimiento | Etapa |
|---|---|---|
| RF-08 | Disparo automático de la consulta de disponibilidad 21 días antes de la fecha estimada de cada rutina, configurable por rutina. | MVP |
| RF-09 | Contacto con el proveedor para apartar la cita y confirmar el precio vigente. Detalle en la sección 05. | MVP |
| RF-10 | Manejo de excepciones: si el proveedor no contesta después de tres intentos en 24 horas, o no tiene el horario pedido, el caso entra a una bandeja de revisión humana y se le avisa a la usuaria. | MVP |
| RF-11 | Reagendar o cancelar desde el mismo hilo de conversación, con notificación al proveedor. | MVP |

### Recordatorios

| # | Requerimiento | Etapa |
|---|---|---|
| RF-12 | Envío automático de avisos en T − 21, T − 7, T − 3 y T − 0, cada uno con servicio, fecha, hora, lugar, dirección y costo. | MVP |
| RF-13 | Cada usuaria puede desactivar recordatorios individuales o cambiar la hora de envío del aviso del día. | MVP |
| RF-14 | Alertas independientes por vencimiento de vacuna o desparasitación, calculadas a partir de la última aplicación registrada. | MVP |
| RF-15 | Registro de entrega y lectura de cada aviso, para detectar fallas de envío. | MVP |

### Carnet de vacunación digital

| # | Requerimiento | Etapa |
|---|---|---|
| RF-16 | Carga de documentos por foto o PDF: carnet físico, recetas, estudios, comprobantes. | MVP |
| RF-17 | Registro estructurado de aplicaciones: vacuna o producto, marca, lote, fecha de aplicación, fecha del siguiente refuerzo, veterinario y cédula profesional. | MVP |
| RF-18 | Vista de carnet para mostrar en el mostrador de la veterinaria: legible en pantalla de celular, funcional sin conexión y exportable a PDF. **Es el momento de uso más crítico del producto: la usuaria está parada frente al mostrador, a veces con mala señal.** | MVP |
| RF-19 | Lectura automática del carnet fotografiado para prellenar fechas y vacunas, con revisión de la usuaria antes de guardar. | FASE 3 |
| RF-20 | Compartir el expediente de una mascota por enlace temporal, para una pensión o un cuidador. | FASE 3 |

### Historial y costos

| # | Requerimiento | Etapa |
|---|---|---|
| RF-21 | Historial por mascota con todas las citas pasadas, su costo real y el proveedor. | MVP |
| RF-22 | Resumen de gasto por mascota y por periodo. | FASE 3 |

### Suscripción y administración

| # | Requerimiento | Etapa |
|---|---|---|
| RF-23 | Cobro de suscripción mensual con tarjeta o domiciliación, con periodo de prueba y cancelación desde la misma conversación. | MVP |
| RF-24 | Panel interno para el equipo: citas del día, casos atrabancados en la bandeja de excepciones, historial de conversaciones con proveedores y estado de cada suscripción. | MVP |
| RF-25 | Aplicación móvil con el carnet, el calendario y el historial. La conversación por WhatsApp sigue siendo el canal principal aun cuando exista la app. | FASE 3 |

## 05 · Agendamiento asistido — el punto difícil

Los recordatorios y el carnet son trabajo conocido. La parte que define el
producto es que el sistema consiga la cita sin que la usuaria mueva un dedo, y
ahí está el riesgo técnico: cada negocio agenda distinto. Algunos tienen
reservación en línea, la mayoría contesta WhatsApp, y muchos solo teléfono.

**Tres vías, en este orden de preferencia**

1. **WhatsApp al proveedor.** Un flujo conversacional pide la cita, interpreta la
   respuesta libre del negocio y confirma. Es el canal más barato y deja
   evidencia escrita del precio acordado.
2. **Llamada con agente de voz.** Para negocios que solo atienden por teléfono.
   El agente marca, pide la cita, pregunta el costo y transcribe la llamada.
3. **Integración directa.** Para cadenas grandes con reservación en línea, o para
   negocios que en el futuro se den de alta con sus horarios y precios. Es la vía
   más confiable y la más lenta de construir.

**Reglas que aplican a cualquiera de las tres**

- El agente se identifica como asistente que agenda a nombre de una clienta, y da
  el nombre de la dueña y de la mascota. **No se hace pasar por persona.**
- Toda cita queda con evidencia: transcripción de la llamada o captura del hilo
  de WhatsApp, guardada junto a la cita.
- El agente siempre pregunta el precio y lo registra. Si el proveedor no lo da,
  la cita se marca como «costo por confirmar» y así se le comunica a la usuaria.
- El agente no negocia ni promete pagos ni deja tarjeta. Solo aparta.
- Cualquier respuesta ambigua del proveedor escala a la bandeja humana en lugar
  de asumir.

> **Recomendación de arranque.** Durante el piloto, la operadora interna hace
> este contacto a mano mientras el resto del sistema ya funciona automatizado.
> Cada conversación real se guarda como insumo para entrenar y probar el agente.
> Automatizar antes de tener ese material lleva a un agente que falla justo en
> los casos que importan.

## 06 · Requerimientos no funcionales

| # | Requerimiento |
|---|---|
| RNF-01 | Interfaz y todos los mensajes en español de México. Fechas en formato local y montos en pesos. |
| RNF-02 | Todas las fechas y horas se manejan en la zona horaria de la usuaria, con almacenamiento en UTC. El cambio de horario no debe correr ningún recordatorio. |
| RNF-03 | Los recordatorios se envían con una tolerancia máxima de 15 minutos respecto de su hora programada. Un aviso tarde es un aviso inútil. |
| RNF-04 | Reintento automático de envíos fallidos y alerta al panel interno si un aviso no salió. |
| RNF-05 | El carnet debe abrir en menos de 3 segundos y estar disponible sin conexión una vez descargado. |
| RNF-06 | Datos personales y documentos cifrados en tránsito y en reposo. Acceso al panel interno con control por rol y bitácora de consultas. |
| RNF-07 | Respaldo diario de la base y de los documentos, con restauración probada. |
| RNF-08 | El sistema debe soportar 500 usuarias activas y unas 1,500 citas al mes sin cambios de arquitectura. |
| RNF-09 | Toda acción del agente automático queda en bitácora consultable: a quién contactó, cuándo, qué dijo y qué se acordó. |

## 07 · Modelo de datos

Entidades mínimas sugeridas. El ingeniero puede ajustar la estructura; lo que no
debe perderse son las relaciones y los campos marcados como clave.

| Entidad | Campos clave | Relaciones |
|---|---|---|
| **Usuaria** | Celular verificado, nombre, zona horaria, preferencias de agenda, estado de suscripción | Tiene muchas Mascotas y muchos Proveedores |
| **Mascota** | Nombre, especie, raza, nacimiento, peso, notas de manejo, foto | Pertenece a una Usuaria |
| **Proveedor** | Negocio, sucursal, dirección, teléfono, WhatsApp, canal preferido, horarios conocidos | **Compartido entre Usuarias cuando es el mismo negocio** |
| **Rutina** | Tipo de servicio, frecuencia, costo de referencia, activa o pausada, próxima fecha estimada | Une Mascota con Proveedor |
| **Cita** | Fecha y hora, estado, costo confirmado, costo real, indicaciones del proveedor, evidencia | Deriva de una Rutina o es puntual |
| **Recordatorio** | Momento programado, canal, contenido enviado, estado de entrega y lectura | Pertenece a una Cita |
| **Documento** | Tipo, archivo, fecha de carga | Pertenece a una Mascota |
| **Aplicación** | Producto, marca, lote, fecha aplicada, fecha de refuerzo, veterinario, cédula | Pertenece a una Mascota; puede venir de una Cita |
| **Interacción** | Canal, dirección, transcripción o mensajes, resultado, fecha | Liga Cita con Proveedor |

**Estados de una cita:** `solicitada` → `por confirmar con proveedor` →
`confirmada` → `cumplida`.
**Estados alternos:** `reagendada`, `cancelada`, `requiere atención humana`.

## 08 · Integraciones

No se pide una tecnología en particular; se enlistan las piezas que el sistema
necesita comprar o conectar. El ingeniero propone el proveedor concreto.

- **Mensajería por WhatsApp.** Se requiere la API oficial de WhatsApp Business,
  no un número personal. **Punto crítico:** los mensajes que el sistema inicia
  fuera de la ventana de 24 horas deben usar plantillas aprobadas previamente por
  Meta, y todos los recordatorios caen en ese caso. Hay que diseñar y dar de alta
  las plantillas desde el inicio, contemplando los campos variables (mascota,
  fecha, hora, sucursal, costo).
- **Telefonía y agente de voz.** Salida de llamadas con voz sintética en español
  mexicano, reconocimiento de la respuesta y transcripción almacenada.
- **Modelo de lenguaje.** Para interpretar las respuestas libres de la usuaria y
  del proveedor, y para redactar la petición de cita.
- **Programador de tareas.** Cola confiable de trabajos futuros que dispare cada
  recordatorio y cada consulta de disponibilidad. **Es el componente del que
  depende toda la promesa del producto.**
- **Almacenamiento de archivos** con acceso restringido, para carnets y
  documentos.
- **Cobros recurrentes** con una pasarela que opere en México y acepte tarjetas
  nacionales.
- **Notificaciones push y sincronización con el calendario** del celular, cuando
  exista la app.

## 09 · Legal y privacidad

El sistema maneja datos personales de las usuarias, así que hay obligaciones que
deben quedar resueltas en el diseño y no al final.

- **Aviso de privacidad** conforme a la legislación mexicana de protección de
  datos personales en posesión de particulares, aceptado y registrado en el alta
  de cada usuaria, con la fecha y versión del aviso que aceptó.
- **Consentimiento para actuar en su nombre.** La usuaria autoriza expresamente
  que el sistema la represente para agendar y para compartir su nombre y el de su
  mascota con el proveedor.
- **Grabación de llamadas.** Si se graban o transcriben, hay que avisarlo al
  inicio de la llamada y guardar el consentimiento.
- **Transparencia de la IA.** El agente declara que no es una persona. Además de
  ser correcto, evita fricción con negocios que se sienten engañados y dejan de
  atender.
- **Derechos de acceso, rectificación, cancelación y oposición:** debe existir la
  forma de exportar y de borrar todos los datos de una usuaria a solicitud.
- **Baja de suscripción tan sencilla como el alta.**

> **Por verificar.** La normativa mexicana de datos personales se reformó
> recientemente y conviene que un abogado confirme la redacción del aviso de
> privacidad y la autoridad ante la que se registra, antes del lanzamiento
> público.

## 10 · Fases de entrega

Se busca que cada fase se pague con lo que la anterior demostró. No se pide
construir todo de una vez.

| Fase | Qué incluye |
|---|---|
| **FASE 0 — Piloto manual** | Sin desarrollo. El equipo agenda y recuerda a mano para 10 a 20 usuarias. Sirve para descubrir cómo agenda cada negocio y qué preguntas hace. Produce el guion del agente. |
| **FASE 1 — Base automatizada** | RF-01 a RF-08, RF-12 a RF-18, RF-21, RF-23 y RF-24. La conversación con la usuaria y los recordatorios ya son automáticos; el contacto con el proveedor sigue siendo humano desde el panel. |
| **FASE 2 — Agente de agendamiento** | RF-09 a RF-11. Primero WhatsApp al proveedor, después llamadas con voz. Se mide qué porcentaje de citas se cierra sin intervención humana. |
| **FASE 3 — App y extras** | RF-19, RF-20, RF-22 y RF-25. Aplicación móvil, lectura automática del carnet y reportes de gasto. |
| **FASE 4 — Directorio** | RF-26 a RF-34. Catálogo de veterinarias y estéticas con precios, ubicación y reseñas, y reservación directa. Cambia el modelo de negocio, así que va al final. |

## 11 · Directorio de proveedores (evolución del producto)

Una vez que el asistente funcione, el siguiente paso es resolver a la dueña que
no tiene veterinaria ni estética de cabecera: que pueda elegir entre varias con
toda la información a la vista y reservar ahí mismo. El modelo de referencia es
Doctoralia, adaptado a mascotas.

Esto no es solo una función más. Cambia el producto en dos sentidos y por eso se
planea desde ahora aunque se construya al final.

- **Resuelve el punto técnico más difícil.** Un proveedor dado de alta en el
  directorio, con sus horarios y precios en el sistema, se reserva por
  integración directa: la vía más confiable de las tres descritas en la sección
  05. Deja de hacer falta la llamada o el WhatsApp para ese negocio.
- **Agrega una segunda fuente de ingreso.** Además de la suscripción de la
  usuaria, el negocio puede pagar por su perfil, por aparecer destacado o por
  cita concretada.

### Qué incluye el perfil de un proveedor

| # | Requerimiento | Etapa |
|---|---|---|
| RF-26 | Perfil público del negocio: nombre, sucursales, fotos, horarios de atención, teléfono y WhatsApp. | FASE 4 |
| RF-27 | Lista de servicios con precio, tiempo estimado y variación por talla o raza. *El precio de una estética depende del tamaño y el pelo del perro, así que el campo no puede ser un solo número: se necesita un rango o una tabla por talla.* | FASE 4 |
| RF-28 | Especialidades y datos que importan al elegir: si atiende gatos o especies exóticas, si hay urgencias 24 horas, si tiene quirófano, laboratorio o servicio a domicilio. | FASE 4 |
| RF-29 | Búsqueda por cercanía con la ubicación de la usuaria, con filtros por servicio, rango de precio, horario y calificación. | FASE 4 |
| RF-30 | Reseñas y calificación, únicamente de usuarias con una cita cumplida registrada en el sistema. *Es la ventaja frente a las reseñas de internet, donde cualquiera opina.* | FASE 4 |
| RF-31 | Reservación directa desde el perfil, contra la disponibilidad real del negocio, sin llamada ni intermediación. | FASE 4 |
| RF-32 | Panel para el proveedor: actualizar sus datos, precios, horarios y disponibilidad, y responder reseñas. | FASE 4 |
| RF-33 | Sello de verificación del negocio, con validación de su existencia y de la cédula profesional del médico responsable. | FASE 4 |
| RF-34 | Cobro al proveedor: plan de perfil, posición destacada o comisión por cita concretada. | FASE 4 |

### Lo que hay que resolver antes de construirlo

- **El arranque de los dos lados.** Un directorio vacío no sirve a nadie y ningún
  negocio se da de alta en un directorio sin usuarias. La ventaja aquí es que las
  primeras usuarias ya traen a sus propios proveedores al registrarlos: esos
  negocios son la semilla del catálogo y ya tienen un motivo para darse de alta,
  porque ya les están llegando citas.
- **Precios que envejecen.** Un precio equivocado en el directorio destruye la
  confianza. Cada precio debe guardar su fecha de última actualización y
  mostrarse como estimado si pasó cierto tiempo.
- **Responsabilidad.** El sistema lista y compara negocios; no recomienda
  tratamientos ni opina sobre la calidad médica. Conviene que esa frontera quede
  escrita en los términos de uso.
- **Moderación de reseñas.** Reglas publicadas, derecho de réplica del negocio y
  un procedimiento para bajar contenido difamatorio.

> ### Consecuencia para el diseño actual
>
> El modelo de datos de la sección 07 ya trata al Proveedor como una entidad
> **compartida entre usuarias**, no como un contacto privado de cada una. Esa
> decisión es la que permite que el directorio nazca del catálogo que las
> usuarias mismas van construyendo. Conviene que el ingeniero la respete desde la
> primera versión, aunque el directorio tarde en llegar.

## 12 · Criterios de aceptación

La Fase 1 se da por entregada cuando se cumple lo siguiente con usuarias reales:

1. Una usuaria puede registrar mascota, proveedor y rutina en menos de cinco
   minutos, sin ayuda.
2. Los cuatro recordatorios de una cita salen en su momento programado, con los
   cuatro datos completos, durante un ciclo entero.
3. Ningún recordatorio se envía con más de 15 minutos de retraso en una muestra
   de 50 envíos.
4. El carnet abre y se lee en el celular, sin conexión, y se puede mostrar en el
   mostrador de una veterinaria.
5. Reagendar desde la conversación actualiza la cita y recalcula los
   recordatorios pendientes.
6. Toda cita tiene evidencia asociada y un costo registrado, o está marcada como
   «costo por confirmar».
7. Un caso que el sistema no pudo resolver aparece en la bandeja interna en menos
   de una hora.
8. La usuaria puede cancelar su suscripción y solicitar el borrado de sus datos.

## 13 · Preguntas abiertas

Puntos que se necesitan resolver con el ingeniero antes de cotizar o empezar:

1. ¿Conviene arrancar como conversación de WhatsApp únicamente, o desde el
   principio con una aplicación? ¿Qué costo y qué tiempo implica cada camino?
2. ¿Qué proveedor de la API de WhatsApp Business recomienda para México, y cuánto
   cuesta por conversación con el volumen previsto?
3. ¿Qué tan confiable resulta hoy un agente de voz en español mexicano para una
   llamada de este tipo, y cuál sería el costo por llamada?
4. ¿Cómo se maneja que un mismo negocio sea proveedor de varias usuarias sin
   duplicar registros ni saturarlo con llamadas?
5. ¿Qué se necesita para que el carnet funcione sin conexión con la arquitectura
   propuesta?
6. ¿Cuál es el costo mensual de infraestructura estimado con 500 usuarias
   activas?
7. ¿Qué decisiones de arquitectura conviene tomar desde la Fase 1 para que el
   directorio de la sección 11 no obligue a rehacer el sistema? En particular, el
   manejo de proveedores compartidos, servicios con precio y ubicación
   geográfica.
8. ¿Qué parte de este alcance considera riesgosa o mal dimensionada, y qué
   recortaría de la Fase 1?
9. ¿Cuánto tiempo y cuánto presupuesto estima para llegar a la Fase 1 funcionando
   con usuarias reales?

> **Las respuestas están en [respuesta-tecnica.md](respuesta-tecnica.md).**

---

*Documento de requerimientos de negocio, versión 1.0 · Preparado por Ana Sofía
García León · 17 de septiembre de 2026 · Este documento describe qué debe hacer
el sistema, no cómo debe construirse; las decisiones técnicas quedan a criterio
del ingeniero.*
