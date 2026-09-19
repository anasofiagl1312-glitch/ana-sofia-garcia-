/*
 * `npm run empezar` — deja el proyecto listo para abrir el panel.
 *
 * Existe porque entre clonar el repositorio y ver el panel hay cuatro cosas
 * que pueden fallar, y las cuatro fallan con mensajes que no dicen qué hacer:
 * falta el archivo .env, no hay PostgreSQL corriendo, el usuario de la base no
 * es el que dice .env.example, o la base existe pero está vacía.
 *
 * Este script las revisa en orden y, cuando puede, las arregla solo. Cuando no
 * puede, dice exactamente qué teclear.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buscarServidor, candidatas, conecta, sinContrasena } from './postgres.mjs';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

const VERDE = '\u001b[32m';
const ROJO = '\u001b[31m';
const GRIS = '\u001b[90m';
const FUERTE = '\u001b[1m';
const FIN = '\u001b[0m';

const ok = (t) => console.log(`${VERDE}✓${FIN} ${t}`);
const nota = (t) => console.log(`${GRIS}  ${t}${FIN}`);
const paso = (t) => console.log(`\n${FUERTE}${t}${FIN}`);

function rendirse(titulo, lineas) {
  console.log(`\n${ROJO}✗ ${titulo}${FIN}\n`);
  for (const l of lineas) console.log(`  ${l}`);
  console.log('');
  process.exit(1);
}

// ---------------------------------------------------------------- 1. Node

paso('1. Node');

const mayor = Number(process.versions.node.split('.')[0]);
if (mayor < 22) {
  rendirse(`Este proyecto necesita Node 22 o más nuevo, y tienes ${process.versions.node}.`, [
    'En una Mac, lo más rápido es:',
    '',
    `  ${FUERTE}brew install node${FIN}`,
    '',
    'Si no tienes Homebrew, bájalo de https://nodejs.org (la versión LTS).',
  ]);
}
ok(`Node ${process.versions.node}`);

// ----------------------------------------------------------------- 2. .env

paso('2. El archivo .env');

const rutaEnv = join(RAIZ, '.env');
const rutaEjemplo = join(RAIZ, '.env.example');

if (!existsSync(rutaEnv)) {
  if (!existsSync(rutaEjemplo)) {
    rendirse('No encuentro .env ni .env.example.', ['¿Estás parada dentro de la carpeta del proyecto?']);
  }
  writeFileSync(rutaEnv, readFileSync(rutaEjemplo, 'utf8'));
  ok('Creé .env a partir de .env.example');
} else {
  ok('.env ya existe');
}

function leerEnv() {
  const texto = readFileSync(rutaEnv, 'utf8');
  const valores = {};
  for (const linea of texto.split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) valores[m[1]] = m[2].trim();
  }
  return valores;
}

function escribirEnv(clave, valor) {
  const texto = readFileSync(rutaEnv, 'utf8');
  const patron = new RegExp(`^\\s*${clave}\\s*=.*$`, 'm');
  const linea = `${clave}=${valor}`;
  writeFileSync(rutaEnv, patron.test(texto) ? texto.replace(patron, linea) : `${texto.trimEnd()}\n${linea}\n`);
}

// ------------------------------------------------- 3. La llave de cifrado

paso('3. La llave con la que se cifran los carnets');

/*
 * Sin esto el servidor no arranca (RNF-06: los documentos se guardan
 * cifrados), y el error sale hasta `npm run dev`, cuando ya parecía que todo
 * estaba listo. Se genera aquí y se queda en .env, que no se versiona.
 */
if (!leerEnv().ENCRYPTION_KEY) {
  escribirEnv('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  ok('Generé una llave nueva y la guardé en .env');
  nota('Es de esta computadora y no se sube a GitHub. Si la pierdes, los');
  nota('carnets ya guardados dejan de poder leerse.');
} else {
  ok('Ya había una llave en .env');
}

// ----------------------------------------------------------- 4. PostgreSQL

paso('4. PostgreSQL');

const env = leerEnv();
const servidor = await buscarServidor(candidatas(env.DATABASE_URL));

if (!servidor) {
  rendirse('No encuentro PostgreSQL corriendo en esta computadora.', [
    'El panel guarda todo en PostgreSQL, así que tiene que estar prendido.',
    '',
    `${FUERTE}Si no lo tienes instalado${FIN}, en una Mac:`,
    '',
    `  ${FUERTE}brew install postgresql@16${FIN}`,
    `  ${FUERTE}brew services start postgresql@16${FIN}`,
    '',
    'Si no usas Homebrew, baja Postgres.app de https://postgresapp.com',
    'y ábrelo una vez (el botón "Initialize").',
    '',
    `${FUERTE}Si ya lo tienes${FIN}, probablemente está apagado. Préndelo con:`,
    '',
    `  ${FUERTE}brew services start postgresql@16${FIN}`,
    '',
    'Y vuelve a correr «npm run empezar».',
  ]);
}

ok(`PostgreSQL responde en ${sinContrasena(servidor)}`);

// --------------------------------------------------------- 5. Las dos bases

paso('5. Las bases de datos');

async function creaSiFalta(nombre) {
  const url = servidor.replace(/\/postgres$/, `/${nombre}`);
  if (await conecta(url)) { ok(`La base "${nombre}" ya existía`); return url; }

  const cliente = new pg.Client({ connectionString: servidor });
  await cliente.connect();
  try {
    await cliente.query(`CREATE DATABASE ${nombre}`);
    ok(`Creé la base "${nombre}"`);
  } catch (e) {
    if (e.code !== '42P04') {
      rendirse(`No pude crear la base "${nombre}".`, [
        `PostgreSQL contestó: ${e.message}`,
        '',
        'Suele ser que el usuario con el que entré no tiene permiso de crear',
        'bases. Créala a mano con:',
        '',
        `  ${FUERTE}createdb ${nombre}${FIN}`,
      ]);
    }
    ok(`La base "${nombre}" ya existía`);
  } finally {
    await cliente.end();
  }
  return url;
}

const urlDesarrollo = await creaSiFalta('huella');
const urlPruebas = await creaSiFalta('huella_test');

escribirEnv('DATABASE_URL', urlDesarrollo);
escribirEnv('DATABASE_URL_TEST', urlPruebas);
ok('Guardé las dos direcciones en .env');

// ------------------------------------------------- 6. Esquema y datos

function corre(titulo, comando, argumentos) {
  const r = spawnSync(comando, argumentos, { cwd: RAIZ, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    rendirse(`Falló: ${titulo}`, ['Mándame lo que salió arriba y lo vemos.']);
  }
}

paso('6. El esquema');
corre('las migraciones', 'npm', ['run', 'migrate']);
ok('Esquema al día');

paso('7. La usuaria del panel y unos datos de ejemplo');
corre('la siembra', 'npm', ['run', 'seed']);

// ---------------------------------------------------------------- listo

console.log(`\n${VERDE}${FUERTE}Todo listo.${FIN}\n`);
console.log(`  Levanta el servidor con:   ${FUERTE}npm run dev${FIN}`);
console.log(`  Y abre en el navegador:    ${FUERTE}http://localhost:3000/panel/${FIN}\n`);
console.log(`  Correo:      ${FUERTE}operadora@huella.mx${FIN}`);
console.log(`  Contraseña:  ${FUERTE}huella${FIN}\n`);
nota('Deja esa terminal abierta: si la cierras, el servidor se apaga y el');
nota('navegador vuelve a decir «no se puede acceder a este sitio».');
console.log('');
