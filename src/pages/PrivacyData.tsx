import { PageHeader } from '../components/PageHeader'
import {
  PRIVACY_DISCLOSURE,
  buildBetaContactLine,
  resolvePrivacyContactEmail,
} from '../lib/privacyCopy'
import { getClientBuildId } from '../lib/buildInfo'
import { buildBetaSupportMailto, isPrivacyContactConfigured } from '../lib/betaSupport'
import './PrivacyData.css'

interface PrivacyDataProps {
  onBack: () => void
}

/**
 * #298B — Lightweight Privacy & Data disclosure (closed beta).
 * #298C — Beta build + mailto support.
 * #298D — Italian UI copy + quiet beta identity.
 * AppView surface — no router.
 */
export function PrivacyData({ onBack }: PrivacyDataProps) {
  const contact = resolvePrivacyContactEmail()
  const buildId = getClientBuildId()
  const mailto = buildBetaSupportMailto({ surface: 'privacy-data' })
  const contactConfigured = isPrivacyContactConfigured(contact)

  return (
    <main className="privacy-data" aria-labelledby="privacy-data-title">
      <PageHeader title="Privacy e dati" titleId="privacy-data-title" onBack={onBack} />

      <div className="privacy-data__body scroll-surface">
        <p className="privacy-data__lead">
          Come ShinkAIdo tratta i tuoi dati in questa Closed Beta. È trasparenza di prodotto, non
          una certificazione legale.
        </p>

        <section className="privacy-data__section" aria-labelledby="privacy-ai-title">
          <h2 id="privacy-ai-title" className="privacy-data__heading">
            Elaborazione AI
          </h2>
          <p>{PRIVACY_DISCLOSURE.aiProcessing}</p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-files-title">
          <h2 id="privacy-files-title" className="privacy-data__heading">
            Immagini e documenti
          </h2>
          <p>{PRIVACY_DISCLOSURE.files}</p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-search-title">
          <h2 id="privacy-search-title" className="privacy-data__heading">
            Ricerca web
          </h2>
          <p>{PRIVACY_DISCLOSURE.webSearch}</p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-memory-title">
          <h2 id="privacy-memory-title" className="privacy-data__heading">
            Memoria
          </h2>
          <p>{PRIVACY_DISCLOSURE.memory}</p>
          <p>{PRIVACY_DISCLOSURE.newChatVsMemory}</p>
          <p>{PRIVACY_DISCLOSURE.conversationSession}</p>
          <p className="privacy-data__warn" role="note">
            {PRIVACY_DISCLOSURE.sensitiveWarning}
          </p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-session-title">
          <h2 id="privacy-session-title" className="privacy-data__heading">
            Sessione anonima
          </h2>
          <p>{PRIVACY_DISCLOSURE.anonymousSession}</p>
          <p className="privacy-data__meta" role="note">
            {PRIVACY_DISCLOSURE.sharedDevice}
          </p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-services-title">
          <h2 id="privacy-services-title" className="privacy-data__heading">
            Servizi
          </h2>
          <p>{PRIVACY_DISCLOSURE.processors}</p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-safety-title">
          <h2 id="privacy-safety-title" className="privacy-data__heading">
            Uso responsabile
          </h2>
          <p>{PRIVACY_DISCLOSURE.highStakes}</p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-beta-title">
          <h2 id="privacy-beta-title" className="privacy-data__heading">
            Closed Beta
          </h2>
          <p>Build beta: {buildId}</p>
          <p className="privacy-data__meta" role="note">
            Quando qualcosa non funziona può comparire un riferimento errore (Riferimento). Puoi
            includerlo quando contatti il supporto: aiuta a diagnosticare senza condividere chat o
            contenuto della Memoria.
          </p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-contact-title">
          <h2 id="privacy-contact-title" className="privacy-data__heading">
            Contatti
          </h2>
          <p>{buildBetaContactLine(contact)}</p>
          {contactConfigured && mailto ? (
            <p>
              <a className="privacy-data__support-link" href={mailto}>
                Segnala un problema
              </a>
            </p>
          ) : (
            <p className="privacy-data__meta" role="note">
              Configura <code>VITE_PRIVACY_CONTACT_EMAIL</code> per questo deployment beta.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
