# Render provider verification runbook — 16 augustus 2026

Doel: bewijzen of de bestaande `render.yaml` securityheaders werkelijk door Render worden toegepast. Dit runbook wijzigt geen service, Blueprint, eventcontent of deployment.

## Routes

Canonical:
- `https://mijn-publieke-agenda-voor-district.onrender.com`

Mirrors:
- `https://mijn-agenda-district-antwerpen.onrender.com`
- `https://publieke-agenda-antwerpen.onrender.com`

## Verwachte headers op iedere gecontroleerde route

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

`Strict-Transport-Security` mag aanvullend door de provider worden geleverd maar vervangt geen van bovenstaande drie.

## Read-only HTTP-probe

Voor iedere host:

```bash
base="https://HOST"
curl -fsSIL "$base/"
curl -fsSIL "$base/robots.txt"
curl -fsSIL "$base/sitemap.xml"
```

Kies daarna één actuele gegenereerde event-ID uit `site/event/` op dezelfde gecontroleerde commit en controleer:

```bash
EVENT_ID="<source-verified-generated-id>"
curl -fsSIL "$base/event/$EVENT_ID/"
```

Stop bij DNS/TLS/netwerkfout en registreer `probe_unavailable`; interpreteer dat niet als `site_down`.

## Inhoudscontrole

Per host moeten minimaal deze objecten HTTP 200 geven:

1. `/`
2. `/event/<confirmed-id>/`
3. `/robots.txt`
4. `/sitemap.xml`

Vergelijk daarna hashes/bytes van publieke releasebestanden tussen canonical en mirrors waar de routes dezelfde release horen te serveren. Een providerheader mag verschillen; releasecontent niet zonder verklaring.

## Beslisregels

- `PASS_CONFIG_AND_LIVE`: alle drie vereiste headers staan op root en eventroute, basisroutes geven 200 en releasecontent is equivalent.
- `CONFIG_PRESENT_LIVE_MISSING`: repo-test groen maar één of meer headers ontbreken live; providerbinding/Blueprint-toepassing onderzoeken, géén duplicate headercode toevoegen.
- `CONTENT_DRIFT`: route is bereikbaar maar mirror/canonical content hoort niet bij dezelfde release; provider/deploymentbinding onderzoeken.
- `PROBE_UNAVAILABLE`: de controleomgeving kan de host niet bereiken; geen claim over live health.

## Provider-side actiegrens

Een redeploy, Blueprint refresh, servicebinding-wijziging, custom-domainwijziging of rollback is een afzonderlijke eigenaar-/provideractie. Dit runbook zelf voert die acties niet uit.
