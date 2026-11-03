# Coletor de qualidade do ar — especificação

Especificação do coletor próprio que leva as leituras dos monitores de qualidade
do ar ao UFCIM. A decisão e as alternativas rejeitadas estão no
[ADR 0002](adr/0002-air-quality-local-collector.md). Nada disto foi construído
ainda; as fases de entrega estão no fim do documento.

> **Estado em 2026-11-03.** A fatia mínima das fases 0–3 roda localmente, no
> branch `feat/air-quality-ingest` (backend + coletor) e `feat/air-quality-popup`
> (front): migração `0007`, `POST /ingest/v1/samples`,
> `GET /api/v1/spaces/:id/air-quality`, `scripts/register-sensor.mjs`, o coletor
> em `collector/` (protocolo 3.5 confirmado na bancada) e o bloco "Qualidade do
> ar" no `RoomPopup`, com o aparelho vinculado à Sala 09 do Bloco 3, e o
> histórico por hora (`…/history`) na seção "Qualidade do ar" do relatório da
> sala. Ainda não foram feitos: `GET /api/v1/air-quality/latest`, a página de
> admin e a retenção. Exploração do aparelho e evidências: nota do vault
> `01-Projects/Hackaton UFC/BREATHE Airmonitor Plus — exploração e integração no UFCIM.md`.

---

## Visão geral

```text
 rede IoT da sala (2,4 GHz WPA2-Personal)                    Cloudflare
┌───────────────────────────────────────────┐        ┌──────────────────────────┐
│  Airmonitor Plus ──TCP 6668 (Tuya 3.x)──┐  │        │  Worker ufcim-backend    │
│  Airmonitor Plus ─────────────────────┐ │  │ HTTPS  │  POST /ingest/v1/samples │
│                                       ▼ ▼  │───────▶│        │                 │
│                     ufcim-collector (Docker)│        │        ▼                 │
│                     outbox SQLite local     │        │  D1: sensor_readings     │
└───────────────────────────────────────────┘        │        │                 │
                                                     │  GET /api/v1/spaces/:id/ │
                                                     │      air-quality         │──▶ RoomPopup
                                                     └──────────────────────────┘
```

Três peças, com fronteiras nítidas:

| Peça | Sabe | Não sabe |
|---|---|---|
| **Coletor** (`collector/`, Python) | IP, *local key*, versão de protocolo e mapa de DPs de cada aparelho | salas, usuários, regras do UFCIM |
| **Ingestão** (Worker, `/ingest/v1`) | qual coletor é quem, quais aparelhos existem e a que sala pertencem, faixas válidas por métrica | Tuya, DPs, protocolo |
| **Leitura** (Worker, `/api/v1`) | última leitura e histórico por sala, frescor do dado | de onde a leitura veio |

O contrato de ingestão não menciona Tuya. Um poller da Tuya Cloud, uma automação
do Home Assistant ou um sensor de outro fabricante pode postar nele sem mudança
no backend.

## Métricas canônicas

Uma amostra tem estas métricas, todas opcionais. A faixa aceita vem do manual do
BTL40001, com folga onde o sensor satura.

| Campo | Unidade | Faixa aceita | Observação |
|---|---|---|---|
| `co2_ppm` | ppm | 0–10.000 | NDIR; o aparelho mede 400–5.000 |
| `pm1_ugm3` | µg/m³ | 0–1.000 | |
| `pm25_ugm3` | µg/m³ | 0–1.000 | |
| `pm10_ugm3` | µg/m³ | 0–1.000 | |
| `tvoc_mgm3` | mg/m³ | 0–10 | tendência, não concentração de referência |
| `hcho_mgm3` | mg/m³ | 0–2 | tendência, não concentração de referência |
| `temperature_c` | °C | −20–60 | |
| `humidity_pct` | % | 0–100 | |
| `battery_pct` | % | 0–100 | saúde do aparelho, não qualidade do ar |

Valor fora da faixa não derruba a amostra: o campo é gravado como `NULL` e
contado em `rejected_fields` na resposta.

## Modelo de dados (D1)

Migração nova, via `drizzle-kit generate`. Convenções do `schema.ts`: IDs texto
(UUID), datas ISO em texto, `created_at`/`updated_at` em toda tabela de cadastro.

```text
sensor_collectors
  id            text PK (UUID)
  name          text NOT NULL            -- "bancada-hermes", "iaud-bloco2"
  token_hash    text NOT NULL UNIQUE     -- SHA-256 hex do token; o token nunca é gravado
  last_seen_at  text                     -- última ingestão aceita
  last_version  text                     -- versão do coletor informada no payload
  revoked_at    text
  created_at, updated_at

sensor_devices
  id              text PK (UUID)
  external_id     text NOT NULL UNIQUE   -- device ID do fabricante (Tuya: ebdaebfb3e5ed2f01crg1m)
  vendor          text NOT NULL          -- 'tuya'
  model           text NOT NULL          -- 'BREATHE BTL40001'
  label           text                   -- "Airmonitor 01"
  collector_id    text NOT NULL → sensor_collectors.id
  space_id        text → spaces.id       -- NULL = em bancada, sem sala
  last_status     text                   -- 'ok' | 'unreachable' | 'auth_failed' | 'bad_payload'
  last_status_at  text
  last_error      text
  retired_at      text
  created_at, updated_at

sensor_readings
  device_id      text NOT NULL → sensor_devices.id
  measured_at    text NOT NULL           -- ISO UTC, início do minuto da amostra
  received_at    text NOT NULL
  co2_ppm, pm1_ugm3, pm25_ugm3, pm10_ugm3,
  tvoc_mgm3, hcho_mgm3, temperature_c, humidity_pct  real NULL
  battery_pct    integer NULL
  PRIMARY KEY (device_id, measured_at)   -- torna o reenvio idempotente
```

- **A sala é resolvida na leitura, não na gravação.** `sensor_readings` não tem
  `space_id`; a sala vem de `sensor_devices.space_id`. Mover o aparelho de sala
  muda o vínculo daí em diante, mas o histórico antigo passa a aparecer na sala
  nova. No piloto isso é aceitável; se virar problema, criar
  `sensor_device_placements (device_id, space_id, from, to)` e resolver por data.
- **`PRIMARY KEY (device_id, measured_at)`** dá o índice da consulta "últimas
  leituras do aparelho" e faz `INSERT … ON CONFLICT DO NOTHING` absorver reenvios.

## Ingestão: `POST /ingest/v1/samples`

Montada em `app.route('/ingest/v1', ingestRoutes)`, **fora** de `/api/v1`, que
exige JWT de usuário. Sem CORS: só máquinas chamam.

**Autenticação.** `Authorization: Bearer <token do coletor>`. O middleware
calcula o SHA-256 do token, busca `sensor_collectors` por `token_hash` com
`revoked_at IS NULL` e expõe o coletor em `c.get('collector')`. Token ausente,
desconhecido ou revogado → 401 com o mesmo corpo. Rate limit com o
`rateLimit()` existente, namespace `ingest`, 30 requisições/minuto por IP.

**Corpo** (validado com Zod em `src/validators/ingest.schema.ts`):

```json
{
  "collector": { "version": "0.1.0", "started_at": "2026-11-03T17:00:00Z" },
  "samples": [
    {
      "device": "ebdaebfb3e5ed2f01crg1m",
      "measured_at": "2026-11-03T17:13:00Z",
      "values": {
        "co2_ppm": 496, "pm1_ugm3": 4, "pm25_ugm3": 5, "pm10_ugm3": 6,
        "tvoc_mgm3": 0.01, "hcho_mgm3": 0.0,
        "temperature_c": 33.0, "humidity_pct": 51, "battery_pct": 100
      }
    }
  ],
  "device_status": [
    { "device": "ebdaebfb3e5ed2f01crg1m", "state": "ok", "last_ok_at": "2026-11-03T17:13:58Z", "error": null }
  ]
}
```

Regras:

- No máximo **500 amostras** por requisição; `device_status` pode vir sem amostras e
  serve de heartbeat.
- `measured_at` é truncado ao minuto. Amostra mais de 5 minutos no futuro ou mais
  de 7 dias no passado é rejeitada sozinha e contada em `rejected_samples`, sem
  derrubar o resto do lote (relógio do host errado ou fila velha demais).
- O aparelho tem de existir em `sensor_devices` **e pertencer ao coletor
  autenticado**. Assim um token vazado de um coletor não escreve no aparelho de
  outro.
- Gravação em `db.batch` com `ON CONFLICT (device_id, measured_at) DO NOTHING`.
  Depois, atualiza `sensor_collectors.last_seen_at`/`last_version` e o
  `last_status*` dos aparelhos citados em `device_status`.

**Resposta** `200`:

```json
{ "accepted": 1, "duplicates": 0, "rejected_samples": 0, "rejected_fields": 0, "unknown_devices": [] }
```

O coletor apaga da fila tudo o que mandou quando recebe 200, inclusive amostras
de `unknown_devices`, e registra um aviso para elas. Erro `4xx` de validação →
o lote é descartado com log, para não travar a fila. `401`, `429`, `5xx` ou falha
de rede → o lote fica na fila e volta com *backoff*.

## Leitura: `/api/v1`

Atrás do `authMiddleware` atual; qualquer papel autenticado lê.

- **`GET /api/v1/spaces/:spaceId/air-quality`** — aparelho ativo da sala e a
  última amostra dele.

  ```json
  {
    "device": { "id": "…", "label": "Airmonitor 01", "model": "BREATHE BTL40001", "status": "ok", "statusAt": "…" },
    "latest": { "measuredAt": "…", "co2Ppm": 504, "pm25Ugm3": 5, "batteryPct": 100, "…": "…" },
    "stale": false
  }
  ```

  A leitura usa camelCase, como o resto de `/api/v1`; o contrato de ingestão
  fica em snake_case.

  `stale` é verdadeiro quando a última amostra tem mais de **5 minutos**. Sala sem
  aparelho → `200` com `{ "device": null, "latest": null, "stale": true }`, para
  o popup não tratar isso como erro.

- **`GET /api/v1/spaces/:spaceId/air-quality/history?from=&to=&bucket=`** —
  `bucket=minute` (padrão) até 2 dias; `bucket=hour` até 90 dias, agregado em SQL
  com `strftime('%Y-%m-%dT%H:00:00Z', measured_at)` e média por métrica (máximo
  também para CO₂ e PM2.5). O cap segue o padrão do `getSpaceReport` e do plano
  010.

- **`GET /api/v1/air-quality/latest`** — última amostra de toda sala com aparelho,
  numa chamada, para colorir o modelo 3D por CO₂ no futuro. Fica para a fase 4.

As faixas de cor (bom/moderado/ruim) são do front e não do backend, e devem vir de
referência de qualidade do ar interno, não das cores da tela do aparelho.

**Decisão de interface (2026-11-03).** Três variantes de cada tela foram
prototipadas com dados reais; o protótipo completo e o veredito estão no branch
`prototype/air-quality-ui` do front (commit `59e9611`). Venceram:

- **Popup:** uma linha com o veredito (CO₂, temperatura e umidade) que expande
  para cada poluente posicionado na sua escala bom/moderado/ruim. A tendência de
  3 h ficou de fora porque exigiria abrir `…/history` a todos os papéis.
- **Relatório da sala:** um gráfico por métrica, cada um com seu eixo, e a linha
  colorida por gradiente de nível (verde na faixa aceitável, vermelho nos picos).

Descartados: o mapa dia × hora, que só cobre o horário de campus e esconde picos
noturnos, e o "tempo em cada faixa", que mostra 100 % bom com ar limpo e não diz
nada.

## Cadastro

Sem tela nova no piloto. `scripts/register-sensor.mjs`, no padrão de
`create-admin-direct.mjs`, gera `seed_sensor.sql` (gitignored) e imprime o token
**uma única vez**:

```bash
node scripts/register-sensor.mjs \
  --collector bancada-hermes \
  --device ebdaebfb3e5ed2f01crg1m --vendor tuya --model "BREATHE BTL40001" \
  --label "Airmonitor 01" [--space <space-id>]
wrangler d1 execute ufcim-db --remote --env production --file seed_sensor.sql
```

Revogar um coletor é `UPDATE sensor_collectors SET revoked_at = …`. Uma página
"Sensores" no admin shell (coletores, `last_seen_at`, estado de cada aparelho,
vínculo de sala) fica para a fase 4.

## O coletor (`collector/`)

Python 3.12, numa pasta própria da repo do backend, com `pyproject.toml` e
testes próprios. Ele não entra no build do Worker. Dependência de terceiro: só
`tinytuya`, que é a biblioteca local mais madura para os protocolos 3.4/3.5. O
HTTP usa a biblioteca padrão (`urllib.request`), e a fila usa `sqlite3`.

```text
collector/
  pyproject.toml
  Dockerfile
  compose.yaml
  config.example.toml
  .env.example                 # nomes das variáveis; o .env real é gitignored
  ufcim_collector/
    __main__.py                # laço principal e sinais
    config.py                  # TOML + variáveis de ambiente
    profiles.py                # mapa DP → métrica canônica, por modelo
    device.py                  # leitura de um aparelho via tinytuya
    sampler.py                 # agrega as leituras do minuto
    outbox.py                  # fila SQLite
    sender.py                  # envio em lote, backoff
  tests/
```

### Configuração

```toml
# config.toml
[server]
url = "https://ufcim-production.abner-hey.workers.dev"
token_env = "UFCIM_COLLECTOR_TOKEN"

[sampling]
poll_seconds = 15          # leitura do aparelho
sample_seconds = 60        # uma amostra por minuto
send_seconds = 60          # um lote por minuto
outbox_max_age_days = 7

[[devices]]
id = "ebdaebfb3e5ed2f01crg1m"
ip = "192.168.50.33"       # IP reservado no DHCP
protocol = "3.5"           # confirmar na bancada
profile = "breathe-btl40001"
local_key_env = "LOCAL_KEY_EBDAEBFB"
```

Segredos ficam só no `.env` do host (modo 600): o token do coletor e uma
*local key* por aparelho. Nenhum segredo vai para o TOML, para o log ou para a
repo.

### Perfil do aparelho

O perfil traduz DPs em métricas canônicas. O mapa abaixo vem do **modelo de
dados oficial** do aparelho (*Query Things Data Model* na Tuya Cloud API, lido em
2026-11-03; `product_id 68e4caqhuw9j530a`, `modelId e1kccaa4`, categoria
`co2bj`). Os IDs coincidem com os da issue
[tuya-local #3749](https://github.com/make-all/tuya-local/issues/3749), embora o
`product_id` lá seja outro (`od8rmbyzq2wbpgai`).

| DP | Código Tuya | Métrica | Tipo, faixa e escala | Conversão |
|---|---|---|---|---|
| 2 | `co2_value` | `co2_ppm` | int 0–5.000 ppm, escala 0 | direto |
| 20 | `pm25_value` | `pm25_ugm3` | int 0–1.000 µg/m³, escala 0 | direto |
| 101 | `pm10` | `pm10_ugm3` | int 0–1.000 µg/m³, escala 0 | direto |
| 102 | `pm25` | `pm1_ugm3` | int 0–1.000 µg/m³, escala 0 | direto. **O código diz `pm25`, mas o nome é PM1.0** |
| 21 | `voc_value` | `tvoc_mgm3` | int 0–9.999, escala 3, mg/m³ | ÷ 1000 |
| 22 | `ch2o_value` | `hcho_mgm3` | int 0–9.999, escala 3, mg/m³ | ÷ 1000 |
| 18 | `temp_current` | `temperature_c` | int −9–199, escala 0 | **°C inteiro**; se DP 31 = `f`, converter de °F |
| 19 | `humidity_value` | `humidity_pct` | int 0–100 %, escala 0 | direto |
| 15 | `battery_percentage` | `battery_pct` | int 0–100 %, escala 0 | direto |

DPs lidos mas não enviados como métrica:

| DP | Código | Uso no coletor |
|---|---|---|
| 31 | `temp_unit_convert` (`c`/`f`) | decide a conversão do DP 18 |
| 103 | `humidity_current` (0–100, sem unidade) | segundo canal de umidade; comparar com o DP 19 na bancada e descartar se for igual |
| 14 | `battery_state` (`normal`/`charge`) | log: aparelho fora da tomada |
| 1, 106 | `co2_state`, `pm25_state` (`alarm`/`normal`) | descartados: o alarme é do aparelho, não do UFCIM |
| 104 | `air_quality` (`great`…`severe`) | descartado: critério do fabricante, não publicado |

DPs de escrita (5, 6, 7, 13, 17, 26, 105, 107, 108, 109: alarme, brilho, repouso de
tela, limiares) **nunca são escritos pelo coletor**.

> **Limite de resolução:** a temperatura vem em grau inteiro. Serve para
> indicação de conforto, não para análise térmica fina. Na leitura de
> 2026-11-03 o aparelho marcava 33 °C em bancada; conferir se há aquecimento
> próprio ou sol antes de confiar no valor.

### Laço

1. A cada `poll_seconds`, lê `status()` de cada aparelho, com timeout de 5 s e
   conexão nova por leitura (conexão persistente fica como otimização).
2. Ao fechar o minuto, grava na fila uma amostra por aparelho com a **média** das
   leituras válidas do minuto. Sem nenhuma leitura válida, não há amostra; não se
   inventa valor.
3. A cada `send_seconds`, envia até 500 amostras mais antigas, mais o
   `device_status`, e apaga da fila o que recebeu 200.
4. Falha de envio: *backoff* exponencial de 5 s até 5 min, com jitter. A fila
   descarta o que passar de `outbox_max_age_days`, com log.

Estados de aparelho informados ao servidor:

| Estado | Quando |
|---|---|
| `ok` | a última leitura válida tem menos de 2 minutos |
| `unreachable` | timeout ou conexão recusada |
| `auth_failed` | erro de decodificação/sessão do tinytuya, típico de *local key* trocada |
| `bad_payload` | resposta sem os DPs do perfil |

Logs em JSON de uma linha no stdout, sem *local key* nem token.

### Implantação

```yaml
# compose.yaml
services:
  collector:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./config.toml:/app/config.toml:ro
      - collector-data:/data      # outbox.sqlite3 e heartbeat
    healthcheck:
      test: ["CMD", "python", "-m", "ufcim_collector.health"]   # heartbeat < 3 min
      interval: 60s
volumes:
  collector-data:
```

A rede *bridge* padrão do Docker alcança os IPs da LAN; não é preciso
`network_mode: host`. O coletor só abre conexões de saída: TCP 6668 para os
aparelhos e HTTPS 443 para o Worker.

| Ambiente | Host | Rede |
|---|---|---|
| Bancada | `hermes-vm` (192.168.50.30) | rede de casa, WPA2-Personal |
| Piloto UFC | Raspberry Pi na rede IoT da sala | SSID IoT dedicado (STI ou roteador próprio) |

O host precisa de NTP ativo: o carimbo de tempo da amostra é o relógio dele.

**Modo container: um aparelho, tudo por variáveis.** Sem `--config`, o coletor
lê só as variáveis `UFCIM_*` (`collector/.env.example`): servidor, token, ID, IP,
protocolo, perfil e *local key* do aparelho. É o formato do protótipo do IAUD. Um
`config.toml` continua aceito para vários aparelhos na mesma rede.

**Protótipo no homelab (desde 2026-11-03).** Roda no `docker-vm` (192.168.50.110,
Debian 13), na mesma LAN do aparelho, enviando ao Worker de produção, com o
aparelho vinculado à Sala 09 do Bloco 3:

| O quê | Onde |
|---|---|
| Código (cópia de `collector/`) | `/opt/ufcim-collector` |
| Stack (`compose.yaml` + `.env` modo 600) | `/mnt/stacks/ufcim-collector` |
| Fila e heartbeat | `/mnt/app-configs/ufcim-collector/data` (dono uid 10001) |
| Logs | stdout JSON → Alloy → Loki (`container="ufcim-collector"`) |

O container é endurecido como as outras stacks do host: `read_only`, `cap_drop:
ALL`, `no-new-privileges`, `init`. Para atualizar, copie de novo `collector/`
para `/opt/ufcim-collector`, sem `.env` nem `config.toml`, e rode
`docker compose up -d --build` na stack. Ao levar o aparelho para o IAUD, troque
`UFCIM_DEVICE_IP` (e o coletor de host, se a rede for outra) e vincule a sala real
com `register-sensor.mjs --space-model …`.

### Backfill pelo export do Smart Life

O app Smart Life ("Export Data") envia por e-mail um link para uma planilha
`.xlsx` com **médias de 15 minutos** no horário do aparelho (−03:00), com `#` nos
intervalos sem dado. `ufcim_collector.import_smartlife` converte as linhas em
amostras do contrato e as posta no mesmo endpoint, em lotes de 500:

```bash
pip install ".[import]"
python -m ufcim_collector.import_smartlife export.xlsx \
  --device ebdaebfb3e5ed2f01crg1m --config config.toml --env-file .env [--dry-run]
```

Só entra o que tem até 7 dias. Cada média de 15 minutos vira uma linha no início
do intervalo, então o histórico importado é mais esparso que o do coletor.

**Aparelho desligado.** Enquanto o aparelho está desligado, o Smart Life repete o
último valor, e à meia-noite reescreve esse valor arredondado. O importador
descarta sequências de 3 ou mais intervalos com as oito métricas idênticas: fica
só a primeira linha, que é a última leitura real, e uma sequência colada a outra
já descartada sai inteira (`--min-frozen-run`, `--dropped-out` lista o que saiu).
No primeiro export (2026-11-03), das 306 amostras de 31/10 13:15 a 03/11 17:30
UTC, 67 caíram nesse filtro: o aparelho ficou desligado em 01/11 18:00–18:30 e
de 02/11 17:00 a 03/11 08:45, no horário local.

## Falhas e o que acontece

| Falha | Efeito | Recuperação |
|---|---|---|
| Internet da sala cai | amostras acumulam na fila local | reenvio automático; idempotente pela PK |
| Worker ou D1 fora | idem | idem |
| Aparelho desligado ou fora do Wi-Fi | sem amostras; estado `unreachable`; popup mostra `stale` | automática quando voltar |
| Aparelho resetado ou trocado de conta | `auth_failed` | ler a *local key* nova na Tuya Developer Platform e atualizar o `.env` |
| IP do aparelho muda | `unreachable` | reservar o IP no DHCP (pré-requisito da instalação) |
| Relógio do host errado | backend rejeita as amostras com 4xx; o coletor descarta e registra | corrigir NTP |
| Token vazado | escrita só nos aparelhos daquele coletor | revogar e emitir outro token |
| Trial do IoT Core vence | nada: o coletor não usa a nuvem | só importa para ler uma *local key* nova |

## Testes

- **Worker (Vitest, padrão de `tests/unit/`):** autenticação do coletor (token
  válido, revogado, ausente); validação do corpo (lote acima de 500, minuto no
  futuro, valor fora de faixa vira `NULL`); idempotência (o mesmo lote duas vezes
  dá `duplicates`); aparelho de outro coletor recusado; `stale` na leitura; cap de
  intervalo do histórico.
- **Coletor (pytest):** perfil com payloads reais da bancada (fixtures); média do
  minuto ignorando leituras inválidas; fila sobrevivendo a reinício; envio com
  servidor falso devolvendo 200, 401, 422, 500 e timeout.
- **Bancada, antes do piloto:**
  - 24 h contínuas na `hermes-vm`, comparando as amostras com a tela do aparelho
    e com o log da Tuya;
  - cortar a internet do aparelho no roteador e confirmar que a leitura local
    continua, porque alguns firmwares Tuya param quando perdem a nuvem;
  - desligar o Worker de teste por 1 h e confirmar que a fila esvazia sem
    duplicar.

## Fases de entrega

| Fase | Entrega | Depende de |
|---|---|---|
| 0 | **Bancada:** pôr a *local key* no `.env` do host; script descartável com tinytuya lendo os DPs; fechar versão de protocolo e cadência; guardar payloads reais como fixtures | IP reservado no DHCP |
| 1 | **Backend de ingestão:** migração, middleware de coletor, `POST /ingest/v1/samples`, `register-sensor.mjs`, testes | — (pode correr junto da fase 0) |
| 2 | **Coletor:** pacote, perfil BTL40001, fila, envio, Docker, testes; rodar 24 h na `hermes-vm` contra o ambiente dev | fases 0 e 1 |
| 3 | **Leitura e front:** `GET …/air-quality` e `…/history`; bloco de qualidade do ar no `RoomPopup` com frescor e estado sem dados | fase 1 |
| 4 | **Operação:** página "Sensores" no admin shell; `GET /api/v1/air-quality/latest` | fase 3 |
| 5 | **Retenção:** agregado horário (`sensor_readings_hourly`) no cron noturno e limpeza da amostra bruta com mais de 90 dias, somada ao `runNightlyCleanup` | quando houver mais de ~10 aparelhos ou 6 meses de dados |

## Perguntas em aberto

- Versão real do protocolo local (3.4 ou 3.5). As escalas já estão fechadas pelo
  modelo de dados oficial.
- O DP 103 é só uma cópia do DP 19?
- O aparelho continua respondendo na LAN sem internet?
- O aparelho empurra atualizações sozinho numa conexão persistente, ou só
  responde a `status()`? Se empurrar, a leitura a cada 15 s pode virar escuta.
- Qual host fica na rede IoT da UFC, e quem o mantém?
- Conta Tuya do projeto ou a pessoal de Abner? Trocar depois exige reset e
  *local key* nova.
