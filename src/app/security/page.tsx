'use client';

import LegalShell from '@/components/ui/LegalShell';

export default function SecurityPage() {
  return (
    <LegalShell title="Seguretat i Protecció de Dades" lastUpdated="18 de febrer de 2026">
      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">Arquitectura de seguretat</h2>
        <p>OpinIA implementa múltiples capes de seguretat per protegir les dades dels nostres clients:</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">🔐 Autenticació i accés</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>OAuth 2.0 via Google (sense contrasenyes emmagatzemades)</li>
          <li>Tokens JWT amb expiració curta</li>
          <li>Row Level Security (RLS) a totes les taules — cada organització només veu les seves dades</li>
          <li>Rols multi-tenant: owner, manager, staff amb permisos diferenciats</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">🛡️ Protecció de dades</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Xifrat en trànsit (TLS 1.3) i en repòs (AES-256)</li>
          <li>Base de dades Supabase (PostgreSQL) amb backups diaris</li>
          <li>IPs anonimitzats mitjançant hash SHA-256 amb salt</li>
          <li>Cap secret d&apos;API a logs ni payloads de DLQ</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">🤖 Seguretat IA</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Prompt injection defense: sanitització d&apos;entrada, tags untrusted</li>
          <li>Guardrails locals: verificació de preus, horaris, formalitat, repetició</li>
          <li>Human-in-the-loop: cap resposta es publica automàticament</li>
          <li>Audit trail complet: cada generació registra model, provider, request_id</li>
          <li>Circuit breaker: fallback automàtic entre proveïdors IA</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">📊 Observabilitat</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Logging estructurat (JSON) amb request_id, org_id, duració</li>
          <li>Activity log per auditoria d&apos;accions</li>
          <li>Dead Letter Queue (DLQ) per errors recuperables</li>
          <li>Dashboard d&apos;estat amb diagnòstics exportables</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">🌍 Compliance</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>RGPD: drets d&apos;accés, rectificació, supressió i portabilitat</li>
          <li>LOPDGDD (Espanya): adequació a la normativa local</li>
          <li>Google API Terms: ús conforme a les polítiques de Google Business Profile</li>
          <li>Cap scraping il·legal: dades de competidors són opt-in manual</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">📬 Divulgació responsable</h2>
        <p>
          Si descobreixes una vulnerabilitat, contacta&apos;ns a <a href="mailto:security@opinia.cat" className="text-brand-600 underline">security@opinia.cat</a>.
          Ens comprometem a respondre en 48h i a no emprendre accions legals contra investigadors de bona fe.
        </p>
      </section>
    </LegalShell>
  );
}
