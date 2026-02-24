# OpinIA Platform Blueprint
## De MVP a Plataforma Modular de Gestió de Reputació

---

# PART 1 — PRODUCT BLUEPRINT: CORE + MÒDULS

## Filosofia d'arquitectura

OpinIA no és una eina per "respondre ressenyes". És el centre de comandament de reputació d'un negoci. La diferència és important: una eina processa inputs; un centre de comandament entén el context, pren decisions, i millora amb el temps.

L'arquitectura és un CORE irreductible amb MÒDULS que s'activen per pla o per necessitat. Cada mòdul funciona de manera independent, però tots alimenten el mateix data lake de ressenyes i intel·ligència de marca.

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpinIA PLATFORM                          │
│                                                                 │
│  ┌─────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐ │
│  │  INBOX   │  │  AI ENGINE   │  │  PUBLISHING  │  │ INSIGHTS│ │
│  │ (Core)   │  │  (Core)      │  │  (Core)      │  │ (Mòdul) │ │
│  └────┬─────┘  └──────┬───────┘  └──────┬───────┘  └────┬────┘ │
│       │               │                 │                │      │
│  ┌────┴───────────────┴─────────────────┴────────────────┴────┐ │
│  │              UNIFIED DATA LAYER (Supabase)                 │ │
│  │  reviews · replies · brand_voice · kb_entries · analytics  │ │
│  └────┬───────────────┬─────────────────┬────────────────┬────┘ │
│       │               │                 │                │      │
│  ┌────┴─────┐  ┌──────┴───────┐  ┌─────┴──────┐  ┌─────┴────┐ │
│  │ GOOGLE   │  │  IMPORT      │  │  GROWTH    │  │  TEAM    │ │
│  │ CONNECT  │  │  ENGINE      │  │  (Mòdul)   │  │  (Mòdul) │ │
│  │ (Core)   │  │  (Core)      │  │  QR/Links  │  │  Roles   │ │
│  └──────────┘  └──────────────┘  └────────────┘  └──────────┘ │
└─────────────────────────────────────────────────────────────────┘
```


## CORE (sempre inclòs)

### C1 — Unified Inbox
La pantalla central. Totes les ressenyes de tots els canals arriben aquí, sense importar l'origen. Una ressenya de Google i una enganxada manualment es veuen iguals, es processen igual, viuen al mateix lloc.

Responsabilitats:
- Llistat cronològic de ressenyes amb filtres (font, rating, sentiment, idioma, estat)
- Indicadors visuals d'urgència (1-2★ sense resposta > 24h = vermell)
- Estat per ressenya: new → in_progress → replied → published
- Recompte d'operacions pendents ("7 ressenyes noves, 3 urgents")
- Vista de detall amb composer integrat

Per què és Core: sense Inbox no hi ha producte.


### C2 — AI Response Engine (Brand Voice + Business Memory)
El motor que fa que OpinIA sigui molt més que un wrapper de ChatGPT.

**Brand Voice:**
Cada negoci té un perfil de veu que s'injecta a cada generació:
- Formalitat (tu/vostè)
- To base (càlid, professional, sofisticat)
- Vocabulari preferit (paraules que SÍ usar, paraules que NO usar)
- Signatura
- Idioma principal + secundaris
- Instruccions específiques ("mai mencionar preu", "sempre convidar a tornar")

**Business Memory (Knowledge Base):**
Context que l'AI pot referenciar però mai inventar:
- FAQ: "Tenim pàrquing? Sí, gratuït per a hostes" → si un client es queixa del pàrquing, l'AI ho sap
- Snippets: frases aprovades per a situacions recurrents ("estem en obres fins a març")
- Temes sensibles: "no respondre sobre soroll d'obres, redirigir a contacte privat"

L'AI mai fabrica informació. Si no té un snippet per a un tema, dona una resposta genèrica i correcta. Si té un snippet, l'integra naturalment.

**Guardrails de generació:**
- Cada resposta passa per un check de coherència (no contradiu KB)
- Límit de longitud per canal (Google Reviews ≤ 4096 chars)
- Detecció d'informació inventada (hallucination check bàsic: si l'AI menciona un restaurant amb "terrassa" i no hi ha cap menció a KB, warning)
- Variació forçada: si les últimes 5 respostes comencen igual, reestructura

Per què és Core: la qualitat de resposta és el valor diferencial.


### C3 — Publishing Layer
El flux de publicació amb human-in-the-loop obligatori.

1. AI genera 3 opcions (proper / professional / premium)
2. Usuari selecciona una
3. Pot editar inline
4. Preview final
5. Publicar directament a Google (si connectat) O copiar al clipboard (per TripAdvisor, Booking, etc.)

Estat de replies: `draft → selected → edited? → approved → published/copied`

Per què és Core: el producte no acaba quan genera text; acaba quan el text arriba al client.


### C4 — Google Connect
L'única integració API real al llançament.

- OAuth amb Google Business Profile API
- Sync bidireccional: importar ressenyes + publicar respostes
- Sync incremental cada 15 min (configurable)
- Token refresh automàtic
- Un negoci = un Google Business Profile

Per què és Core: Google és el 80% del mercat de ressenyes a Europa.


### C5 — Import Engine
Per a tots els canals que no tenen API o on el cost d'integració no justifica MVP:

**Mètodes d'importació (tots desemboquen al mateix Inbox):**
- Manual: enganxar text + seleccionar font + rating
- Link parser: enganxar URL de ressenya (TripAdvisor, Booking, Yelp) → scraping lleuger de metadata
- CSV bulk: upload CSV amb columnes mapping

**Fonts suportades al launch:**
- TripAdvisor (import via paste/link)
- Booking.com (import via paste/link)
- Yelp (import via paste)
- TheFork (import via paste)
- Qualsevol altra (genèric)

Cada review importada rep `source = 'tripadvisor'|'booking'|'manual'|etc.` i un `external_id` si es pot extreure de l'URL per evitar duplicats.

Per què és Core: sense multicanal unificat, el producte és massa limitat.


## MÒDULS (activables per pla)

### M1 — Ops Intelligence (Analytics)
Dashboard d'intel·ligència operativa.

**Mètriques base:**
- Rating mitjà per període, font, idioma
- Volum de ressenyes per dia/setmana/mes
- Temps mitjà de resposta
- % de ressenyes contestades
- Sentiment trending (setmana actual vs anterior)

**Anàlisi temàtica (AI-powered):**
- Extracció automàtica de temes: "neteja", "soroll", "esmorzar", "personal", "preu"
- Tendència per tema: "queixes sobre soroll +40% aquest mes"
- Word cloud de termes positius/negatius
- Alertes configurables: "si rating mitjà < 3.5 durant 7 dies → notificació"

**Per vertical:**
- Hotels: correlació ocupació/rating, temes per temporada
- Restaurants: temes per servei (dinar/sopar), mencions de plats
- Botigues: temps d'atenció, producte específic

Gate: Starter+ (bàsic), Pro+ (anàlisi temàtica, alertes)


### M2 — Growth & QR
Generació proactiva de ressenyes.

- QR codes personalitzats per negoci → landing page "Deixa'ns la teva opinió"
- La landing redirigeix a Google Reviews directament (boost SEO)
- Short links personalitzats: opinia.cat/r/hotel-imperial
- Widget embeddable per a web del negoci
- Email template post-estada: "Com va anar la teva experiència?"
- Tracking: quants QR scans → quantes ressenyes generades

Gate: Pro+ (QR bàsic a Starter)


### M3 — Team & Workflow
Gestió d'equip per a negocis amb múltiples persones.

- Assignació de ressenyes a membres
- Regles automàtiques: "1-2★ → assignar a manager", "5★ → auto-approve draft"
- Historial d'activitat per review
- Approval chain: staff genera → manager aprova → owner publica
- Notificacions per correu/Slack

Gate: Pro+


### M4 — Multi-brand
Per a grups hostalers (H10, Meliá, etc.)

- Dashboard cross-business: veure totes les propietats en un lloc
- Comparativa entre negocis
- Brand voice compartida amb overrides per ubicació
- Templates de resposta compartits

Gate: Enterprise


## Plans de monetització

| | Free | Starter (19€/mo) | Pro (49€/mo) | Enterprise (custom) |
|---|---|---|---|---|
| Negocis | 1 | 3 | 10 | Il·limitat |
| Respostes IA/mes | 20 | 100 | 500 | Il·limitat |
| Google Connect | ✓ | ✓ | ✓ | ✓ |
| Import (paste/CSV) | ✓ | ✓ | ✓ | ✓ |
| Brand Voice bàsic | ✓ | ✓ | ✓ | ✓ |
| Business Memory (KB) | 5 entries | 50 | Il·limitat | Il·limitat |
| Publicació Google | — | ✓ | ✓ | ✓ |
| Analytics bàsic | — | ✓ | ✓ | ✓ |
| Analytics temàtic | — | — | ✓ | ✓ |
| Growth/QR | — | Bàsic | Complet | Complet |
| Team (membres) | 1 | 3 | 10 | Il·limitat |
| Workflow/approvals | — | — | ✓ | ✓ |
| Multi-brand dashboard | — | — | — | ✓ |
| API access | — | — | — | ✓ |
| Support | Community | Email | Prioritari | Dedicat |


---

# PART 2 — UX PANTALLA PER PANTALLA

## Principis de disseny

**Visual language:** Fons clars (slate-50/white), accent brand-600 (blau profund), grocs/àmbars per estrelles i urgència, verds per èxit, vermells per atenció. Tipografia DM Sans per headings (personalitat), IBM Plex Sans per body (llegibilitat). Mai més de 2 colors d'accent simultanis.

**Density:** Professional density. No és una app consumer amb espais enormes. Cada píxel ha de donar informació. Però sense ser claustrofòbic — ús generós de border-radius suaus, ombres subtils, i motion amb propòsit.

**Speed:** Skeleton screens, optimistic updates, zero full-page loads. Cada acció ha de sentir-se instantània.


## P1 — Landing Page (/)

```
┌─────────────────────────────────────────────────────┐
│ [Logo OpinIA]                [Demo] [Login] [CTA]   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  "Cada ressenya és una oportunitat.                 │
│   Respon com un professional."                       │
│                                                      │
│  ┌───────────────────────────────────────────┐      │
│  │ 🔗 Enganxa la web del teu negoci...       │ [✨] │
│  └───────────────────────────────────────────┘      │
│  "30 segons · sense targeta · prova 1 resposta"     │
│                                                      │
│  [Google]  [Correu]  [Apple]                         │
├─────────────────────────────────────────────────────┤
│  DEMO INTERACTIVA:                                   │
│  ┌─────────────┐                                     │
│  │ Joan M. ★★★★☆│ "Bona ubicació però soroll..."   │
│  └─────────────┘                                     │
│      ↓ AI genera ↓                                   │
│  [💛 Proper] [📋 Professional] [✨ Premium]          │
│  (cadascun amb resposta real, clicable, copiable)    │
├─────────────────────────────────────────────────────┤
│  COM FUNCIONA: 3 passos il·lustrats                  │
├─────────────────────────────────────────────────────┤
│  PER A QUI: Hotels · Restaurants · Botigues ·        │
│              Serveis · Apartaments                    │
│  (tab selector amb exemple de resposta per vertical) │
├─────────────────────────────────────────────────────┤
│  PREUS: Free / Starter / Pro / Enterprise            │
├─────────────────────────────────────────────────────┤
│  FOOTER: Legal · Blog · Contacte · Idiomes           │
└─────────────────────────────────────────────────────┘
```

**Interaccions clau:**
- La demo és interactiva: l'usuari pot canviar el rating i veure com canvien les respostes (crida real a l'API, 1 ús sense login)
- CTA input accepta qualsevol URL i redirigeix a onboarding amb la URL pre-carregada
- El selector de verticals mostra respostes d'exemple diferents per a cada sector


## P2 — Onboarding (/onboarding)

Flux en 3 passos. Progress bar a dalt. Cada pas visible, mai un formulari interminable.

```
STEP 1/3 — El teu negoci
┌─────────────────────────────────────────────────────┐
│ ● ○ ○   El teu negoci                              │
│                                                      │
│ URL: [________________________] [✨ Auto-detectar]  │
│                                                      │
│ ─── o completa manualment ───                        │
│                                                      │
│ Nom: [Hotel Imperial Tarraco     ]                   │
│ Tipus: [🏨 Hotel] [🍽️] [☕] [🛍️] [📍]             │
│ Ciutat: [Tarragona  ]  País: [ES ▾]                 │
│ Tags: [hospitalitat] [mediterrani] [x] [+afegir]    │
│                                                      │
│                              [Continuar →]           │
└─────────────────────────────────────────────────────┘

STEP 2/3 — La teva veu
┌─────────────────────────────────────────────────────┐
│ ○ ● ○   La teva veu de marca                       │
│                                                      │
│ Formalitat:  [👋 Tu]  [🤝 Vostè ✓]                 │
│ Idioma principal: [🇦🇩 Català ✓] [🇪🇸] [🇬🇧] [🇫🇷]   │
│ Signatura: [L'equip de l'Hotel Imperial Tarraco ]   │
│                                                      │
│ Instruccions per a l'IA (opcional):                  │
│ ┌───────────────────────────────────────────┐       │
│ │ Ex: "Mai mencionar preus. Sempre convidar │       │
│ │ a contactar directament per temes de      │       │
│ │ soroll o obres."                          │       │
│ └───────────────────────────────────────────┘       │
│                                                      │
│                   [← Enrere]  [Continuar →]          │
└─────────────────────────────────────────────────────┘

STEP 3/3 — Connecta ressenyes
┌─────────────────────────────────────────────────────┐
│ ○ ○ ●   Connecta les teves ressenyes                │
│                                                      │
│ ┌────────────────────────────────────────┐           │
│ │ 🔵 Google Business Profile             │           │
│ │ Sync automàtic cada 15 min             │           │
│ │ [Connectar Google →]                   │           │
│ └────────────────────────────────────────┘           │
│                                                      │
│ ┌────────────────────────────────────────┐           │
│ │ 📋 Importar d'altres plataformes       │           │
│ │ TripAdvisor · Booking · Yelp · Altres  │           │
│ │ [Importar ressenyes]                   │           │
│ └────────────────────────────────────────┘           │
│                                                      │
│ ┌────────────────────────────────────────┐           │
│ │ ✏️  O simplement enganxa una ressenya   │           │
│ │ [Anar directament al dashboard →]      │           │
│ └────────────────────────────────────────┘           │
│                                                      │
│             [← Enrere]  [Completar setup ✓]          │
└─────────────────────────────────────────────────────┘
```

**Clau:** l'onboarding NO bloqueja. L'usuari pot skip Google Connect i anar directament al dashboard amb entrada manual. Google Connect es pot fer després des de Settings.


## P3 — Inbox (/dashboard/inbox)

La pantalla principal. L'usuari viurà aquí el 80% del temps.

```
┌─────────────────────────────────────────────────────────────────┐
│ [Logo] [Hotel Imperial Tarraco ▾] ← biz switcher   [🔔] [👤]  │
│ ─── [✨ Inbox] [📊 Insights] [📈 Growth] [⚙️ Settings] ───── │
├────────────────────┬────────────────────────────────────────────┤
│ FILTERS            │ REVIEW LIST                                │
│                    │                                            │
│ Estat:             │ ┌──────────────────────────────────────┐   │
│ [● Noves (7)]      │ │ 🔴 ★☆☆☆☆  Maria G. · Google        │   │
│ [○ En curs (3)]    │ │ "El pitjor hotel on he estat..."     │   │
│ [○ Respostes (45)] │ │ fa 2h · ⚠️ urgent · 🌐 ES           │   │
│ [○ Publicades (89)]│ └──────────────────────────────────────┘   │
│                    │ ┌──────────────────────────────────────┐   │
│ Font:              │ │ 🟡 ★★★☆☆  Pere L. · TripAdvisor     │   │
│ [Google (120)]     │ │ "Correcte però res especial..."      │   │
│ [TripAdvisor (30)] │ │ fa 5h · 🌐 CA                        │   │
│ [Booking (15)]     │ └──────────────────────────────────────┘   │
│ [Manual (8)]       │ ┌──────────────────────────────────────┐   │
│                    │ │ 🟢 ★★★★★  John S. · Google           │   │
│ Rating:            │ │ "Amazing experience, the staff..."   │   │
│ [★★★★★ (45)]      │ │ fa 1d · 🌐 EN · ✓ resposta draft     │   │
│ [★★★★ (38)]       │ └──────────────────────────────────────┘   │
│ [★★★ (20)]        │                                            │
│ [★★ (8)]          │ ┌──────────────────────────────────────┐   │
│ [★ (7)]           │ │ 🟢 ★★★★☆  Anna M. · Booking          │   │
│                    │ │ "Ubicació perfecta, habitació..."    │   │
│ Idioma: [Tots ▾]   │ │ fa 2d · 🌐 CA · ✅ publicada         │   │
│ Període: [30d ▾]   │ └──────────────────────────────────────┘   │
│                    │                                            │
│ ──────────────     │               [Carregar més...]            │
│ QUICK STATS        │                                            │
│ Rating mitjà: 4.2  │                                            │
│ Sense resposta: 10 │                                            │
│ Temps resp: 3.2h   │                                            │
└────────────────────┴────────────────────────────────────────────┘
```

**Interaccions clau:**
- Clicar una ressenya obre el Review Detail/Composer (slide-over o pàgina)
- Badge de color per urgència: 1-2★ sense resposta > 24h = vermell palpitant
- Filtre per font amb comptadors
- Quick stats al sidebar baix: mètriques instantànies
- Botó flotant "+" per afegir ressenya manual o importar
- Bulk actions: seleccionar múltiples → "Generar respostes" en batch

## P4 — Review Detail + Response Composer (/dashboard/inbox/[reviewId])

Slide-over des de l'Inbox o pàgina completa. Dues columnes:

```
┌──────────────────────────┬───────────────────────────────────────┐
│ RESSENYA ORIGINAL        │ RESPONSE COMPOSER                     │
│                          │                                       │
│ ★★★★☆  4/5              │ ┌───────────────────────────────────┐ │
│ Maria García             │ │ [💛 Proper] [📋 Pro ✓] [✨ Prem] │ │
│ Google · fa 3 hores      │ └───────────────────────────────────┘ │
│ 🌐 Espanyol              │                                       │
│                          │ Gràcies per la seva valoració. Ens    │
│ "Buena ubicación y       │ alegra saber que ha gaudit de la      │
│ habitación limpia. El    │ ubicació i la neteja. Prenem nota     │
│ personal muy amable.     │ del tema del soroll nocturn i estem   │
│ Pero por la noche había  │ implementant mesures d'aïllament...   │
│ mucho ruido de la calle  │                                       │
│ y no pudimos descansar   │ [Resposta editable inline]            │
│ bien."                   │                                       │
│                          │ ─────────────────────────────────     │
│ ──────────────────────── │ 📝 KB Match: "Tenim habitacions      │
│ AI ANALYSIS              │ interiors disponibles" (snippet #3)   │
│ Sentiment: Positiu-mixt  │                                       │
│ Temes: ubicació✓ neteja✓ │ 💡 Suggeriment: mencionar habitació  │
│         soroll✗ personal✓│ interior com a alternativa             │
│ Idioma: ES (resp. en ES) │                                       │
│                          │ ─────────────────────────────────     │
│ ──────────────────────── │ ⚠️ SAFETY CHECK                       │
│ HISTORIAL AUTOR          │ ✓ No info inventada                   │
│ (si Google: altres       │ ✓ Longitud OK (189 chars)             │
│ ressenyes d'aquest       │ ✓ To consistent amb Brand Voice       │
│ autor, si disponible)    │ ✓ No repetició vs últimes respostes   │
│                          │                                       │
│                          │ ┌───────────────────────────────────┐ │
│                          │ │ [🔄 Regenerar] [📋 Copiar]       │ │
│                          │ │            [Publicar a Google →]  │ │
│                          │ └───────────────────────────────────┘ │
└──────────────────────────┴───────────────────────────────────────┘
```

**Interaccions clau:**
- Tabs per canviar entre els 3 tons sense perdre edicions
- KB match: si la ressenya toca un tema que existeix al Knowledge Base, es mostra com a suggeriment (no s'injecta automàticament, l'usuari decideix)
- Safety check visible: l'usuari veu que la resposta ha passat validació
- "Regenerar" genera noves opcions (compta contra el límit mensual)
- "Publicar a Google" només si la integració està activa; sinó, "Copiar al clipboard"
- Resposta s'adapta a l'idioma de la ressenya automàticament


## P5 — Insights (/dashboard/insights) [Mòdul M1]

```
┌─────────────────────────────────────────────────────────────────┐
│ OVERVIEW                                    Període: [30d ▾]    │
│                                                                  │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐ │
│ │ ★ 4.2   │ │ 📝 47   │ │ ✅ 89%  │ │ ⏱️ 2.3h  │ │ 📈 +0.3  │ │
│ │ Rating  │ │ Noves   │ │ Resp.%  │ │ T. resp  │ │ vs prev  │ │
│ └─────────┘ └─────────┘ └─────────┘ └──────────┘ └──────────┘ │
│                                                                  │
│ ┌────────────────────────────┐ ┌────────────────────────────┐   │
│ │ RATING OVER TIME           │ │ VOLUME PER FONT            │   │
│ │ [line chart: 30 dies]      │ │ [stacked bar: Google 67%,  │   │
│ │                            │ │  TA 20%, Booking 8%,       │   │
│ │                            │ │  Manual 5%]                │   │
│ └────────────────────────────┘ └────────────────────────────┘   │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ANÀLISI TEMÀTICA (AI)                                      │  │
│ │                                                            │  │
│ │ 😊 Positiu          │ 😞 Negatiu                          │  │
│ │ ████████ Personal (34)│ ████ Soroll (12)                   │  │
│ │ ██████ Ubicació (28)  │ ███ Preu (8)                       │  │
│ │ █████ Neteja (22)     │ ██ Esmorzar (5)                    │  │
│ │ ████ Esmorzar (18)    │ █ Wifi (3)                         │  │
│ │                                                            │  │
│ │ ⚠️ ALERTA: "soroll" ha pujat +40% vs mes anterior          │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ SENTIMENT PER IDIOMA                                       │  │
│ │ 🇪🇸 ES: ★4.1 (60% ressenyes) │ 🇬🇧 EN: ★4.4 (25%)         │  │
│ │ 🇦🇩 CA: ★4.3 (10%)           │ 🇫🇷 FR: ★3.8 (5%) ⚠️       │  │
│ └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## P6 — Growth (/dashboard/growth) [Mòdul M2]

```
┌─────────────────────────────────────────────────────────────────┐
│ QR & REVIEW LINKS                                               │
│                                                                  │
│ ┌─────────────────┐  El teu link de ressenyes:                  │
│ │                 │  opinia.cat/r/hotel-imperial                 │
│ │   [QR CODE]     │  → Redirigeix a Google Reviews              │
│ │                 │                                              │
│ │                 │  [📋 Copiar link] [⬇️ Descarregar QR]       │
│ └─────────────────┘  [🎨 Personalitzar disseny QR]              │
│                                                                  │
│ ──────────────────────────────────────────────────────────────  │
│                                                                  │
│ RENDIMENT                                                        │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                            │
│ │ 📱 234  │ │ ★ 45    │ │ 📊 19%  │                            │
│ │ Scans   │ │ Reviews │ │ Conv.%  │                            │
│ └─────────┘ └─────────┘ └─────────┘                            │
│                                                                  │
│ EMAIL TEMPLATE (Pro)                                             │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ "Hola {nom}, gràcies per allotjar-te amb nosaltres.       │  │
│ │  Ens encantaria conèixer la teva opinió..."               │  │
│ │ [Personalitzar] [Copiar HTML]                             │  │
│ └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```


## P7 — Settings (/dashboard/settings)

Tabs: Negoci · Veu IA · Integracions · Equip · Pla

```
TAB: Veu IA & Memòria
┌─────────────────────────────────────────────────────────────────┐
│ BRAND VOICE                                                      │
│                                                                  │
│ Formalitat: [Tu] [Vostè ✓]                                     │
│ Idiomes: [🇦🇩 CA ✓] [🇪🇸 ES ✓] [🇬🇧 EN ✓] [🇫🇷 FR] [🇮🇹 IT] [🇵🇹 PT]│
│ Signatura: [L'equip de l'Hotel Imperial Tarraco        ]       │
│                                                                  │
│ Instruccions IA:                                                 │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ - Sempre convidar a tornar                                 │  │
│ │ - Mai mencionar preus ni ofertes                           │  │
│ │ - Per queixes de soroll, mencionar habitacions interiors   │  │
│ │ - To elegant però no distant                               │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ KNOWLEDGE BASE (Business Memory)                                 │
│                                                                  │
│ ┌──────────┬─────────────────────────────────┬────────────────┐ │
│ │ Tema     │ Contingut                        │ Accions       │ │
│ ├──────────┼─────────────────────────────────┼────────────────┤ │
│ │ Pàrquing │ Gratuït per a hostes. Entrada   │ [✏️] [🗑️]     │ │
│ │          │ per Av. Catalunya.               │               │ │
│ ├──────────┼─────────────────────────────────┼────────────────┤ │
│ │ Obres    │ Renovació façana fins març 2026.│ [✏️] [🗑️]     │ │
│ │          │ Redirigir a recepció.            │               │ │
│ ├──────────┼─────────────────────────────────┼────────────────┤ │
│ │ Check-in │ Disponible des de les 14h.      │ [✏️] [🗑️]     │ │
│ │          │ Early check-in subjecte a       │               │ │
│ │          │ disponibilitat.                 │               │ │
│ └──────────┴─────────────────────────────────┴────────────────┘ │
│                                                                  │
│ [+ Afegir entrada]                                               │
└─────────────────────────────────────────────────────────────────┘
```

## P8 — Team (/dashboard/settings/team) [Mòdul M3]

```
┌─────────────────────────────────────────────────────────────────┐
│ EQUIP — Hotel Imperial Tarraco                                   │
│                                                                  │
│ ┌───────┬────────────────────┬──────────┬───────────┬────────┐  │
│ │       │ Nom                │ Rol      │ Estat     │        │  │
│ ├───────┼────────────────────┼──────────┼───────────┼────────┤  │
│ │ [SG]  │ Sergi G.           │ Owner ▾  │ ✅ Actiu  │ ...    │  │
│ │ [JM]  │ Joan (F&B Manager) │ Manager ▾│ ✅ Actiu  │ ...    │  │
│ │ [AL]  │ anna@hotel.com     │ Staff ▾  │ ⏳ Invitat│ ...    │  │
│ └───────┴────────────────────┴──────────┴───────────┴────────┘  │
│                                                                  │
│ [+ Convidar membre]                                              │
│                                                                  │
│ PERMISOS                                                         │
│ Owner: tot · Manager: gestionar ressenyes i publicar ·           │
│ Staff: generar respostes (no publicar)                           │
└─────────────────────────────────────────────────────────────────┘
```


---

# PART 3 — ESQUEMA DE DADES

## Noves taules (extensió de schema-v2)

El schema-v2 ja conté: organizations, profiles, memberships, businesses, integrations, reviews, replies, sync_log.

Afegim les taules necessàries per a Brand Voice, Knowledge Base, i Analytics:

```sql
-- ============================================================
-- OpinIA Platform — Schema Extensions (additive to v2)
-- Run AFTER schema-v2.sql
-- ============================================================

-- NEW TYPES
create type public.kb_entry_type as enum ('faq','snippet','policy','sensitive');

-- ============================================================
-- Brand Voice Config (per business, extends businesses table)
-- ============================================================
-- No cal taula nova: ja tenim businesses.ai_instructions, .formality, .tags, etc.
-- Però afegim camps nous a businesses:

alter table public.businesses
  add column if not exists tone_keywords_positive text[] not null default array[]::text[],
  add column if not exists tone_keywords_negative text[] not null default array[]::text[],
  add column if not exists supported_languages    text[] not null default array['ca','es','en']::text[],
  add column if not exists response_max_length    integer not null default 1500,
  add column if not exists auto_publish_enabled   boolean not null default false,
  add column if not exists auto_publish_min_rating integer default 4;

comment on column public.businesses.tone_keywords_positive is 'Words/phrases to actively use in responses.';
comment on column public.businesses.tone_keywords_negative is 'Words/phrases to never use in responses.';
comment on column public.businesses.auto_publish_enabled is 'If true + rating >= auto_publish_min_rating, skip approval.';


-- ============================================================
-- Knowledge Base (Business Memory)
-- ============================================================
create table if not exists public.kb_entries (
  id          uuid primary key default uuid_generate_v4(),
  biz_id      uuid not null references public.businesses(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  type        public.kb_entry_type not null default 'faq',
  topic       text not null,                          -- "parking", "check-in", "pool hours"
  content     text not null,                          -- the actual knowledge
  language    text not null default 'ca',
  is_active   boolean not null default true,
  priority    integer not null default 0,             -- higher = more likely to be injected
  used_count  integer not null default 0,             -- how often AI has referenced this
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table  public.kb_entries is 'Facts the AI can reference. Never fabricates beyond this.';
comment on column public.kb_entries.type is 'faq=factual answer, snippet=approved phrase, policy=business rule, sensitive=redirect topic.';
comment on column public.kb_entries.priority is 'Higher priority entries are surfaced first when relevant.';

create index idx_kb_entries_biz    on public.kb_entries(biz_id);
create index idx_kb_entries_org    on public.kb_entries(org_id);
create index idx_kb_entries_topic  on public.kb_entries(biz_id, topic);
create index idx_kb_entries_active on public.kb_entries(biz_id) where is_active = true;


-- ============================================================
-- Review Topics (AI-extracted themes per review)
-- ============================================================
create table if not exists public.review_topics (
  id          uuid primary key default uuid_generate_v4(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  biz_id      uuid not null references public.businesses(id) on delete cascade,
  topic       text not null,                          -- "cleanliness", "noise", "breakfast"
  sentiment   public.sentiment not null,              -- per-topic sentiment
  confidence  real not null default 0.8,
  created_at  timestamptz not null default now()
);

comment on table public.review_topics is 'AI-extracted themes from reviews for Insights module.';

create index idx_review_topics_review on public.review_topics(review_id);
create index idx_review_topics_biz    on public.review_topics(biz_id, topic);


-- ============================================================
-- Activity Log (team audit trail)
-- ============================================================
create table if not exists public.activity_log (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  biz_id      uuid references public.businesses(id) on delete set null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  action      text not null,                          -- 'reply.generated', 'reply.published', 'review.imported', etc.
  target_type text,                                   -- 'review', 'reply', 'business', 'integration'
  target_id   uuid,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index idx_activity_org    on public.activity_log(org_id, created_at desc);
create index idx_activity_biz    on public.activity_log(biz_id, created_at desc);
create index idx_activity_user   on public.activity_log(user_id, created_at desc);


-- ============================================================
-- Growth Links (QR/short links tracking)
-- ============================================================
create table if not exists public.growth_links (
  id          uuid primary key default uuid_generate_v4(),
  biz_id      uuid not null references public.businesses(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  slug        text not null unique,                   -- "hotel-imperial" → opinia.cat/r/hotel-imperial
  target_url  text not null,                          -- Google Reviews URL
  qr_style    jsonb default '{}'::jsonb,              -- colors, logo, etc.
  scan_count  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_growth_links_biz  on public.growth_links(biz_id);
create index idx_growth_links_slug on public.growth_links(slug);


-- ============================================================
-- Usage Tracking (for plan limits)
-- ============================================================
create table if not exists public.usage_monthly (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  month           date not null,                      -- first day of month: '2026-02-01'
  ai_generations  integer not null default 0,
  reviews_synced  integer not null default 0,
  reviews_imported integer not null default 0,
  unique (org_id, month)
);

create index idx_usage_org_month on public.usage_monthly(org_id, month desc);


-- ============================================================
-- RLS for new tables
-- ============================================================
alter table public.kb_entries     enable row level security;
alter table public.review_topics  enable row level security;
alter table public.activity_log   enable row level security;
alter table public.growth_links   enable row level security;
alter table public.usage_monthly  enable row level security;

-- KB Entries: org members can read; owner/manager can write
create policy "kb_select" on public.kb_entries
  for select using (org_id in (select public.user_org_ids()));
create policy "kb_insert" on public.kb_entries
  for insert with check (org_id in (select public.user_org_ids()));
create policy "kb_update" on public.kb_entries
  for update using (org_id in (select public.user_org_ids()));
create policy "kb_delete" on public.kb_entries
  for delete using (org_id in (select public.user_org_ids()));

-- Review Topics: read-only for org members (AI writes via service role)
create policy "topics_select" on public.review_topics
  for select using (
    biz_id in (select public.user_biz_ids())
  );

-- Activity Log: read-only for org members
create policy "activity_select" on public.activity_log
  for select using (org_id in (select public.user_org_ids()));
create policy "activity_insert" on public.activity_log
  for insert with check (org_id in (select public.user_org_ids()));

-- Growth Links: org members can manage
create policy "growth_select" on public.growth_links
  for select using (org_id in (select public.user_org_ids()));
create policy "growth_insert" on public.growth_links
  for insert with check (org_id in (select public.user_org_ids()));
create policy "growth_update" on public.growth_links
  for update using (org_id in (select public.user_org_ids()));

-- Usage: read-only for org members
create policy "usage_select" on public.usage_monthly
  for select using (org_id in (select public.user_org_ids()));

-- Updated_at triggers for new tables
create trigger trg_kb_entries_updated_at before update on public.kb_entries
  for each row execute function public.trg_set_updated_at();
create trigger trg_growth_links_updated_at before update on public.growth_links
  for each row execute function public.trg_set_updated_at();
```

### Data model complet (visual)

```
auth.users
  └── profiles (1:1)
  └── memberships (M:N with role)
        └── organizations (billing, plan limits)
              ├── usage_monthly (metering)
              └── businesses (locations)
                    ├── businesses.tone_* (brand voice inline)
                    ├── kb_entries (business memory)
                    ├── integrations (Google OAuth)
                    │     └── sync_log (audit)
                    ├── reviews (all sources unified)
                    │     ├── replies (3 per review, lifecycle)
                    │     └── review_topics (AI-extracted themes)
                    ├── growth_links (QR/short URLs)
                    └── activity_log (team audit)
```


---

# PART 4 — API ROUTES (Next.js App Router)

## Estructura de carpetes

```
src/app/api/
├── auth/
│   └── callback/route.ts                    GET  — OAuth callback
│
├── me/route.ts                              GET  — profile + memberships + active org
│                                            PATCH — update profile
│
├── orgs/
│   ├── route.ts                             GET  — list orgs
│   │                                        POST — create org
│   └── [orgId]/
│       ├── route.ts                         PATCH — update org
│       ├── members/
│       │   ├── route.ts                     GET  — list members
│       │   ├── invite/route.ts              POST — send invite
│       │   └── [memberId]/route.ts          PATCH/DELETE — role/remove
│       └── usage/route.ts                   GET  — current month usage
│
├── businesses/
│   ├── route.ts                             POST — create business
│   ├── detect/route.ts                      POST — AI profile detection from URL
│   └── [bizId]/
│       ├── route.ts                         GET/PATCH/DELETE
│       ├── brand-voice/route.ts             GET/PATCH — voice settings
│       ├── kb/
│       │   ├── route.ts                     GET/POST — list/create KB entries
│       │   └── [entryId]/route.ts           PATCH/DELETE
│       ├── integrations/
│       │   ├── route.ts                     GET — list integrations
│       │   ├── google/
│       │   │   ├── connect/route.ts         POST — start OAuth
│       │   │   └── callback/route.ts        GET  — OAuth callback
│       │   └── [integrationId]/
│       │       ├── route.ts                 DELETE — disconnect
│       │       └── sync/route.ts            POST — manual sync trigger
│       ├── reviews/
│       │   ├── route.ts                     GET  — list (paginated, filterable)
│       │   │                                POST — manual import
│       │   ├── import/route.ts              POST — bulk CSV import
│       │   ├── import-link/route.ts         POST — import from URL (scrape)
│       │   └── [reviewId]/
│       │       ├── route.ts                 GET/PATCH/DELETE
│       │       └── generate/route.ts        POST — generate AI replies
│       ├── insights/
│       │   ├── overview/route.ts            GET — dashboard metrics
│       │   ├── topics/route.ts              GET — topic analysis
│       │   └── trends/route.ts              GET — time series
│       └── growth/
│           ├── link/route.ts                GET/POST — manage growth link
│           └── stats/route.ts               GET — scan/conversion stats
│
├── replies/
│   └── [replyId]/
│       ├── route.ts                         PATCH — edit content
│       ├── select/route.ts                  POST — mark as selected
│       └── publish/route.ts                 POST — publish to Google / mark copied
│
├── sync/
│   └── run/route.ts                         POST — cron endpoint (all due integrations)
│
└── r/
    └── [slug]/route.ts                      GET — growth link redirect + tracking
```


## Detall dels endpoints crítics

### POST /api/businesses/[bizId]/reviews/[reviewId]/generate

```typescript
// 1. Load context
const review = await getReview(reviewId);
const business = await getBusiness(bizId);
const kbEntries = await getActiveKBEntries(bizId);

// 2. Check plan limits
const usage = await getMonthlyUsage(business.org_id);
const org = await getOrg(business.org_id);
if (usage.ai_generations >= org.max_reviews_mo) {
  return Response.json({ error: 'limit_reached', upgrade: true }, { status: 403 });
}

// 3. Find relevant KB entries (semantic match on review text)
const relevantKB = matchKBToReview(review.review_text, kbEntries);

// 4. Build prompt with full context
const prompt = buildPrompt({
  review,
  business,            // name, type, formality, signature, ai_instructions
  relevantKB,          // matched FAQ/snippets
  toneKeywords: {
    positive: business.tone_keywords_positive,
    negative: business.tone_keywords_negative,
  },
  recentReplies: await getRecentReplies(bizId, 5),  // for variation check
});

// 5. Call AI (OpenAI / Anthropic)
const responses = await generateResponses(prompt);

// 6. Safety checks
const validated = await validateResponses(responses, {
  maxLength: business.response_max_length,
  kbEntries: relevantKB,
  recentReplies,
  business,
});

// 7. Extract topics for Insights
const topics = await extractTopics(review.review_text);
await saveReviewTopics(reviewId, bizId, topics);

// 8. Save replies + increment usage
await saveReplies(reviewId, bizId, business.org_id, validated);
await incrementUsage(business.org_id, 'ai_generations');

// 9. Log activity
await logActivity(business.org_id, bizId, userId, 'reply.generated', 'review', reviewId);

return Response.json(validated);
```

### POST /api/replies/[replyId]/publish

```typescript
// 1. Load reply + review + integration
const reply = await getReply(replyId);
const review = await getReview(reply.review_id);
const integration = await getIntegration(reply.biz_id, 'google_business');

// 2. Permission check (owner/manager only for publishing)
const membership = await getMembership(userId, reply.org_id);
if (membership.role === 'staff') {
  return Response.json({ error: 'insufficient_permissions' }, { status: 403 });
}

// 3. Publish to Google if applicable
let publishedExternally = false;
if (integration && review.source === 'google' && review.external_id) {
  try {
    await publishGoogleReply(integration, review.external_id, reply.content);
    publishedExternally = true;
  } catch (err) {
    // Don't fail the whole operation, mark as copy-only
    await logActivity(reply.org_id, reply.biz_id, userId, 'reply.publish_failed', 'reply', replyId, { error: err.message });
  }
}

// 4. Update statuses
await updateReply(replyId, {
  status: 'published',
  published_at: new Date(),
  published_by: userId,
});
await archiveOtherReplies(reply.review_id, replyId);
await updateReview(reply.review_id, { is_replied: true });

// 5. Log
await logActivity(reply.org_id, reply.biz_id, userId, 'reply.published', 'reply', replyId, {
  published_to_google: publishedExternally,
});
```


---

# PART 5 — ROADMAP INTERN

## Principi: "Complete Experience, Narrow Scope"
Cada fase entrega una experiència completa per a un segment, no una experiència incompleta per a tothom.


### FASE 1 — Foundation (setmanes 1-4)
**Objectiu: "Puc respondre a totes les meves ressenyes professionalment"**

Construir:
- Auth (Google login + email)
- Onboarding (3 passos)
- Business creation amb brand voice bàsic
- Inbox amb entrada manual (paste review + rating)
- AI response generation (3 tons, amb rating-guidance)
- Copy to clipboard
- Historial bàsic

NO construir: Google Connect, Analytics, Growth, Team, KB

Raonament: l'usuari ja pot usar el producte immediatament enganxant ressenyes manualment. El valor és la qualitat de la resposta, no la font.


### FASE 2 — Memory (setmanes 5-6)
**Objectiu: "Les respostes ja semblen del meu negoci, no genèriques"**

Construir:
- Knowledge Base (CRUD de kb_entries)
- KB matching en generació (injecció de context rellevant)
- Instruccions IA personalitzades (ai_instructions)
- Paraules positives/negatives (tone_keywords)

Raonament: el salt de qualitat entre "resposta genèrica" i "resposta que sona com el meu hotel" és el moment WOW. Això fidelitza.


### FASE 3 — Google Connect (setmanes 7-10)
**Objectiu: "Les ressenyes arriben soles i puc publicar des d'aquí"**

Construir:
- Google OAuth flow complet
- Review sync (incremental, amb dedup)
- Publish reply to Google
- Auto-refresh de tokens
- Sync log per debugging

Raonament: Google és l'únic canal que justifica integració real. Un cop connectat, l'Inbox deixa de ser manual i l'app es converteix en imprescindible.


### FASE 4 — Import Engine (setmanes 11-12)
**Objectiu: "Veig TOTES les meves ressenyes en un lloc"**

Construir:
- Import manual millorat (selector de font)
- Import per URL (TripAdvisor, Booking) — scraping bàsic de metadata
- Import CSV bulk
- Deduplicació per external_id quan possible

Raonament: multicanal unificat sense el cost de múltiples integracions API.


### FASE 5 — Insights (setmanes 13-16)
**Objectiu: "Entenc què diuen els meus clients i cap a on va la tendència"**

Construir:
- Dashboard de mètriques (rating, volum, temps resposta)
- Topic extraction (AI) en cada review
- Anàlisi temàtica amb tendències
- Alertes bàsiques (rating baix sostingut)

Raonament: un cop hi ha prou dades (100+ reviews), l'analytics justifica upgrade a Starter/Pro.


### FASE 6 — Growth + Team (setmanes 17-20)
**Objectiu: "Creixem en ressenyes i l'equip col·labora"**

Construir:
- QR/short links amb tracking
- Team invitations + rols
- Approval workflow (staff genera → manager/owner aprova)
- Activity log

Raonament: funcionalitats de monetització. Growth i Team són els triggers per passar a plans de pagament.


### FASE 7 — Polish & Scale (setmanes 21+)
- Auto-publish per ressenyes positives (amb guardrails)
- Multi-business dashboard (comparativa)
- Email templates per Growth
- Integració Slack per notificacions
- API pública per Enterprise
- Widget embeddable


---

# PART 6 — GUARDRAILS ANTI-DETECCIÓ GOOGLE

Google penalitza comptes que fan servir bots per publicar respostes. Aquests guardrails són no-negociables:

## G1 — Human-in-the-Loop (obligatori)
Mai auto-publicar sense intervenció humana per defecte. L'usuari SEMPRE veu la resposta abans de publicar. L'opció d'auto-publish (Fase 7) requereix:
- Rating mínim configurable (default 4★)
- Revisió manual de les primeres 20 respostes auto-publicades
- Kill switch instantani

## G2 — Variació de contingut
- Mai dues respostes consecutives amb la mateixa estructura
- Pool de 15+ templates d'inici ("Gràcies per...", "Ens alegra...", "Agraïm molt...", "Quin plaer...", etc.)
- Rotació forçada: si les últimes 3 comencen amb "Gràcies", la següent no pot
- Variació de longitud: ±30% entre respostes del mateix to
- Mai copiar frases textuals entre respostes

## G3 — Rate Limiting de publicació
- Màxim 5 publicacions/hora per business a Google
- Delay aleatori entre publicacions: 30s-5min
- Distribució temporal natural: no publicar 20 respostes a les 3am
- Cap publicació en les primeres 24h d'activar Google Connect (cool-down)

## G4 — Naturalitat
- Les respostes no han de contenir patrons detectables de bot:
  - No repetir el nom de l'autor exactament com surt a Google
  - No usar estructures de template obvies ("Dear [name], Thank you for your [rating] star review")
  - Variació de signatura: a vegades amb signatura, a vegades sense
  - Errors ortogràfics intencionals? NO — però sí variació en puntuació i estil

## G5 — Timing
- Respondre massa ràpid (< 1 min) a una ressenya nova és sospitós
- Delay mínim recomanat: 30 min des de la recepció
- Distribució natural: horari laboral del negoci (9-21h), mai de matinada
- Randomització del delay: entre 30min i 4h per a positives, < 2h per a negatives

## G6 — Monitoring
- Dashboard d'admin amb mètriques de publicació
- Alerta si Google retorna errors 429 (rate limit) o rebuig
- Fallback automàtic a "copiar al clipboard" si hi ha problemes
- Log complet de totes les publicacions per audit

## G7 — Contingut
- Mai inventar informació que no està al KB
- Mai prometre compensacions, descomptes o reemborsaments sense KB entry explícita
- Mai revelar que la resposta és generada per IA
- Cada resposta ha de ser genuïnament única i rellevant al contingut de la ressenya
- Si la ressenya és buida (només estrelles), resposta curta i genèrica (no inflada)

## G8 — Compliance
- Termes d'ús: l'usuari accepta que OpinIA és una eina d'assistència, no un servei de publicació automàtica
- Responsibility disclaimer: l'usuari és responsable del contingut que publica
- Google ToS compliance: mai fer scraping de ressenyes de Google per fora de l'API oficial
- GDPR: mai emmagatzemar dades personals dels autors de ressenyes més enllà del que Google proporciona via API
