/* ============================================================
   Inventário TON — Camada de base de dados (Turso / libSQL)
   ------------------------------------------------------------
   Mantém o mesmo dialeto SQLite do servidor original, mas os
   dados passam a viver numa base Turso na nuvem (persistente),
   em vez de um ficheiro local que se perderia a cada reinício
   no alojamento gratuito.

   Em produção (Render), define-se por variáveis de ambiente:
     TURSO_DATABASE_URL   ex.: libsql://inventario-ton-xxxx.turso.io
     TURSO_AUTH_TOKEN     token gerado na Turso

   Sem essas variáveis (teste no computador), usa um ficheiro
   local "inventario_ton.db" — igual à experiência do servidor LAN.
   ============================================================ */
"use strict";
const path = require("path");
const { createClient } = require("@libsql/client");

const url = process.env.TURSO_DATABASE_URL
  || ("file:" + path.join(__dirname, "inventario_ton.db"));
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const client = createClient({ url, authToken, intMode: "number" });

/* libSQL não aceita "undefined" nos argumentos — converte para null. */
const limpar = (args) => args.map((v) => (v === undefined ? null : v));

/* Helpers com a mesma semântica do node:sqlite original:
   get  -> primeira linha (ou undefined)
   all  -> todas as linhas (array)
   run  -> executa (INSERT/UPDATE/DELETE)
   exec -> executa um script com vários comandos (esquema) */
async function get(sql, ...args) {
  const r = await client.execute({ sql, args: limpar(args) });
  return r.rows[0];
}
async function all(sql, ...args) {
  const r = await client.execute({ sql, args: limpar(args) });
  return r.rows;
}
async function run(sql, ...args) {
  return client.execute({ sql, args: limpar(args) });
}
async function exec(scriptSql) {
  return client.executeMultiple(scriptSql);
}

module.exports = { client, get, all, run, exec };
