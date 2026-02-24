'use client';

import LegalShell from '@/components/ui/LegalShell';

export default function TermsPage() {
  return (
    <LegalShell title="Termes i Condicions del Servei" lastUpdated="18 de febrer de 2026">
      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">1. Objecte</h2>
        <p>
          Aquests Termes i Condicions regulen l&apos;accés i ús de la plataforma OpinIA (&quot;el Servei&quot;),
          una eina SaaS de gestió de ressenyes amb intel·ligència artificial per a negocis d&apos;hostaleria.
          En accedir al Servei, l&apos;Usuari accepta íntegrament aquestes condicions.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">2. Definicions</h2>
        <p>
          <strong>Plataforma:</strong> OpinIA, accessible via web i API. <br />
          <strong>Usuari:</strong> qualsevol persona o entitat que s&apos;hi registri. <br />
          <strong>Contingut generat per IA:</strong> textos de resposta produïts pel motor d&apos;intel·ligència artificial d&apos;OpinIA.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">3. Ús del servei</h2>
        <p>
          L&apos;Usuari és responsable de revisar i aprovar qualsevol resposta generada per IA abans de publicar-la.
          OpinIA actua com a eina de suport, no com a publicador autònom. Cap resposta es publica
          sense aprovació explícita de l&apos;Usuari (&quot;human-in-the-loop&quot;).
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">4. Plans i Facturació</h2>
        <p>
          OpinIA ofereix plans Starter, Pro i Enterprise amb límits de generació mensuals.
          Els preus es detallen a la pàgina de plans. El canvi de pla és efectiu al cicle següent.
          No hi ha permanència mínima.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">5. Propietat intel·lectual</h2>
        <p>
          El contingut generat per IA és propietat de l&apos;Usuari un cop publicat. OpinIA conserva
          drets sobre la tecnologia, el disseny, i la marca. L&apos;Usuari no pot redistribuir o
          revendre el Servei.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">6. Limitació de responsabilitat</h2>
        <p>
          OpinIA no es fa responsable dels continguts publicats per l&apos;Usuari. Les respostes generades
          per IA poden contenir errors; per això l&apos;Usuari ha de revisar-les abans de publicar.
          El sistema de guardrails avisa de possibles problemes, però no garanteix exactitud absoluta.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">7. Resolució de conflictes</h2>
        <p>
          Qualsevol disputa es resoldrà sota la jurisdicció dels tribunals de Tarragona (Espanya),
          d&apos;acord amb la legislació espanyola i europea aplicable.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-900 mb-2">8. Contacte</h2>
        <p>
          Per a qualsevol consulta: <a href="mailto:legal@opinia.cat" className="text-brand-600 underline">legal@opinia.cat</a>
        </p>
      </section>
    </LegalShell>
  );
}
