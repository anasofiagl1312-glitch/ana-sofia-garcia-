# Huella

Asistente que agenda, recuerda y documenta el cuidado de una mascota: baños,
veterinario y carnet de vacunación, en un solo lugar.

Implementación de la **Fase 1** del [documento de requerimientos v1.0](docs/requerimientos-v1.0.md)
— RF-01 a RF-08, RF-12 a RF-18, RF-21, RF-23 y RF-24.

> La respuesta a las nueve preguntas abiertas de la sección 13 del documento
> está en **[docs/respuesta-tecnica.md](docs/respuesta-tecnica.md)**: canal,
> costos, tiempos, riesgos y qué recortar.

---

## Qué hace

La usuaria registra a su mascota y sus rutinas una sola vez. A partir de ahí el
sistema sigue la secuencia de la sección 03 del documento, sin que ella tenga
que acordarse de nada:

```
Registro ──▶ T−21  pregunta disponibilidad con opciones concretas
             T−21  agenda con el proveedor y confirma fecha, lugar y costo
             T−7   recordatorio
             T−3   recordatorio
             T−0   aviso del día, con las indicaciones del negocio
             T+1   cierre: registra el costo real y programa el siguiente ciclo
```

Y guarda el carnet de vacunación en digital, legible en el mostrador de la
veterinaria aunque no haya señal.

**Regla que atraviesa todo el sistema:** todo aviso incluye los cuatro datos —
qué servicio, cuándo, dónde y cuánto cuesta. Está verificada en código
(`src/modules/mensajes/contenido.ts`) y hay una prueba que recorre todos los
momentos y falla si alguno pierde uno.

---

## Cómo correrlo

Hace falta **Node 22+** y **PostgreSQL 16+**.

```bash
npm install
cp .env.example .env

# Una llave de 32 bytes para cifrar los documentos (RNF-06)
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env

createdb huella && createdb huella_test
npm run migrate
npm run seed        # datos de ejemplo: Ana, su perra Lola y Petco Polanco
```

Dos procesos, a propósito separados:

```bash
npm run dev         # API HTTP
npm run worker      # barridos: recordatorios, rutinas y refuerzos
```

El trabajador corre aparte para que una avalancha de peticiones no retrase un
recordatorio (RNF-03), y para poder escalarlo por su cuenta.

### Pruebas

```bash
npm test            # 147 pruebas
npm run typecheck
```

Las de integración corren contra un PostgreSQL de verdad (`huella_test`): lo que
se prueba ahí —bloqueos de fila, índices únicos, transacciones, el cálculo del
retraso— solo existe en la base.

`tests/integration/aceptacion.test.ts` recorre, una por una, **las ocho viñetas
de criterios de aceptación de la sección 12**, citando el texto original.

---

## Cómo está organizado

```
src/
  domain/          Lógica pura, sin base de datos ni reloj
    tiempo.ts        Zonas horarias y fechas locales (RNF-02)
    agenda.ts        Cuándo sale cada aviso (RF-08, RF-12)
    citas.ts         Máquina de estados de una cita (sección 07)
    vacunas.ts       Vencimiento de refuerzos (RF-14)
  modules/         Casos de uso, con acceso a datos
    mensajes/        Redacción en español de México y la regla de contenido
    recordatorios/   Programación, barrido, reintentos y acuses
    agendamiento/    Ciclo de la rutina: disparo, confirmación, cierre
    proveedores/     Identidad compartida y límite de contacto
    carnet/          Carnet digital y exportación a PDF (RF-16 a RF-18)
    almacenamiento/  Documentos cifrados en reposo (RNF-06)
    privacidad/      Derechos ARCO (sección 09)
    panel/           Control por rol y bitácora de consultas (RF-24, RNF-06)
    auth/            Alta por código al celular (RF-01)
    suscripcion/     Cobro mensual y baja (RF-23)
  channels/        Lo que se puede cambiar de proveedor sin tocar el dominio
    whatsapp/        Adaptador y plantillas aprobadas por Meta (sección 08)
  jobs/            Cola de trabajos y proceso trabajador
  http/            Rutas; capa delgada sobre los módulos
db/migrations/     Esquema, en orden
```

---

## Cuatro decisiones que conviene conocer

### 1. Los recordatorios se calculan sobre la hora local de pared

RNF-02 pide que **el cambio de horario no corra ningún recordatorio**. Por eso un
aviso se define como "el jueves a las 8 de la mañana" y no como "168 horas antes
de la cita": se toma la fecha local de la cita, se le restan días de calendario,
y esa fecha se combina con la hora local del aviso.

Restar 168 horas al instante de la cita correría el aviso una hora cuando hay un
cambio de horario de por medio. Hay una prueba que demuestra exactamente esa
diferencia (`tests/unit/agenda.test.ts`).

### 2. La tabla de recordatorios es la fuente de verdad, no la cola

La sección 08 llama al programador de tareas *"el componente del que depende toda
la promesa del producto"*. Una cola que pierde un trabajo lo pierde en silencio:
nadie se entera hasta que una usuaria llega sin saber que tenía cita.

Aquí la cola solo dispara un **barrido cada minuto** que le pregunta a la base
qué avisos ya vencieron. Si el trabajador estuvo caído una hora, al volver
encuentra todo lo atrasado; si corren dos a la vez, el bloqueo de filas evita el
envío duplicado.

La cola vive dentro de PostgreSQL (`pg-boss`): un componente menos que operar, y
encolar y guardar ocurren en la misma transacción.

### 3. El proveedor es una entidad compartida desde la primera migración

Es la consecuencia que la sección 11 pide respetar desde el principio. Dos
usuarias que registran el mismo negocio caen en la **misma fila**, identificada
por teléfono normalizado. Así el catálogo del directorio de Fase 4 nace del
trabajo que las usuarias ya hacen, en vez de exigir reconciliar miles de
duplicados después.

### 4. El texto que lee la usuaria y la plantilla aprobada por Meta no se separan

Todos los avisos salen fuera de la ventana de 24 horas, así que todos viajan como
plantilla aprobada. El texto se genera **renderizando la misma plantilla** que se
da de alta en Meta, y una prueba compara las dos: si alguien cambia la redacción
y se le olvida actualizar la plantilla, falla antes de llegar a producción.

---

## Qué falta para la Fase 1 en operación

Está detallado en [docs/respuesta-tecnica.md](docs/respuesta-tecnica.md), pero
en corto:

- [ ] Verificación del negocio ante Meta y alta de las siete plantillas
- [ ] Conectar la Cloud API real (el adaptador ya existe; hoy corre el falso)
- [ ] Flujo conversacional que interpreta las respuestas libres de la usuaria
- [ ] PWA del carnet con funcionamiento sin conexión (RF-18)
- [ ] Conectar la pasarela de cobro real (hoy corre la falsa)
- [ ] Interfaz visual del panel sobre la API que ya existe
- [ ] Revisión legal del aviso de privacidad

---

## Configuración

Todo por variables de entorno; ver [`.env.example`](.env.example). Las que
importan:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `ENCRYPTION_KEY` | 32 bytes en base64; cifra los documentos (RNF-06) |
| `WHATSAPP_DRIVER` | `fake` en desarrollo, `meta` en producción |
| `WHATSAPP_APP_SECRET` | Verifica la firma de los webhooks de Meta |
| `DEFAULT_TIMEZONE` | Zona por omisión de una usuaria nueva |

En producción, el arranque falla a propósito si falta `ENCRYPTION_KEY` o si el
canal de WhatsApp quedó en `fake`.
