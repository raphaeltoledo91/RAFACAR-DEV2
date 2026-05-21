# TRACCAR DEV Final v5.1

Pacote revisado para substituir o frontend anterior em `/opt/traccar-pro-frontend`.

## O que foi corrigido

- Funções quebradas e indefinidas: `getVehicleImage`, `vehicleImage`, `hasVehicleImage`, `getVehiclePhoto`, `getVehicleName`, `getVehiclePlate`, `getVehicleUniqueId`, `alertText`, `latestAlertForDevice`, `kmh`, `safeCourse` e funções auxiliares.
- Proxy seguro no `server.js`: credenciais não ficam no React/browser.
- Suporte aos modos `token-session-cookie`, `session-cookie`, `basic`, `bearer` e `none`.
- Rate limit, Helmet, CSP, timeout, cache control e allowlist de endpoints.
- Build Vite/React, Docker, PM2 e auditoria pós-instalação.
- Layout responsivo com mapa, camadas, lista de veículos, alertas, comandos e atributos.

## Instalação rápida

```bash
sudo bash install-traccar-dev-final.sh
```

Depois ajuste:

```bash
sudo nano /opt/traccar-pro-frontend/data/config.local.json
sudo chmod 600 /opt/traccar-pro-frontend/data/config.local.json
sudo pm2 restart traccar-pro-frontend
```

## Configuração segura

O arquivo `/opt/traccar-pro-frontend/data/config.local.json` deve receber token ou usuário/senha. Exemplo recomendado:

```json
{
  "traccarUrl": "https://gps2.rafacarrastreadores.com.br",
  "port": 3000,
  "pollingMs": 30000,
  "authMode": "token-session-cookie",
  "user": "",
  "password": "",
  "token": "SEU_TOKEN_AQUI",
  "tokenHeader": "Authorization",
  "tokenPrefix": "Bearer ",
  "allowUnsafeGoogleTiles": true
}
```

## Testes no servidor

```bash
cd /opt/traccar-pro-frontend
npm run check:server
npm run build
curl -i http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3000/api/bootstrap | head -c 1000
pm2 logs traccar-pro-frontend --lines 100
```

## Railway

Para publicar o RAFACAR-DEV2 fora da VPS do Traccar, use Railway como Web Service Node/Express.

- Guia operacional: [`docs/RAILWAY_DEPLOY.md`](docs/RAILWAY_DEPLOY.md)
- Plano de evolucao: [`docs/LONG_TERM_PLAN.md`](docs/LONG_TERM_PLAN.md)
- Configuracao versionada: [`railway.toml`](railway.toml)

O Traccar continua rodando na VPS Oracle. A Railway hospeda apenas o frontend RAFACAR e o proxy Express que consome a API do Traccar.
