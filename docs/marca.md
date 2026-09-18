# Marca de Huella

Identidad visual del producto. Este archivo manda sobre cualquier otra referencia de estilo.
La referencia de **comportamiento** es `docs/referencia-panel.html`; de ahí se copia la estructura
y los textos, **no** los colores.

---

## Colores

Definirlos como variables de CSS en un solo archivo, para poder cambiarlos en un lugar.

| Uso | Color |
| --- | --- |
| Fondo de la app | `#F3F0EB` |
| Tarjetas y superficies | `#FFFFFF` |
| Fondo suave (mensajes de muestra, cajas internas) | `#EAE3D9` |
| Texto principal | `#2E2926` |
| Texto secundario | `#857B70` |
| Líneas y bordes | `#E4DCD1` |
| Líneas marcadas | `#CDC2B4` |
| Acento: botón principal y pestaña activa | `#2E2926`, con texto `#F3F0EB` |
| Detalle: etiquetas y avisos | `#A9825C` |
| Fondo del detalle | `#F0E6DA` |

Dirección: crema, camello y tinta. Fondos color crema, texturas de lino, el camello del pelo de
un perro y tipografía negra delgada. Sin colores fuertes, sin gradientes.

```css
:root {
  --ground:      #F3F0EB;
  --surface:     #FFFFFF;
  --warm:        #EAE3D9;
  --ink:         #2E2926;
  --ink-soft:    #857B70;
  --rule:        #E4DCD1;
  --rule-firm:   #CDC2B4;
  --accent:      #2E2926;
  --on-accent:   #F3F0EB;
  --detail:      #A9825C;
  --detail-soft: #F0E6DA;
}
```

---

## Tipografía

Las dos son gratuitas y están en Google Fonts.

- **Cormorant Garamond**, pesos 300 y 400 — el nombre «Huella», los títulos y los nombres de las
  mascotas.
- **Jost**, pesos 400 y 500 — todo lo demás: textos, formularios y botones.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Jost:wght@300;400;500;600&display=swap">
```

Siempre declarar una familia de respaldo, por si la fuente no carga:

```css
font-family: "Cormorant Garamond", Georgia, serif;
font-family: Jost, "Helvetica Neue", Arial, sans-serif;
```

---

## Reglas de estilo

- Etiquetas pequeñas en **MAYÚSCULAS**, con `letter-spacing` amplio (alrededor de `0.2em`).
  Ese detalle es el que hace que se vea cuidado.
- El nombre «Huella» va en mayúsculas, en Cormorant, con las letras separadas.
- **Bordes rectos.** Nada de esquinas muy redondeadas: como mucho 2 px.
- **Sombras casi imperceptibles o ninguna.** La separación se logra con el borde y el fondo.
- **Mucho aire.** Que se sienta ligero, nunca apretado.
- Nada de gradientes, colores saturados ni emojis como íconos de sección.
- El camello `#A9825C` es un acento, no un color de fondo. Aparece poquito.

---

## Cómo se aplica al panel

- **Barra superior:** fondo crema, el nombre en Cormorant mayúsculas, la fecha de hoy en gris
  a la derecha.
- **Pestañas** (Hoy · Clientas · Citas · Números): mayúsculas, chiquitas y separadas. La activa
  lleva el texto en tinta y una línea delgada debajo en color acento.
- **Tarjeta de pendiente:** fondo blanco, borde `#E4DCD1`. El tipo de aviso arriba, en mayúsculas
  y en camello. El nombre de la clienta y la mascota en Cormorant. El mensaje va en una caja con
  fondo `#EAE3D9`.
- **Botones:** rectangulares, con el texto en mayúsculas separadas. El principal («Abrir
  WhatsApp») en tinta con texto crema; los demás con borde y fondo transparente.

---

## Diseño para celular

El panel se usa casi siempre desde el teléfono, a veces con luz de día y a media calle.

- Todo tiene que funcionar bien a 400 px de ancho.
- Los botones deben ser cómodos de picar con el dedo: al menos 44 px de alto.
- El contraste manda sobre lo bonito. Por eso el botón principal es tinta y no camello.
