# Huella — guía para trabajar en este repositorio

Asistente que agenda, recuerda y documenta el cuidado de una mascota.
El alcance y el porqué de cada cosa están en `docs/requerimientos-v1.0.md`
(documento de negocio v1.0) y en `docs/respuesta-tecnica.md`.

**Hoy corre como piloto manual**: el sistema guarda todo y redacta cada aviso,
pero quien crea las citas y aprieta «enviar» es la operadora, desde su propio
WhatsApp y su propio correo. `docs/guia-del-piloto.md` es cómo se opera. Eso
cambia qué se puede romper sin que nadie se dé cuenta: el panel es la única
salida del producto, así que un aviso que no se puede copiar es un aviso que no
existe.

---

## Identidad visual — manda sobre cualquier otra referencia de estilo

La fuente es **`docs/marca.md`**. Léela antes de tocar cualquier cosa que se
vea. Lo esencial, para no tener que abrirla cada vez:

**Dirección:** crema, camello y tinta. Fondos color crema, el camello del pelo
de un perro, tipografía negra delgada. Sin colores fuertes, sin gradientes.

**Los colores viven en un solo archivo: `public/marca.css`.** Son variables de
CSS y no se escribe ni un color a mano en ningún otro lado. Si hace falta un
tono nuevo, se agrega ahí como variable.

| Variable | Color | Uso |
| --- | --- | --- |
| `--ground` | `#F3F0EB` | Fondo de la app |
| `--surface` | `#FFFFFF` | Tarjetas y superficies |
| `--warm` | `#EAE3D9` | Fondo suave: mensajes de muestra, cajas internas |
| `--ink` | `#2E2926` | Texto principal |
| `--ink-soft` | `#857B70` | Texto secundario |
| `--rule` | `#E4DCD1` | Líneas y bordes |
| `--rule-firm` | `#CDC2B4` | Líneas marcadas |
| `--accent` | `#2E2926` | Botón principal y pestaña activa |
| `--on-accent` | `#F3F0EB` | Texto sobre el acento |
| `--detail` | `#A9825C` | Etiquetas y avisos. Es acento, aparece poquito |
| `--detail-soft` | `#F0E6DA` | Fondo del detalle |

**Tipografía** (Google Fonts, siempre con familia de respaldo):

- **Cormorant Garamond** 300/400/500 — el nombre «Huella», títulos y nombres de
  mascotas. Respaldo: `Georgia, serif`.
- **Jost** 300/400/500/600 — todo lo demás. Respaldo: `"Helvetica Neue", Arial,
  sans-serif`.

**Reglas que no se negocian:**

- Etiquetas pequeñas en MAYÚSCULAS con `letter-spacing` de unos `0.2em`. Ese
  detalle es el que hace que se vea cuidado.
- «Huella» siempre en mayúsculas, en Cormorant, con las letras separadas.
- Bordes rectos: como mucho 2 px de radio.
- Sombras casi imperceptibles o ninguna. La separación se logra con borde y
  fondo.
- Mucho aire. Ligero, nunca apretado.
- Nada de gradientes, colores saturados ni emojis como íconos de sección.
- El camello es acento, no fondo.

**Celular primero.** El panel se usa casi siempre desde el teléfono, a veces con
luz de día y a media calle: todo funciona a 400 px, los botones miden al menos
44 px de alto, y el contraste manda sobre lo bonito (por eso el botón principal
es tinta y no camello).

> `docs/referencia-panel.html` es la referencia de **comportamiento**: de ahí
> salieron la estructura y los textos del panel, **no** los colores. El archivo
> no está versionado (llegó como adjunto), así que la referencia viva hoy es
> `public/` mismo: al cambiar la interfaz, se mantiene esa estructura.

---

## Idioma

Todo en **español de México**: la interfaz, los mensajes, los nombres de las
cosas en el código, los comentarios y los mensajes de commit. Fechas en formato
local y montos en pesos (RNF-01).

En el código se escribe sin acentos en identificadores (`programarRecordatorios`,
no `programaciónDeRecordatorios`), pero **los comentarios y todo lo que lee una
persona sí llevan acentos**.

---

## Cómo está organizado

```
src/domain/     Lógica pura: sin base de datos, sin reloj, sin red
src/modules/    Casos de uso con acceso a datos
src/channels/   Lo que se puede cambiar de proveedor sin tocar el dominio
src/jobs/       Cola de trabajos y proceso trabajador
src/http/       Rutas: capa delgada sobre los módulos
public/         Interfaz del panel interno y el alta de la clienta
db/migrations/  Esquema, en orden y solo hacia adelante
```

La regla: **si algo se puede probar sin base de datos, va en `src/domain/`.**
El flujo de la sección 03 del documento es la promesa central del producto y
conviene poder probarlo sin levantar nada.

---

## Cinco decisiones que no hay que deshacer sin querer

1. **Los recordatorios se calculan sobre la hora local de pared**, no restando
   horas al instante de la cita. RNF-02 pide que el cambio de horario no corra
   ningún recordatorio. Hay una prueba que demuestra la diferencia.
2. **La tabla `recordatorio` es la fuente de verdad, no la cola.** Un barrido
   cada minuto saca lo vencido. Una cola que pierde un trabajo lo pierde en
   silencio.
3. **Los reintentos no mueven `programado_para`**, para que el retraso real
   quede medible contra la tolerancia de 15 minutos de RNF-03.
4. **El proveedor es una entidad compartida entre usuarias**, identificada por
   teléfono normalizado. Es lo que permite que el directorio de Fase 4 nazca
   solo (sección 11 del documento).
5. **Todo aviso lleva los cuatro datos**: qué servicio, cuándo, dónde y cuánto
   cuesta. Se verifica en código antes de enviar y hay una prueba que recorre
   todos los momentos.

---

## Antes de dar algo por terminado

```bash
npm run verify     # typecheck + las 235 pruebas
```

Las pruebas de integración corren contra un PostgreSQL de verdad (`huella_test`).
`tests/integration/aceptacion.test.ts` recorre las ocho viñetas de criterios de
aceptación de la sección 12, citando el texto original: si se toca el flujo de
recordatorios, ése es el archivo que tiene que seguir pasando.

Las migraciones son **solo hacia adelante**: para cambiar el esquema se agrega
un archivo nuevo en `db/migrations/`, no se edita uno existente.
