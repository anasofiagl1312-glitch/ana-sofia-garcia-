# Guía de operación del piloto

Cómo se opera Huella mientras las citas y los avisos los haces tú a mano.

El sistema guarda a las clientas, sus mascotas, sus rutinas y sus citas; calcula
en qué momento toca cada aviso y **escribe el texto exacto** que hay que mandar.
Lo único que no hace todavía es apretar «enviar»: eso lo haces tú desde tu propio
WhatsApp y tu propio correo. Por eso el piloto no cuesta nada de API ni requiere
que Meta apruebe nada.

---

## Levantar el sistema

```bash
npm install                 # sólo la primera vez
npm run migrate             # sólo la primera vez, o cuando haya migraciones nuevas
npm run dev
```

Y en tu navegador:

- **Panel interno (tú):** http://localhost:3000/panel/
- **Alta de la clienta (ella):** no se abre a mano, se abre con el enlace que
  genera el panel.

El trabajador de la cola (`npm run worker`) **no hace falta en el piloto**: sirve
para enviar solo, y aquí no se envía solo. El panel lee directo de la tabla
`recordatorio`, así que los avisos aparecen con o sin trabajador.

---

## El día a día, en cinco movimientos

### 1. Dar de alta a la clienta — pestaña **Clientas**

«+ Nueva clienta». Lo que capturas tú es lo que sale de la conversación que ya
tuviste: nombre, WhatsApp, la mascota, el negocio donde la atienden y la rutina
(qué servicio, cada cuántos meses, a qué hora suele pedirlo).

**El correo no se captura aquí**: lo da ella en su alta, junto con la decisión de
si quiere que le avises por correo o sólo por WhatsApp. Mientras no termine su
alta, sus avisos salen por WhatsApp y el botón de correo no aparece; no se rompe
nada, simplemente hay un canal menos.

**Si dijo que no, dala de alta igual** y marca «No aceptó» en el campo ¿Aceptó?
Es lo que hace que la tasa de aceptación signifique algo: sin los noes, siempre
va a dar 100%.

### 2. Mandarle el enlace — botón **Enlace de alta**

Se copia solo al portapapeles. Lo pegas en el hilo de WhatsApp donde ya estás
hablando con ella y ya.

El enlace **dura 14 días** y sirve una sola vez por clienta: si generas uno
nuevo, el anterior deja de funcionar. Úsalo cuando se le venza o cuando lo pierda.

Bajo el botón, una etiqueta te dice en qué va, y cada estado pide algo distinto:

| Etiqueta | Qué significa | Qué hacer |
| --- | --- | --- |
| Enlace sin abrir | Se lo mandaste y no lo ha tocado | Recordárselo a los dos días |
| Lo abrió, sin terminar | Empezó y se quedó a medias | Preguntarle en qué se atoró |
| Alta completada | Ya está | Agendar su primera cita |
| Enlace vencido | Pasaron los 14 días | Generar uno nuevo y remandarlo |

### 3. Lo que ella llena — cuatro pasos

Son cuatro pantallas, guardan paso por paso (si se sale, no pierde lo hecho):

1. **Tu mascota** — nombre, especie, sexo, fecha de nacimiento, e indicaciones
   de manejo («se pone nerviosa con la secadora»).
2. **El carnet** — fotos del carnet de vacunación, y las aplicaciones que ya
   tiene capturadas.
3. **Tu veterinaria** — la que ya usa. Queda guardada como proveedor con
   relación `veterinaria`.
4. **Cómo te avisamos** — WhatsApp, correo o ambos, y a qué horas sí y a qué
   horas no.

El token va en el fragmento de la URL (después del `#`), así que **nunca viaja al
servidor ni queda en un log de accesos**. En cuanto la página lo lee, lo borra de
la barra de direcciones.

**Un correo por clienta.** Si dos personas de la misma casa ponen el mismo, a la
segunda le sale que ese correo ya está registrado y tiene que usar otro. Es a
propósito: el correo identifica a la clienta.

### 4. Crear la cita — pestaña **Citas**

Tú hablas con la veterinaria, cierras el horario y lo capturas: servicio, fecha,
hora, proveedor y costo.

En cuanto la guardas, quedan programados los recordatorios de esa cita.

> **Si agendas con poca anticipación**, los avisos que ya se habrían pasado
> (el de 7 días para una cita que es pasado mañana) **no se programan en el
> pasado**: se omiten, y la respuesta te dice cuáles se omitieron. No te va a
> llegar de golpe una tanda de avisos viejos.

### 5. Mandar los avisos — pestaña **Hoy**

Es la pantalla con la que trabajas todos los días. Trae todo lo que toca hoy, y
por cada aviso:

- **el texto completo, ya escrito**, con los cuatro datos que un aviso siempre
  lleva: qué servicio, cuándo, dónde y cuánto cuesta;
- **Copiar**, para pegarlo tal cual en WhatsApp;
- **Abrir correo**, sólo si esa clienta dio correo, que abre tu cliente de correo
  con el asunto y el cuerpo ya puestos;
- **Marcar enviado**, que registra por qué canal lo mandaste.

**Marca enviado siempre.** Es lo que evita que se lo mandes dos veces, y lo que
hace que los números de la última pestaña signifiquen algo.

El texto no se edita. No es rigidez: es que ese mismo texto es el que después se
va a mandar solo desde una plantilla aprobada por Meta, y si aquí escribes otra
cosa, lo que estás probando no es lo que va a salir en producción.

Cuando pase la cita, **Marcar cumplida**.

---

## Los seis momentos

Cada rutina dispara la misma secuencia. No hay que memorizarla —el panel te la
pone el día que toca— pero sirve para saber qué esperar:

| Momento | Cuándo | Para qué |
| --- | --- | --- |
| T−21 | 21 días antes | Preguntar qué día le acomoda |
| Confirmación | al agendar | Dejar por escrito lo que quedó |
| T−7 | una semana antes | Que lo tenga en el radar |
| T−3 | tres días antes | Que lo acomode en su semana |
| T−0 | el mismo día | Que no se le pase |
| Cierre | el día siguiente | Preguntar cómo les fue |

Los momentos se calculan sobre **la hora local de pared**. Un aviso de las 9 de
la mañana cae a las 9 de la mañana también en el cambio de horario, no a las 8.

---

## Los números — pestaña **Números**

Personas invitadas, clientas activas, clientas pagando, tasa de aceptación,
citas agendadas, citas cumplidas y avisos pendientes de hoy.

Estos números sólo sirven si marcas enviado y marcas cumplida. El sistema no
puede saber lo que hiciste desde tu teléfono.

---

## Lo que el piloto todavía no hace

Vale la pena tenerlo claro antes de enseñárselo a alguien:

- **No envía solo.** Ni WhatsApp ni correo. El código para hacerlo está y está
  probado; lo que falta es la cuenta de Meta y las plantillas aprobadas.
- **No recibe respuestas.** Si la clienta contesta «mejor el jueves», te contesta
  a ti por WhatsApp, y eres tú quien reagenda en el panel.
- **Corre en tu máquina.** Si apagas la computadora, el panel no está. La clienta
  necesita que esté prendida en el momento en que abre su enlace de alta.

Nada de esto impide probar lo que importa: si la secuencia de avisos le sirve a
una clienta real, y si está dispuesta a pagar por ella.
