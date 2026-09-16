# Inventário TON — Guia de publicação na internet (grátis)

Este guia coloca a app **online**, acessível de qualquer telemóvel ou computador com internet,
mantendo **todas as funções** (login, sincronização entre dispositivos, códigos automáticos,
leilão, movimentos de stock).

Usamos dois serviços gratuitos:

- **Render** — corre o servidor da app (Node.js).
- **Turso** — guarda a base de dados na nuvem (SQLite), para os dados **nunca se perderem**.
- **GitHub** — guarda o código, de onde o Render o vai buscar.

São 3 contas gratuitas e **sem cartão de crédito**. Segue os passos pela ordem. Demora ~20–30 min.

> **Importante:** esta pasta (`Inventario_TON_v2.3_WEB`) é o teu **código-fonte editável**.
> Guarda-a bem. Sempre que quiseres melhorar a app, edita aqui e volta a enviar para o GitHub
> (Passo 1.3) — o Render publica a nova versão sozinho.

---

## Passo 1 — Colocar o código no GitHub

### 1.1 Criar conta
1. Vai a <https://github.com> → **Sign up**. Cria a conta (email + senha) e confirma o email.

### 1.2 Criar o repositório
1. Canto superior direito **+** → **New repository**.
2. **Repository name:** `inventario-ton`
3. Deixa em **Public** (ou Private — funciona igual com o Render).
4. **NÃO** marques "Add a README".
5. Clica **Create repository**.

### 1.3 Enviar os ficheiros
1. Na página do repositório vazio, clica em **uploading an existing file**
   (link "upload an existing file").
2. Abre a pasta `Inventario_TON_v2.3_WEB` no teu computador.
3. Seleciona **todos os ficheiros e a pasta `public`** — mas **NÃO** envies:
   - `node_modules` (não existe se não a criaste; é recriada pelo Render)
   - `inventario_ton.db` (base de teste local; não deve ir)
   Arrasta o resto para a área de upload do GitHub:
   `server.js`, `db.js`, `redefinir-senha.js`, `package.json`, `package-lock.json`,
   `render.yaml`, `.gitignore`, `LEIA-ME.md`, `LEIA-ME_HOSPEDAGEM.md` e a pasta **`public`**.
4. Em baixo, clica **Commit changes**.

> Dica: se o GitHub não deixar arrastar a pasta `public`, cria-a com
> **Add file → Create new file** e escreve `public/index.html` no nome — depois cola o conteúdo.
> Mais simples: usa o botão de upload e arrasta a pasta inteira (o Chrome/Edge aceitam pastas).

---

## Passo 2 — Criar a base de dados na Turso

1. Vai a <https://turso.tech> → **Sign up** (podes entrar com a conta do GitHub — mais rápido).
2. No painel, cria uma base de dados: **Create Database** (ou **+ New**).
   - Dá-lhe o nome `inventario-ton`.
   - Escolhe a região mais próxima (ex.: **Frankfurt / eu-central**).
3. Aberta a base, procura **Connect** (ou **Connection details**). Vais precisar de **dois valores**:
   - **Database URL** — começa por `libsql://inventario-ton-....turso.io`
   - **Auth Token** — clica em **Create Token** / **Generate Token** e **copia o token**
     (é uma linha longa de letras e números). Guarda-o já, pois às vezes só é mostrado uma vez.

> Anota os dois valores num bloco de notas temporário. Vais colá-los no Passo 3.

---

## Passo 3 — Publicar no Render

1. Vai a <https://render.com> → **Get Started** / **Sign up**
   (entra com a conta do **GitHub** — assim o Render vê o teu repositório).
2. No painel: **New +** → **Web Service**.
3. Liga o teu GitHub e escolhe o repositório **`inventario-ton`**.
   (Se pedir, autoriza o Render a aceder aos teus repositórios.)
4. Confirma/preenche:
   - **Name:** `inventario-ton`
   - **Region:** a mais próxima (ex.: Frankfurt)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type / Plan:** **Free**
5. Abre **Advanced** → **Add Environment Variable** e cria **duas variáveis**
   (exatamente com estes nomes):
   | Key (nome) | Value (valor) |
   |---|---|
   | `TURSO_DATABASE_URL` | *(cola o Database URL da Turso — `libsql://...`)* |
   | `TURSO_AUTH_TOKEN` | *(cola o Auth Token da Turso)* |
6. Clica **Create Web Service**.
7. Espera pelo build (2–4 min). Quando aparecer **Live** (verde), a app está online.
8. O endereço fica no topo, algo como:
   **`https://inventario-ton.onrender.com`**
   Abre-o no telemóvel/computador e entra com **admin / ton2026**.

**Pronto! A app está na internet.** Partilha o endereço com a equipa e instala como app
(no Chrome/Edge: menu → *Instalar aplicação*), tal como no manual principal.

---

## Depois de publicar (importante)

1. **Muda as senhas** de `admin` e de `augusto` (Supervisor) — em **Configurações** → *Alterar senha*.
2. Cria as contas da equipa em **Utilizadores**.
3. **Primeiro arranque "lento":** no plano gratuito do Render, se ninguém usar a app durante
   ~15 minutos, ela "adormece". O acesso seguinte demora ~30 segundos a acordar; depois fica rápida.
   É normal e não perde dados (os dados estão na Turso, sempre guardados).

---

## Como publicar uma versão melhorada (no futuro)

1. Edita os ficheiros nesta pasta (`Inventario_TON_v2.3_WEB`) no teu computador.
2. Testa localmente se quiseres (ver secção seguinte).
3. No GitHub, no repositório, **Add file → Upload files**, arrasta os ficheiros alterados,
   **Commit changes**.
4. O Render deteta a alteração e **republica sozinho** em poucos minutos. Os dados mantêm-se.

---

## Testar no teu computador antes de publicar (opcional)

1. Instala o Node.js LTS de <https://nodejs.org> (se ainda não tiveres).
2. Nesta pasta, abre um terminal e corre uma vez: `npm install`
3. Corre: `npm start`
4. Abre <http://localhost:3000>. Usa **admin / ton2026**.
   - Sem as variáveis da Turso, usa uma base **local de teste** (`inventario_ton.db`),
     que **não** interfere com a base real na nuvem. Podes apagar esse ficheiro quando quiseres.

---

## As fotos do levantamento (opcional)

As fotos tiradas dentro da app (câmara) ficam guardadas na base de dados e aparecem em todo o lado.

As **279 fotos antigas do levantamento** (pasta `imagens`, ~397 MB) **não** foram incluídas por
serem pesadas de mais para o plano gratuito. Os itens importados da avaliação vão mostrar
"sem imagem". Se quiseres recuperá-las mais tarde, há duas vias:
- **Via A (recomendada):** alojar essa pasta `imagens` no teu espaço da **InfinityFree**
  (`materiais.gt.tc`), que é ótimo para ficheiros estáticos, e ajustar a app para as ir buscar lá.
- **Via B:** juntar a pasta `imagens` ao repositório do GitHub (torna cada publicação mais lenta).

Diz-me qual preferes e eu trato disso.

---

## Reposição de senha pela linha de comandos (avançado)

Se algum dia ficares sem acesso de admin, nesta pasta, com as variáveis da Turso definidas no
terminal, corre:
```
node redefinir-senha.js "novaSenha123" admin
```

---

*Inventário TON · Sonangol Distribuição e Comercialização — Terminal Oceânico do Namibe · 2026*
