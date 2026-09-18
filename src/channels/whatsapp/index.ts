/**
 * Canal de WhatsApp (seccion 08).
 *
 * El documento no pide una tecnologia concreta -- "el ingeniero propone el
 * proveedor" -- asi que todo el sistema habla contra esta interfaz y el
 * proveedor real vive detras de un adaptador. Cambiar de BSP (Meta directo,
 * Twilio, 360dialog, Gupshup) es escribir otro adaptador, no tocar la logica
 * de recordatorios.
 */
import type { NombrePlantilla, Plantilla } from './plantillas.js';
import { PLANTILLAS, renderizar, validarPlantilla } from './plantillas.js';

export interface EnvioPlantilla {
  /** Celular destino en E.164. */
  a: string;
  plantilla: NombrePlantilla;
  variables: readonly string[];
}

export interface EnvioTexto {
  a: string;
  texto: string;
}

export interface ResultadoEnvio {
  /** id del mensaje en el proveedor, para casar los webhooks de entrega. */
  idExterno: string;
}

export interface CanalWhatsApp {
  /**
   * Mensaje iniciado por el sistema. Fuera de la ventana de 24 horas Meta solo
   * acepta plantillas aprobadas, y todos los avisos de Huella caen ahi.
   */
  enviarPlantilla(envio: EnvioPlantilla): Promise<ResultadoEnvio>;
  /**
   * Texto libre. Solo vale dentro de la ventana de 24 horas desde el ultimo
   * mensaje de la usuaria: sirve para responderle, no para recordarle.
   */
  enviarTexto(envio: EnvioTexto): Promise<ResultadoEnvio>;
}

export class ErrorEnvio extends Error {
  constructor(
    mensaje: string,
    /** Si el fallo es transitorio vale la pena reintentar; si no, no. */
    readonly reintentable: boolean,
    readonly detalle?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorEnvio';
  }
}

// ---------------------------------------------------------------------------
// Adaptador falso, para desarrollo y pruebas
// ---------------------------------------------------------------------------

export interface MensajeRegistrado {
  a: string;
  texto: string;
  plantilla?: NombrePlantilla;
  variables?: readonly string[];
  idExterno: string;
  enviadoEn: Date;
}

/**
 * No manda nada: guarda lo que se habria mandado.
 *
 * Renderiza la plantilla de verdad y la valida, para que las pruebas fallen por
 * las mismas razones por las que fallaria Meta (variable vacia, numero de
 * valores que no cuadra) en vez de pasar y romperse en produccion.
 */
export class WhatsAppFalso implements CanalWhatsApp {
  readonly enviados: MensajeRegistrado[] = [];
  /** Cuantos envios consecutivos deben fallar; para probar RNF-04. */
  fallasPendientes = 0;
  fallaPermanente = false;

  private contador = 0;

  private siguienteId(): string {
    this.contador += 1;
    return `falso-${this.contador}`;
  }

  private comprobarFalla(): void {
    if (this.fallaPermanente) throw new ErrorEnvio('Falla permanente simulada', false);
    if (this.fallasPendientes > 0) {
      this.fallasPendientes -= 1;
      throw new ErrorEnvio('Falla transitoria simulada', true);
    }
  }

  async enviarPlantilla(envio: EnvioPlantilla): Promise<ResultadoEnvio> {
    this.comprobarFalla();
    const p: Plantilla = PLANTILLAS[envio.plantilla];
    validarPlantilla(p);
    const texto = renderizar(p, envio.variables);
    const idExterno = this.siguienteId();
    this.enviados.push({
      a: envio.a,
      texto,
      plantilla: envio.plantilla,
      variables: envio.variables,
      idExterno,
      enviadoEn: new Date(),
    });
    return { idExterno };
  }

  async enviarTexto(envio: EnvioTexto): Promise<ResultadoEnvio> {
    this.comprobarFalla();
    const idExterno = this.siguienteId();
    this.enviados.push({ a: envio.a, texto: envio.texto, idExterno, enviadoEn: new Date() });
    return { idExterno };
  }

  limpiar(): void {
    this.enviados.length = 0;
    this.fallasPendientes = 0;
    this.fallaPermanente = false;
  }

  /** Ultimo mensaje mandado a un numero. */
  ultimoPara(celular: string): MensajeRegistrado | undefined {
    return [...this.enviados].reverse().find((m) => m.a === celular);
  }
}

// ---------------------------------------------------------------------------
// Adaptador de la API oficial de WhatsApp Business (Meta Cloud API)
// ---------------------------------------------------------------------------

export interface OpcionesMeta {
  phoneNumberId: string;
  accessToken: string;
  version?: string;
  fetchImpl?: typeof fetch;
}

export class WhatsAppMeta implements CanalWhatsApp {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opciones: OpcionesMeta) {
    const version = opciones.version ?? 'v21.0';
    this.base = `https://graph.facebook.com/${version}/${opciones.phoneNumberId}/messages`;
    this.token = opciones.accessToken;
    this.fetchImpl = opciones.fetchImpl ?? fetch;
  }

  private async postear(cuerpo: Record<string, unknown>): Promise<ResultadoEnvio> {
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(this.base, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cuerpo),
      });
    } catch (error) {
      // Fallo de red: siempre vale la pena reintentar.
      throw new ErrorEnvio('No se pudo contactar la API de WhatsApp', true, error);
    }

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      // 4xx es un problema nuestro (plantilla no aprobada, numero invalido) y
      // reintentarlo solo gasta cuota; 429 y 5xx si son transitorios.
      const reintentable = respuesta.status === 429 || respuesta.status >= 500;
      throw new ErrorEnvio(`WhatsApp respondio ${respuesta.status}: ${detalle}`, reintentable);
    }

    const json = (await respuesta.json()) as { messages?: Array<{ id?: string }> };
    const idExterno = json.messages?.[0]?.id;
    if (!idExterno) throw new ErrorEnvio('WhatsApp no devolvio id de mensaje', false, json);
    return { idExterno };
  }

  async enviarPlantilla(envio: EnvioPlantilla): Promise<ResultadoEnvio> {
    const p = PLANTILLAS[envio.plantilla];
    // Se renderiza aunque Meta arme el texto por su lado: si una variable va
    // vacia o sobra, es mejor enterarse aqui que por un rechazo de la API.
    renderizar(p, envio.variables);

    return this.postear({
      messaging_product: 'whatsapp',
      to: envio.a,
      type: 'template',
      template: {
        name: p.nombre,
        language: { code: p.idioma },
        components: [
          {
            type: 'body',
            parameters: envio.variables.map((valor) => ({ type: 'text', text: valor })),
          },
        ],
      },
    });
  }

  async enviarTexto(envio: EnvioTexto): Promise<ResultadoEnvio> {
    return this.postear({
      messaging_product: 'whatsapp',
      to: envio.a,
      type: 'text',
      text: { preview_url: false, body: envio.texto },
    });
  }
}

export function crearCanalWhatsApp(config: {
  driver: 'fake' | 'meta';
  phoneNumberId?: string | undefined;
  accessToken?: string | undefined;
}): CanalWhatsApp {
  if (config.driver === 'fake') return new WhatsAppFalso();
  if (!config.phoneNumberId || !config.accessToken) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN son obligatorios con WHATSAPP_DRIVER=meta.');
  }
  return new WhatsAppMeta({ phoneNumberId: config.phoneNumberId, accessToken: config.accessToken });
}
