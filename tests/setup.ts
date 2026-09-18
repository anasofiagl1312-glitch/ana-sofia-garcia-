// Las pruebas nunca deben depender de la zona horaria de la maquina que las
// corre. Se fija una distinta de la de la usuaria a proposito, para que
// cualquier conversion que se le haya olvidado la zona salte.
process.env.TZ = 'UTC';
process.env.NODE_ENV = 'test';
