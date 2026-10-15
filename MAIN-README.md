# Multi-domain Analytics System - Setup Guide

## Architecture

```
Project 1 (domain1.com) --\
Project 2 (domain2.com) ---> Analytics Engine dataset "site_activity" ---> Dashboard Worker (SQL API) ---> Aapne browser ma data
Project 3 (domain3.com) --/
```

Har project tracking event mokle che -> badhu ek j dataset ma jama thay -> dashboard e badha mathi SQL query kari ne batave.

## Project -> Domain hierarchy

Darek project na Worker ma `PROJECT_NAME` var aapelo raakhay (jem ke `project-a`).
Je ek project/Worker multiple custom domains serve kare to te badha domain
automatic aa j project niche group thay (1 project = N domain).
Dashboard ma project dropdown + domain filter thi manage kari shake.

## Setup order

1. `tracking-module/track.js` - darek existing project ma copy karo
2. `tracking-module/README.md` - setup steps (wrangler.toml binding, import, trackEvent calls)
3. `dashboard-worker/` - aa navo, alag project tarike deploy karo

## Dashboard deploy karva na steps

```bash
cd dashboard-worker
npx wrangler login
npx wrangler secret put DASHBOARD_PASSWORD      # dashboard kholva nu password
npx wrangler secret put CF_ACCOUNT_ID           # dash.cloudflare.com right sidebar ma male
npx wrangler secret put CF_API_TOKEN            # niche batavyu che kai rite banavvu
npx wrangler deploy
```

## CF_API_TOKEN kai rite banavvo

1. dash.cloudflare.com -> My Profile -> API Tokens -> Create Token
2. "Create Custom Token"
3. Permissions: **Account > Account Analytics > Read**
4. Account Resources: tamaru account select karo
5. Create -> token copy karo (ek j vaar dekhay che)

## Dashboard kholva mate

Deploy pachi malel URL (jem ke `analytics-dashboard.yourname.workers.dev`) kholo.
Browser login popup aavshe: username `admin`, password = je `DASHBOARD_PASSWORD` set karyu e.

Koi custom domain (jem ke `stats.yourdomain.com`) aapvu hoy to Worker na Triggers -> Custom Domain thi add kari shakay.

## Darek project ma tracking add karva

`tracking-module/README.md` ma full steps che. Short version:

1. `wrangler.toml` ma binding + `PROJECT_NAME` var add karo (dataset naam `site_activity`, badha project mate same)
2. `track.js` copy karo
3. Worker code ma `trackEvent(env, request, "page_view")` ane custom actions call karo

## Data dekhava mate ketlo time lage

Analytics Engine ma data likhya pachi dashboard ma dekhava mate sામાન્ય rite **1-5 minute** lage che.
