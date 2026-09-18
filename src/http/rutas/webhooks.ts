/**
 * Webhooks de WhatsApp: acuses de entrega y lectura (RF-15) y mensajes
 * entrantes de la usuaria.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Servicios } from '../servidor.js';
import { registrarEstadoDeEntrega } from '../../modules/recordatorios/servicio.js';

interface EventoWhatsApp {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: Array<{ id?: string; status?: string; timestamp?: string }>;
        messages?: Array<{ from?: string; id?: string; text?: { body?: string }; timestamp?: string }>;
      };
    }>;
  }>;
}

/**
 * Meta firma cada webhook con HMAC-SHA256 del cuerpo crudo.
 *
 * Comprobarlo no es opcional: sin firma, cualquiera que descubra la URL puede
 * marcar recordatorios como entregados, y RF-15 existe precisamente para
 * detectar fallas de envio. Un acuse falso las escondería.
 */
function firmaValida(cuerpoCrudo: Buffer, firma: string | undefined, secreto: string): boolean {
  if (!firma?.startsWith('sha256=')) return false;
  const esperada = createHmac('sha256', secreto).update(cuerpoCrudo).digest();
  const recibida = Buffer.from(firma.slice('sha256='.length), 'hex');
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

export async function registrarRutasWebhooks(app: FastifyInstance, s: Servicios): Promise<void> {
  // Se guarda el cuerpo crudo: la firma se calcula sobre los bytes exactos que
  // mando Meta, y volver a serializar el JSON cambiaría el resultado.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (peticion, cuerpo, hecho) => {
      (peticion as { cuerpoCrudo?: Buffer }).cuerpoCrudo = cuerpo as Buffer;
      try {
        hecho(null, (cuerpo as Buffer).length === 0 ? {} : JSON.parse((cuerpo as Buffer).toString('utf8')));
      } catch (error) {
        hecho(error as Error, undefined);
      }
    },
  );

  /** Verificacion del webhook que hace Meta al darlo de alta. */
  app.get('/webhooks/whatsapp', async (peticion, respuesta) => {
    const consulta = peticion.query as Record<string, string | undefined>;
    const esperado = s.config.whatsapp.webhookVerifyToken;

    if (consulta['hub.mode'] === 'subscribe' && esperado && consulta['hub.verify_token'] === esperado) {
      return respuesta.status(200).send(consulta['hub.challenge'] ?? '');
    }
    return respuesta.status(403).send('');
  });

  app.post('/webhooks/whatsapp', async (peticion, respuesta) => {
    const secreto = s.config.whatsapp.appSecret;
    if (secreto) {
      const crudo = (peticion as { cuerpoCrudo?: Buffer }).cuerpoCrudo ?? Buffer.alloc(0);
      if (!firmaValida(crudo, peticion.headers['x-hub-signature-256'] as string | undefined, secreto)) {
        return respuesta.status(401).send({ error: 'firma_invalida' });
      }
    } else if (s.config.entorno === 'production') {
      // Sin secreto configurado no hay forma de saber que el evento viene de
      // Meta. En produccion eso es un fallo de configuracion, no un caso a
      // tolerar en silencio.
      peticion.log.error('WHATSAPP_APP_SECRET sin configurar: no se pueden verificar los webhooks');
      return respuesta.status(500).send({ error: 'webhook_sin_firma' });
    }

    const evento = peticion.body as EventoWhatsApp;
    let procesados = 0;

    for (const entrada of evento.entry ?? []) {
      for (const cambio of entrada.changes ?? []) {
        for (const estado of cambio.value?.statuses ?? []) {
          if (!estado.id || !estado.status) continue;
          const cuando = estado.timestamp ? new Date(Number(estado.timestamp) * 1000) : new Date();

          const traduccion: Record<string, 'entregado' | 'leido' | 'fallido'> = {
            delivered: 'entregado',
            read: 'leido',
            failed: 'fallido',
          };
          const nuestro = traduccion[estado.status];
          if (!nuestro) continue;

          if (await registrarEstadoDeEntrega(s.pool, estado.id, nuestro, cuando)) procesados += 1;
        }
      }
    }

    // Meta reintenta si no recibe 200 rapido, asi que se contesta siempre 200:
    // un evento que no reconocemos no es razon para que nos lo reenvie.
    return respuesta.status(200).send({ procesados });
  });
}
