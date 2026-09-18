# Huella — Respuesta técnica

Respuesta a las nueve preguntas abiertas de la sección 13 del documento de
requerimientos v1.0, más lo que hace falta decir antes de cotizar.

**Fecha:** 18 de septiembre de 2026 · **Documento base:** requerimientos v1.0 del
17 de septiembre de 2026.

---

## Advertencia sobre las cifras

Los precios de este documento vienen de tarifas públicas y de experiencia de
proyectos comparables, no de cotizaciones. Tres de ellos se mueven rápido y hay
que reconfirmarlos **antes de comprometer un presupuesto**:

| Cifra | Volatilidad | Cómo verificarla |
|---|---|---|
| Precio por mensaje de WhatsApp en México | Alta. Meta cambió el modelo de cobro en 2024 y otra vez en 2025 | Lista oficial de precios por país y categoría en la documentación de la Cloud API |
| Costo por minuto de un agente de voz | Alta. Es el renglón que más ha bajado | Cotización directa con dos proveedores, con una prueba real |
| Infraestructura | Media | Calculadora del proveedor que se elija |

Todas las cantidades en pesos usan un tipo de cambio de referencia de **$18 MXN
por dólar**; conviene rehacer la conversión al cotizar.

---

## 1. ¿WhatsApp únicamente, o desde el principio una aplicación?

**Recomendación: WhatsApp para la conversación, más una página web instalable
(PWA) para el carnet. Ninguna app de tienda en la Fase 1.**

La pregunta parece de preferencia y no lo es: **el propio documento ya la
contestó a medias en RF-18**, y conviene verlo antes de decidir.

> RF-18: "Vista de carnet [...] legible en pantalla de celular, **funcional sin
> conexión** y exportable a PDF."

WhatsApp no puede cumplir eso. Un mensaje de WhatsApp con el carnet es una
imagen o un PDF que la usuaria tiene que encontrar entre meses de conversación,
y que no se actualiza cuando registra una vacuna nueva. "Sin conexión" exige
algo que guarde datos en el teléfono y los muestre sin red. Así que **la Fase 1
no puede ser solo WhatsApp** si RF-18 se mantiene como está escrito.

De ahí las tres opciones reales:

| Camino | Qué cuesta | Qué tarda | Cumple RF-18 |
|---|---|---|---|
| Solo WhatsApp | Lo menos | — | **No** |
| WhatsApp + PWA para el carnet | +2 a 3 semanas sobre solo WhatsApp | 10–14 semanas en total | Sí |
| WhatsApp + app nativa (iOS y Android) | +8 a 12 semanas y trámites de tienda | 20–26 semanas | Sí |

**La PWA es el punto medio y es el que recomiendo.** Es una página web que el
navegador guarda en el teléfono: se abre desde un enlace que llega por el mismo
WhatsApp, se puede "instalar" en la pantalla de inicio sin pasar por App Store
ni Google Play, y un *service worker* guarda el carnet para que abra sin señal.
Cuesta semanas, no meses, y no hay revisión de tienda que pueda retrasar un
lanzamiento.

Lo que se pierde respecto de una app nativa: las notificaciones push en iPhone
son más limitadas, y no hay sincronización con el calendario del teléfono. Nada
de eso es de Fase 1 — RF-25 ya los pone en Fase 3.

El backend de este repositorio ya está construido para las tres: la
conversación, el panel y una eventual app hablan contra la misma API. La
decisión no obliga a rehacer nada después.

---

## 2. ¿Qué proveedor de la API de WhatsApp Business, y cuánto cuesta?

**Recomendación: conectarse directo a la Cloud API de Meta. Sin intermediario.**

Los intermediarios (Twilio, 360dialog, Gupshup, Infobip y demás) son
revendedores: le agregan al precio de Meta un margen por mensaje o una cuota
fija. Aportan tableros, soporte y a veces facturación local. Para Huella eso no
compensa, por dos razones concretas:

1. **Son siete plantillas.** El trabajo de gestión que justifica a un
   intermediario aquí no existe: las plantillas están en
   `src/channels/whatsapp/plantillas.ts`, se validan solas y se dan de alta una
   vez.
2. **El volumen es chico.** Un margen por mensaje sobre 7,500 mensajes al mes
   es dinero que no compra nada.

Si más adelante hace falta soporte en español con respuesta garantizada, o
facturación con RFC mexicano, **360dialog** es el que menos estorba: cobra cuota
fija mensual en vez de margen por mensaje. Cambiar de proveedor es reescribir un
adaptador de unas 150 líneas — el sistema ya está separado así.

### Cuánto cuesta al volumen previsto

Con 1,500 citas al mes y cinco avisos por cita (T−21, T−7, T−3, T−0 y cierre),
más las alertas de refuerzo:

- **≈ 7,500 mensajes de plantilla al mes**, todos de categoría *utility*
  (transaccional), que es la más barata.

| Escenario de precio | Costo mensual (USD) | Costo mensual (MXN) | Por usuaria |
|---|---|---|---|
| Cobro por mensaje *utility* (modelo vigente desde 2025) | $60 – $90 | $1,100 – $1,600 | $2 – $3 |
| Cobro por conversación de 24 h (modelo anterior) | $250 – $330 | $4,500 – $6,000 | $9 – $12 |

Incluso en el escenario caro, **el canal cuesta menos del 10 % de una
suscripción de $149 MXN**. No es el renglón que hay que optimizar.

### Dos cosas que hay que hacer desde el primer día

1. **Dar de alta las plantillas ya.** La aprobación de Meta tarda de horas a
   días y una plantilla rechazada detiene el producto entero. Los textos y el
   *payload* de alta están listos en el repositorio.
2. **Verificar el negocio ante Meta** (Meta Business Verification). Requiere
   documentos de la empresa y es lo que más se atora. Empezarlo antes de
   escribir código.

Un detalle de operación que ahorra dinero: **los mensajes que salen dentro de
las 24 horas siguientes al último mensaje de la usuaria no se cobran igual que
los que inician la conversación**. El sistema ya distingue los dos casos
(`enviarPlantilla` y `enviarTexto`).

---

## 3. ¿Qué tan confiable es hoy un agente de voz en español mexicano, y a qué costo?

**Respuesta corta: la tecnología ya sirve, pero no para arrancar con ella. La
recomendación del propio documento — piloto manual primero — es la correcta, y
la sostengo.**

### Confiabilidad

Un agente de voz conversacional en español mexicano cierra hoy, de forma
razonable, una llamada corta y guionada como la de Huella: saludar, identificarse
como asistente, pedir una cita para una fecha, preguntar el precio, confirmar.
Lo que lo rompe no es el idioma, es el mundo real de una estética canina:

- Ruido de secadoras y perros ladrando de fondo.
- Quien contesta deja el teléfono en el mostrador y tarda en volver.
- Respuestas que no son ni sí ni no: *"uy, déjeme ver, ¿le marco al rato?"*.
- Conmutadores, música de espera, extensiones.
- Números que ya no existen o que ahora son de otro negocio.

**Expectativa realista para los primeros meses: entre 50 % y 70 % de las
llamadas se cierran solas.** El resto escala a una persona. Ese número mejora
con el guion afinado, y el guion se afina con conversaciones reales — que es
exactamente lo que produce la Fase 0.

Dos advertencias que no son técnicas y pesan más que las técnicas:

- **La sección 09 obliga a avisar que la llamada se graba**, y a que el agente
  declare que no es una persona. Eso cambia la conversación: algunos negocios
  cuelgan. Hay que medirlo en el piloto, no suponerlo.
- **Un negocio que se siente engañado deja de contestar para siempre.** El
  costo de un mal agente de voz no es la llamada perdida, es el proveedor
  perdido — y los proveedores son el activo del que depende la Fase 4.

### Costo

| Componente | Por minuto (USD) |
|---|---|
| Telefonía saliente a México | $0.01 – $0.03 |
| Reconocimiento de voz, modelo de lenguaje y voz sintética | $0.06 – $0.15 |
| **Total** | **$0.07 – $0.18** |

Una llamada de este tipo dura de dos a cuatro minutos:

- **$0.20 – $0.70 USD por llamada ≈ $4 – $13 MXN.**
- Con 1,500 citas al mes, suponiendo 1.4 llamadas por cita (rellamadas
  incluidas): **$420 – $1,470 USD/mes ≈ $7,500 – $26,000 MXN/mes.**

**Ese renglón es entre cinco y veinte veces el de WhatsApp.** Es la razón
económica, además de la técnica, para agotar el canal de WhatsApp con el
proveedor antes de marcarle por teléfono. El orden de preferencia de la sección
05 es el correcto y conviene respetarlo también por costo.

---

## 4. ¿Cómo evitar duplicar proveedores y no saturarlos?

Son dos problemas distintos. **Los dos ya están resueltos en este repositorio**,
porque las dos soluciones había que tomarlas en la primera migración.

### No duplicar

La regla: **dos registros son el mismo negocio si comparten teléfono**
(`src/modules/proveedores/dedup.ts`).

El teléfono es el identificador más estable del dominio. El nombre no lo es
—"Petco", "PETCO Polanco", "petco masaryk"— y la dirección menos. Los números se
normalizan a formato internacional antes de comparar, lo que resuelve de paso el
"1" que WhatsApp añade a los celulares mexicanos y que, sin tratar, duplicaría a
la mitad del catálogo.

Cuando la usuaria no sabe el teléfono se cae a nombre + sucursal normalizados, y
**el registro queda marcado para que la operadora lo complete**: un proveedor sin
teléfono tampoco se puede contactar, así que el dato hace falta de todos modos.

Lo que esto permite: cuando la segunda usuaria registra "PETCO Polanco", el
sistema reconoce el negocio que ya existe, **reusa la fila y solo crea el
vínculo**. Los datos que faltaban se completan; los que ya estaban no se
sobrescriben, para que una errata de la segunda usuaria no le cambie la dirección
a la primera.

### No saturarlos

Éste es el riesgo que se subestima. Una estética popular puede ser la de treinta
usuarias; si el sistema le manda treinta WhatsApps sueltos al mes, deja de
contestar — **y el producto entero depende de que conteste**.

El límite está en `puedeContactarse()`: **un máximo de seis contactos salientes
por negocio en dos horas**, contados sobre la bitácora de interacciones que ya se
guarda como evidencia. Los números son deliberadamente conservadores: es más
barato que una cita tarde media hora más en cerrarse que perder al proveedor.

Dos mejoras que valen la pena cuando haya volumen, y que el modelo ya admite sin
cambios:

1. **Agrupar.** Si tres usuarias necesitan cita en el mismo negocio la misma
   semana, pedirlas en una sola conversación. Menos molestia y menos costo.
2. **Aprender sus horarios.** El campo `horarios_conocidos` del proveedor está
   ahí para llenarse con lo que se descubra en las conversaciones reales, y no
   marcarle cuando está cerrado.

---

## 5. ¿Qué hace falta para que el carnet funcione sin conexión?

Tres piezas. Dos ya están; la tercera es la PWA de la pregunta 1.

**1. Que el carnet quepa en una sola respuesta.** Ya es así: se entrega completo,
sin paginar y sin llamadas encadenadas (`GET /mascotas/:id/carnet`). Son decenas
de renglones, no miles.

**2. Que el cliente sepa cuándo cambió.** La respuesta trae una `version` que es
el hash de su contenido, servida como `ETag`. Si el cliente vuelve con la misma
versión recibe `304` y usa lo que ya tiene guardado. La versión **no incluye la
fecha de generación**, a propósito: si la incluyera cambiaría en cada petición y
el teléfono volvería a descargar el carnet completo cada vez, que es justo lo que
no debe pasar en el mostrador con mala señal.

**3. Que algo lo guarde en el teléfono.** Esto es lo que falta y es trabajo de
cliente: un *service worker* que guarde la última respuesta del carnet y la sirva
cuando no hay red, más un indicador honesto de "actualizado hace N días" para que
la usuaria sepa qué está viendo. Estimado: **dos a tres semanas**, incluidas las
pruebas en teléfonos reales con el modo avión puesto.

El PDF (`GET /mascotas/:id/carnet.pdf`) ya funciona y es la red de seguridad: se
puede guardar en el teléfono o mandar por WhatsApp, y se abre sin nada instalado.

**Una advertencia sobre este requerimiento.** RF-18 dice "funcional sin conexión
una vez descargado" (RNF-05). Eso significa que la usuaria tuvo que abrir el
carnet **al menos una vez con señal** antes de llegar al mostrador. Si nunca lo
abrió, no hay nada guardado. Conviene que el aviso del día (T−0), cuando la cita
es con una veterinaria, incluya el enlace al carnet, para que abrirlo forme parte
del flujo y no dependa de que se acuerde.

---

## 6. ¿Cuánto cuesta la infraestructura con 500 usuarias activas?

Con 500 usuarias y 1,500 citas al mes (RNF-08), el sistema es **pequeño**. El
volumen de trabajos ronda unos pocos miles al día. Eso cabe de sobra en dos
instancias chicas y una base administrada.

| Renglón | USD/mes | MXN/mes |
|---|---|---|
| Servidor de la API (2 vCPU, 4 GB) | $25 – $40 | $450 – $720 |
| Trabajador de barridos (1 vCPU, 2 GB) | $15 – $25 | $270 – $450 |
| PostgreSQL administrado (2 vCPU, 4 GB, 50 GB, con respaldos) | $50 – $90 | $900 – $1,620 |
| Almacenamiento de documentos (~15 GB de carnets) | $1 – $3 | $18 – $54 |
| Respaldos fuera de sitio (RNF-07) | $5 – $15 | $90 – $270 |
| Registro de eventos y monitoreo | $15 – $30 | $270 – $540 |
| Modelo de lenguaje (interpretar respuestas libres) | $10 – $30 | $180 – $540 |
| **Subtotal de infraestructura** | **$121 – $233** | **$2,180 – $4,190** |
| WhatsApp (de la pregunta 2) | $60 – $330 | $1,100 – $6,000 |
| **Total sin agente de voz** | **$181 – $563** | **$3,280 – $10,190** |

**Entre $7 y $20 MXN por usuaria al mes**, contra una suscripción de $149 MXN.
La estructura de costos funciona con holgura.

Dos observaciones:

- **La cola de trabajos no aparece como renglón** porque vive dentro de
  PostgreSQL (`pg-boss`). Es deliberado: a este volumen, levantar y vigilar un
  Redis aparte, con su propia persistencia y su propio respaldo, cuesta más en
  operación de lo que ahorra. Además permite encolar y guardar en la misma
  transacción, lo que cierra la ventana en la que una cita se guarda pero su
  recordatorio no se encola.
- **Si se enciende el agente de voz, el costo se multiplica.** Con los números
  de la pregunta 3, sumaría $7,500 – $26,000 MXN/mes: más que todo lo demás
  junto. Es un renglón que hay que encender midiendo.

---

## 7. ¿Qué decisiones tomar en la Fase 1 para que el directorio no obligue a rehacer el sistema?

El documento ya identificó la decisión principal en la sección 11 y **está
tomada desde la primera migración**. Van las cuatro que importan.

### 1. Proveedor es una entidad compartida, no un contacto privado

Ya implementado. `proveedor` es una tabla global y la relación con cada usuaria
vive en `usuaria_proveedor`. Lo privado de cada quien —cómo le llama, sus
notas— está en la relación; lo compartido —dirección, teléfono, horarios— está
en el negocio.

**Ésta es la que no se puede posponer.** Si cada usuaria tuviera su propia copia
del proveedor, construir el directorio después significaría reconciliar a mano
miles de registros duplicados, sin forma confiable de saber cuáles son el mismo
negocio. Con la decisión tomada desde ahora, el catálogo del directorio **nace
solo** del trabajo que las usuarias ya hacen al registrar sus negocios.

Hay una consulta lista en el panel (`GET /panel/api/proveedores-compartidos`) que
lista los negocios que ya comparten varias usuarias. Ésa es, literalmente, la
lista de a quién llamar el día que el directorio arranque — y ya tienen un motivo
para darse de alta, porque ya les están llegando citas.

### 2. La ubicación geográfica se captura desde ahora

Ya implementado: `proveedor.latitud` y `longitud`, con índice. RF-29 (búsqueda
por cercanía) es de Fase 4, pero **rellenar coordenadas después, sobre miles de
registros hechos a mano, es mucho más caro que capturarlas al vuelo**. Cuando
haga falta la búsqueda por cercanía se añade PostGIS sobre columnas que ya
tienen datos.

### 3. Los precios necesitan estructura, no un número

RF-27 lo dice: *"El precio de una estética depende del tamaño y el pelo del
perro, así que el campo no puede ser un solo número"*. En Fase 1 el costo vive
en la cita y en la rutina, que es lo que hace falta. Lo que conviene **no**
hacer es prometer un precio único por servicio en ninguna interfaz, para no
tener que desdecirse.

Cuando llegue la Fase 4, la tabla nueva (`servicio_proveedor`) cuelga del
proveedor compartido que ya existe, con rango o tabla por talla y — esto es lo
importante — **fecha de última actualización de cada precio**, para poder
mostrarlo como estimado cuando envejezca, tal como pide la sección 11.

### 4. Las reseñas se apoyan en citas cumplidas

RF-30 pide que solo reseñe quien tuvo una cita cumplida registrada. Eso ya es
posible sin cambios: la cita liga usuaria, proveedor y estado `cumplida`. **Es
la ventaja real frente a las reseñas de internet** y no cuesta nada preservarla:
basta con no borrar el historial de citas cumplidas.

### Lo que sí habrá que construir de cero en la Fase 4

Para que quede claro qué no está anticipado: el panel del proveedor (RF-32), el
flujo de reclamo y verificación de perfil (RF-33), el cobro al negocio (RF-34) y
la reservación contra disponibilidad real (RF-31). Son trabajo nuevo, pero
**ninguno obliga a rehacer lo de Fase 1**.

---

## 8. ¿Qué parte del alcance es riesgosa o está mal dimensionada? ¿Qué recortaría?

### Lo riesgoso

**1. El agendamiento asistido (sección 05) es el producto, y es lo único que no
se puede estimar con confianza.**

El documento ya lo identifica —"ahí está el riesgo técnico"— y tiene razón. Todo
lo demás de la Fase 1 es trabajo conocido: formularios, una cola, plantillas, un
PDF. Lo que no se puede estimar es cuántos negocios responden bien a un flujo
automatizado, porque depende de cómo agenda cada uno, y eso **nadie lo sabe
todavía**. La Fase 0 existe para averiguarlo y no debe saltarse.

**2. RF-18 y la pregunta 1 están en tensión.** El carnet sin conexión obliga a
tener un cliente propio. Vale la pena decidirlo a conciencia (ver pregunta 1) y
no descubrirlo a la mitad de la construcción.

**3. La verificación de negocio ante Meta puede atorarse semanas** y bloquea
todo lo demás. Es trámite, no ingeniería, y por eso se olvida en los planes.

**4. La reforma de la ley de datos personales.** El documento ya lo marca como
"por verificar" y tiene razón en no darlo por resuelto. Es asesoría legal, no
desarrollo, pero **hay que arrancarla ya** porque condiciona el texto del aviso
de privacidad, y el aviso se acepta en el alta de la primera usuaria.

### Lo que está mal dimensionado

**RF-24, el panel interno, es más grande de lo que parece.** "Citas del día,
bandeja de excepciones, historial de conversaciones y estado de cada
suscripción" es, bien hecho, tanto trabajo de interfaz como toda la parte de la
usuaria. En este repositorio está resuelto **como API con control por rol y
bitácora**, que es la parte difícil y la que exige RNF-06; la interfaz visual
puede ser mínima al principio.

### Qué recortaría de la Fase 1

Por orden de lo que menos duele:

| Recorte | Por qué | Qué se ahorra |
|---|---|---|
| **Interfaz visual del panel** → lista simple sobre la API que ya existe | La bandeja la atienden dos o tres personas que están en la misma oficina | 2–3 semanas |
| **RF-23, suscripción** → usar el cobro alojado de la pasarela en vez de construirlo | La página de pago la da la pasarela; solo hay que guardar el estado | 1–2 semanas |
| **RF-15, acuses de entrega y lectura** → dejar solo el registro de envío | Es diagnóstico, no producto. Se puede añadir después sin migrar nada | 1 semana |
| **RF-06, catálogo de servicios** → tres servicios en vez de once | Baño, vacunación y consulta cubren casi todo el uso real inicial | 2–3 días |

**Lo que no recortaría, aunque se vea grande:**

- **Los cuatro recordatorios completos.** Son el producto. Recortarlos deja una
  agenda más.
- **La regla de contenido de la sección 03.** Es barata de cumplir desde el
  principio y carísima de añadir después, porque obliga a revisar cada mensaje.
- **La bitácora y el cifrado (RNF-06).** Añadir cifrado sobre documentos ya
  guardados en claro exige migrar archivos y rotar llaves.
- **El proveedor compartido.** Ver la pregunta 7.

---

## 9. ¿Cuánto tiempo y cuánto presupuesto hasta la Fase 1 con usuarias reales?

### Tiempo

Suponiendo **una persona de ingeniería con experiencia, de tiempo completo**, y
que la Fase 0 corre en paralelo desde la primera semana:

| Bloque | Semanas |
|---|---|
| Modelo de datos, migraciones y cimientos | 1.5 |
| Alta, mascotas, proveedores y rutinas (RF-01 a RF-07) | 2 |
| Programador de tareas y los cuatro recordatorios (RF-08, RF-12 a RF-15) | 2.5 |
| Integración de WhatsApp y alta de plantillas | 1.5 |
| Carnet, documentos y PDF (RF-16 a RF-18) | 2 |
| PWA del carnet con funcionamiento sin conexión | 2.5 |
| Suscripción y cobros (RF-23) | 1.5 |
| Panel interno con rol y bitácora (RF-24) | 2 |
| Endurecer, probar y corregir con usuarias reales | 2.5 |
| **Total** | **18 semanas ≈ 4.5 meses** |

Con **dos personas** (una de backend y una de cliente/conversación) baja a
**11–13 semanas**, no a la mitad: hay trabajo que no se paraleliza y aparece
coordinación.

**Buena parte de ese trabajo ya está hecha en este repositorio.** Lo que queda
para tener Fase 1 con usuarias reales:

- Conectar la Cloud API de Meta y dar de alta las plantillas — **1 a 2 semanas**
  (más el trámite de verificación, que corre aparte).
- El flujo conversacional que interpreta las respuestas libres de la usuaria —
  **2 a 3 semanas**.
- La PWA del carnet — **2 a 3 semanas**.
- Conectar la pasarela de cobro real — **1 semana**.
- Interfaz visual del panel — **1 a 3 semanas** según cuánto se recorte.
- Despliegue, respaldos probados y monitoreo — **1 semana**.

**Entre 8 y 13 semanas** desde hoy, según cuánta gente y cuánto se recorte.

### Presupuesto

Los rangos de costo de ingeniería varían mucho según contratación, y conviene
validarlos localmente. Como referencia de orden de magnitud:

| Renglón | Rango (MXN) |
|---|---|
| Ingeniería hasta Fase 1 (8–13 semanas) | $250,000 – $700,000 |
| Asesoría legal: aviso de privacidad, términos y consentimientos | $20,000 – $60,000 |
| Diseño de la conversación y de la PWA | $40,000 – $120,000 |
| Infraestructura durante la construcción (3 meses) | $6,000 – $12,000 |
| Reserva para imprevistos (20 %) | $65,000 – $180,000 |
| **Total hasta Fase 1 en operación** | **$380,000 – $1,070,000** |

**Costo de operación una vez en marcha**, con 500 usuarias:

- Infraestructura y WhatsApp: **$3,300 – $10,200 MXN/mes** (pregunta 6).
- Operadora interna: es el renglón mayor y no es de tecnología. Con 1,500 citas
  al mes y contacto manual con proveedores en Fase 1, calcular **de media a una
  persona de tiempo completo**.

Ese último punto merece subrayarse: **mientras el contacto con el proveedor sea
manual, el costo por usuaria no baja con el volumen.** Ésa es la razón económica
de la Fase 2, y la que debería decidir cuándo construir el agente — no el
entusiasmo técnico.

---

## Lo que sugiero hacer en las próximas dos semanas

Por orden, y sin depender de decisiones de presupuesto:

1. **Iniciar la verificación de negocio ante Meta.** Es lo que más se atora y no
   cuesta nada empezarlo.
2. **Arrancar la Fase 0 con diez usuarias.** Agendar a mano y **guardar cada
   conversación con el proveedor**. Es el insumo del agente y el documento ya lo
   dice.
3. **Consultar a un abogado** sobre el aviso de privacidad y ante qué autoridad
   se registra, dada la reforma que el documento marca por verificar.
4. **Decidir lo de la pregunta 1** (WhatsApp + PWA, o solo WhatsApp recortando
   RF-18). Condiciona el plan y el presupuesto.
5. **Medir dos cosas en el piloto**, que son las que deciden la Fase 2: qué
   porcentaje de negocios contesta por WhatsApp, y cuántos minutos reales se le
   van a la operadora por cita.
