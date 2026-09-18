import { config as cargarDotenv } from 'dotenv';
import { z } from 'zod';

cargarDotenv();

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  DATABASE_URL_TEST: z.string().optional(),

  DEFAULT_TIMEZONE: z.string().default('America/Mexico_City'),

  ENCRYPTION_KEY: z.string().optional(),

  WHATSAPP_DRIVER: z.enum(['fake', 'meta']).default('fake'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),

  BILLING_DRIVER: z.enum(['fake', 'stripe']).default('fake'),
  BILLING_TRIAL_DAYS: z.coerce.number().int().nonnegative().default(14),
  BILLING_MONTHLY_PRICE_MXN: z.coerce.number().positive().default(149),
});

export interface Config {
  entorno: 'development' | 'test' | 'production';
  puerto: number;
  nivelLog: string;
  databaseUrl: string;
  zonaHorariaPorDefecto: string;
  llaveCifrado: string | undefined;
  whatsapp: {
    driver: 'fake' | 'meta';
    phoneNumberId: string | undefined;
    accessToken: string | undefined;
    webhookVerifyToken: string | undefined;
    appSecret: string | undefined;
  };
  almacenamiento: { driver: 'local' | 's3'; rutaLocal: string };
  cobros: { driver: 'fake' | 'stripe'; diasPrueba: number; precioMensual: number };
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = esquema.parse(env);
  const esPrueba = parsed.NODE_ENV === 'test';
  const databaseUrl = esPrueba ? (parsed.DATABASE_URL_TEST ?? parsed.DATABASE_URL) : parsed.DATABASE_URL;

  if (parsed.NODE_ENV === 'production') {
    if (!parsed.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY es obligatoria en produccion (RNF-06: datos cifrados en reposo).');
    }
    if (parsed.WHATSAPP_DRIVER === 'fake') {
      throw new Error('WHATSAPP_DRIVER=fake no puede usarse en produccion.');
    }
  }

  return {
    entorno: parsed.NODE_ENV,
    puerto: parsed.PORT,
    nivelLog: parsed.LOG_LEVEL,
    databaseUrl,
    zonaHorariaPorDefecto: parsed.DEFAULT_TIMEZONE,
    llaveCifrado: parsed.ENCRYPTION_KEY,
    whatsapp: {
      driver: parsed.WHATSAPP_DRIVER,
      phoneNumberId: parsed.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: parsed.WHATSAPP_ACCESS_TOKEN,
      webhookVerifyToken: parsed.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      appSecret: parsed.WHATSAPP_APP_SECRET,
    },
    almacenamiento: { driver: parsed.STORAGE_DRIVER, rutaLocal: parsed.STORAGE_LOCAL_PATH },
    cobros: {
      driver: parsed.BILLING_DRIVER,
      diasPrueba: parsed.BILLING_TRIAL_DAYS,
      precioMensual: parsed.BILLING_MONTHLY_PRICE_MXN,
    },
  };
}
