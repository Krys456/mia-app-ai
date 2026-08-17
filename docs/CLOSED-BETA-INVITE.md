# ShinkAIdo Closed Beta — Invite template

Use this short note when inviting ~10–20 external testers.
Do **not** ship this into the app UI.

---

## Invite (copy / paste)

Ciao,

sei invitato/a alla **Closed Beta** di **ShinkAIdo**.

**Prima di aprire il link**
- Usa un **profilo browser personale/privato** (non condividere lo stesso profilo con altri tester).
- Target principale testato: **Android Chrome**.
- Non redistribuire pubblicamente l’URL o le credenziali di accesso alla beta.

**Cosa sapere**
- ShinkAIdo è in closed beta: alcune funzioni possono fallire.
- Puoi **scrivere liberamente** nella chat.
- La **Memoria è attiva di default**: ShinkAIdo può salvare fatti utili per chat successive.
- **Non inserire** password, dati di pagamento, chiavi API o altri segreti.
- **Nuova chat** chiude solo la conversazione sullo schermo: **non cancella la Memoria**.
- Impostazioni → **Privacy e dati** spiega elaborazione, Memoria, sessione anonima e supporto.
- La conversazione sullo schermo può sparire al refresh; la Memoria è separata.

**Segnalare un problema**
1. Impostazioni → Privacy e dati → **Segnala un problema**
2. Se compare, includi **Riferimento** e **Build beta**
3. Descrivi cosa stavi facendo (senza incollare chat o Memoria a meno che non sia necessario)

Grazie per il feedback.

---

## Operator notes

- Access control for closed beta is **operational** (Vercel Deployment Protection / password), not an in-app invite code.
- `noindex, nofollow` reduces search discovery; it is **not** access control.
- Confirm `VITE_PRIVACY_CONTACT_EMAIL` is set on the deployment testers use.
- See `docs/CLOSED-BETA-OPS-CHECKLIST.md` before GO / NO-GO.
