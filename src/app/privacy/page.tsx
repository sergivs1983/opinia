'use client';

import LegalShell from '@/components/ui/LegalShell';

export default function PrivacyPage() {
  return (
    <LegalShell title="Política de Privacitat" lastUpdated="18 de febrer de 2026">
      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">1. Responsable del tractament</h2>
        <p>
          OpinIA, amb domicili a Tarragona (Espanya). Contacte DPD: <a href="mailto:privacy@opinia.cat" className="text-brand-600 underline">privacy@opinia.cat</a>.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">2. Dades recollides</h2>
        <p>Recollim les següents categories de dades:</p>
        <ul className="list-disc pl-6 space-y-1 mt-2">
          <li><strong>Dades d&apos;autenticació:</strong> email, nom (via Google OAuth). No guardem contrasenyes.</li>
          <li><strong>Dades de negoci:</strong> nom, tipus, ubicació, configuració de veu.</li>
          <li><strong>Ressenyes:</strong> text, puntuació, font (importades pel client o via integració).</li>
          <li><strong>Respostes generades:</strong> text, to, estat (esborrany/publicat).</li>
          <li><strong>Dades d&apos;ús:</strong> accions al dashboard, generacions, IP hash (anonimitzat).</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">3. Finalitat i base legal</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Prestació del servei</strong> (execució contractual): generar respostes, insights, benchmarks.</li>
          <li><strong>Millora del producte</strong> (interès legítim): anàlisi agregada d&apos;ús, rendiment IA.</li>
          <li><strong>Comunicacions</strong> (consentiment): emails de producte i novetats (opt-in).</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">4. IA i processament automàtic</h2>
        <p>
          OpinIA utilitza models d&apos;intel·ligència artificial (OpenAI, Anthropic) per generar respostes.
          Les ressenyes s&apos;envien a proveïdors d&apos;IA per processar, però:
        </p>
        <ul className="list-disc pl-6 space-y-1 mt-2">
          <li>No s&apos;utilitzen per entrenar models de tercers.</li>
          <li>Es processen amb les polítiques de privacitat dels proveïdors (zero-retention on disponible).</li>
          <li>Cap resposta es publica sense aprovació humana.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">5. Conservació de dades</h2>
        <p>
          Les dades es conserven mentre el compte estigui actiu. Després de la cancel·lació,
          es retenen 90 dies i s&apos;eliminen de forma permanent. Logs operacionals: 30 dies.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">6. Drets de l&apos;interessat (RGPD)</h2>
        <p>Tens dret a: accés, rectificació, supressió, portabilitat, oposició i limitació. Contacta: <a href="mailto:privacy@opinia.cat" className="text-brand-600 underline">privacy@opinia.cat</a>.</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">7. Transferències internacionals</h2>
        <p>
          Les dades es processen a la UE (Supabase) i EUA (proveïdors IA). Les transferències
          a EUA es realitzen sota les clàusules contractuals tipus de la Comissió Europea.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">8. Cookies</h2>
        <p>
          Utilitzem cookies estrictament necessàries per a l&apos;autenticació. No utilitzem cookies
          de rastreig ni publicitat. No mostrem anuncis.
        </p>
      </section>
    </LegalShell>
  );
}
