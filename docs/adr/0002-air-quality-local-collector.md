# ADR 0002 — Captura de qualidade do ar por coletor local

- **Status**: Proposto
- **Data**: 2026-11-03
- **Commit de referência**: `e2cbd1c`
- **Decisores**: Abner Augusto Souza (equipe UFCIM)
- **Especificação**: [`docs/AIR-QUALITY-COLLECTOR.md`](../AIR-QUALITY-COLLECTOR.md)

## Contexto

O UFCIM quer exibir a qualidade do ar das salas no popup do viewer 3D. O grupo do
IAUD comprou uma unidade do **BREATHE Airmonitor Plus** (modelo BTL40001) para o
piloto. Ele mede CO₂ por NDIR, PM1/PM2.5/PM10, TVOC, HCHO, temperatura e umidade.

O aparelho é um produto Tuya (módulo Wi-Fi CBU, categoria `co2bj`). Os dados
saem dele por dois caminhos:

1. **Nuvem Tuya.** O aparelho envia as oito métricas à nuvem a cada ~5 s. A Tuya
   Cloud API lê esses dados com as credenciais de um projeto na Tuya Developer
   Platform.
2. **Protocolo local Tuya** (TCP 6668, versão 3.4/3.5). Na LAN, o aparelho
   responde a quem tiver a *local key* dele, que é lida uma vez na nuvem.

Fatos observados que pesam na decisão:

- **O trial do IoT Core vence sem aviso.** O projeto Tuya da conta estava parado
  desde 2024-08-19; em 2026-11-03 toda chamada de API devolvia
  `28841002 — IoT Core service subscription has expired`. A renovação gratuita
  passa por análise da Tuya; o pedido foi aprovado no mesmo dia, com validade
  até 2027-02-03, e terá de ser repetido.
- **A rede da UFC é WPA2-Enterprise/eduroam.** O aparelho só conecta em
  2,4 GHz WPA2-Personal, sem portal cativo, então as salas vão ter uma rede IoT
  dedicada. Nessa rede, um host local consegue falar com o aparelho; o Worker,
  na Cloudflare, não.
- **O Worker não tem como abrir conexão com a LAN do campus**, e Cron Triggers
  não substituem um processo de longa duração.
- **O token de deploy não tem `Workers Scripts:Edit`.** `wrangler secret put`
  falha (ver `CLAUDE.md`), então um desenho que dependa de segredos novos no
  Worker fica travado.

## Decisão

Capturar as leituras com um **coletor próprio**: um serviço pequeno em Python, em
container, rodando num host da mesma rede do aparelho. Ele lê o aparelho pelo
protocolo local e envia amostras de 1 minuto ao backend por HTTPS, num endpoint
de ingestão dedicado e autenticado por token de coletor.

- O **contrato de ingestão** (`POST /ingest/v1/samples`) é o centro do desenho.
  Ele recebe métricas com nome semântico e unidade canônica, sem nada de Tuya.
  Qualquer fonte que fale esse contrato pode substituir o coletor: um poller da
  Tuya Cloud, uma automação do Home Assistant ou outro fabricante de sensor.
- O **conhecimento do aparelho** (mapa de DPs, escalas, versão de protocolo,
  *local key*) fica só no coletor.
- O **token do coletor** é gerado por script e guardado no D1 como hash SHA-256,
  no mesmo padrão de `scripts/create-admin-direct.mjs`. Não exige
  `wrangler secret put`.
- A **nuvem Tuya** é usada uma única vez por aparelho, para ler a *local key*.
  Depois disso o coletor não depende dela.

## Opções consideradas e rejeitadas

**Tuya Cloud API consultada por Cron Trigger no Worker.** É o caminho mais curto:
nenhum hardware na UFC além do sensor. Foi rejeitada como fonte principal porque
o trial do IoT Core venceu em silêncio no próprio projeto da conta, a cota do
plano gratuito é baixa e a captura passa a depender de um terceiro que exige
renovação periódica com análise. Fica como fonte alternativa: um poller pode
postar no mesmo contrato de ingestão se a rede IoT de alguma sala não comportar
um host local.

**Container do Home Assistant com automação.** Funciona com a integração Tuya
oficial (pela nuvem) ou com `tuya-local` (pela LAN), e uma `rest_command`
poderia postar no contrato de ingestão. É o **plano B**: traz uma plataforma
inteira (imagem grande, atualizações frequentes, configuração por UI) para fazer
uma tarefa só, e a lógica de captura fica fora do repositório do UFCIM.

**Regravar o módulo CBU com firmware aberto (OpenBeken/LibreTiny).** Dispensaria
a *local key* e a nuvem de vez. Foi rejeitada porque anula a garantia de um
aparelho comprado pela equipe e exigiria engenharia reversa da comunicação
TuyaMCU com a placa dos sensores.

**Broker MQTT no meio.** Desnecessário para um coletor que já empurra lotes por
HTTPS. Um Worker não mantém uma assinatura MQTT de longa duração, então o broker
exigiria mais uma ponte entre ele e o backend.

**Uma linha por métrica (modelo longo).** Mais flexível para sensores de outros
tipos, mas multiplica por oito o número de linhas no D1 e complica a consulta
"última leitura da sala". A matriz de métricas do UFCIM é fixa; uma linha por
amostra com colunas anuláveis atende. Uma métrica nova é uma migração de uma
coluna.

## Consequências

- Cada rede de sala precisa de um host do coletor (no piloto, um Raspberry Pi
  na rede IoT; na bancada, a `hermes-vm`). Um coletor atende vários aparelhos
  da mesma rede.
- O coletor só precisa de saída HTTPS. Nenhuma porta de entrada é aberta na
  rede da UFC.
- Resetar o aparelho ou trocá-lo de conta gera uma *local key* nova. O coletor
  passa a falhar autenticação e informa o estado `auth_failed`; a chave tem de
  ser lida de novo na Tuya Developer Platform.
- Uma leitura por minuto por aparelho gera ~1.440 linhas por dia. O piloto cabe
  folgado no D1; acima de ~10 salas, a retenção de 90 dias da amostra bruta e o
  agregado horário (fase 5 da especificação) passam a ser obrigatórios.
- O carimbo de tempo é do relógio do host do coletor. O host precisa de NTP, e o
  backend recusa amostras fora da janela aceitável.
