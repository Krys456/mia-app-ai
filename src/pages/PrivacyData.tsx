import { PageHeader } from '../components/PageHeader'
import {
  PRIVACY_DISCLOSURE,
  buildBetaContactLine,
  resolvePrivacyContactEmail,
} from '../lib/privacyCopy'
import './PrivacyData.css'

interface PrivacyDataProps {
  onBack: () => void
}

/**
 * #298B — Lightweight Privacy & Data disclosure (closed beta).
 * AppView surface — no router.
 */
export function PrivacyData({ onBack }: PrivacyDataProps) {
  const contact = resolvePrivacyContactEmail()

  return (
    <main className="privacy-data" aria-labelledby="privacy-data-title">
      <PageHeader title="Privacy & Data" titleId="privacy-data-title" onBack={onBack} />

      <div className="privacy-data__body scroll-surface">
        <p className="privacy-data__lead">
          How ShinkAIdo handles your data in this closed beta. This is product transparency, not a
          legal certification.
        </p>

        <section className="privacy-data__section" aria-labelledby="privacy-ai-title">
          <h2 id="privacy-ai-title" className="privacy-data__heading">
            AI processing
          </h2>
          <p>{PRIVACY_DISCLOSURE.aiProcessing}</p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-files-title">
          <h2 id="privacy-files-title" className="privacy-data__heading">
            Images & documents
          </h2>
          <p>{PRIVACY_DISCLOSURE.files}</p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-search-title">
          <h2 id="privacy-search-title" className="privacy-data__heading">
            Web search
          </h2>
          <p>{PRIVACY_DISCLOSURE.webSearch}</p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-memory-title">
          <h2 id="privacy-memory-title" className="privacy-data__heading">
            Memory
          </h2>
          <p>{PRIVACY_DISCLOSURE.memory}</p>
          <p>{PRIVACY_DISCLOSURE.newChatVsMemory}</p>
          <p className="privacy-data__warn" role="note">
            {PRIVACY_DISCLOSURE.sensitiveWarning}
          </p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-session-title">
          <h2 id="privacy-session-title" className="privacy-data__heading">
            Anonymous session
          </h2>
          <p>{PRIVACY_DISCLOSURE.anonymousSession}</p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-services-title">
          <h2 id="privacy-services-title" className="privacy-data__heading">
            Services
          </h2>
          <p>{PRIVACY_DISCLOSURE.processors}</p>
        </section>

        <section className="privacy-data__section" aria-labelledby="privacy-contact-title">
          <h2 id="privacy-contact-title" className="privacy-data__heading">
            Contact
          </h2>
          <p>{buildBetaContactLine(contact)}</p>
          {contact.startsWith('[') ? (
            <p className="privacy-data__meta" role="note">
              Configure <code>VITE_PRIVACY_CONTACT_EMAIL</code> for this beta deployment.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  )
}
