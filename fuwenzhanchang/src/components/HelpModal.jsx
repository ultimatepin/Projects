import { ArrowLeft, BookOpen, Copy, Layers3, ShieldCheck, Swords, Wifi, X } from 'lucide-react'

export default function HelpModal({ onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="help-modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="help-title">
        <button className="modal-close" onClick={onClose} aria-label="Close help"><X /></button>
        <span className="eyebrow">Quick start</span>
        <h2 id="help-title">Play across two devices</h2>
        <p className="help-lead">Only one device hosts the table. Device two must open the host’s full invite link—not its own localhost copy. Version 1.3 follows the official March 30, 2026 Core Rules for a best-of-one 1v1 Duel.</p>
        <div className="help-steps">
          <div><span><Layers3 /></span><strong>1. Build or choose a deck</strong><p>Use a complete custom deck or one of the seven released Jinx, Viktor, Lee Sin, Fiora, Rumble, Vi, and Vex Champion Decks.</p></div>
          <div><span><Wifi /></span><strong>2. Create on the host</strong><p>Install and open Rift Local on one Windows computer connected to your private Wi-Fi.</p></div>
          <div><span><Copy /></span><strong>3. Share the full invite</strong><p>Copy the invite link shown in the waiting room and open it on device two.</p></div>
          <div><span><Swords /></span><strong>4. Join, ready, and start</strong><p>The server selects the first player, deals four cards, runs each mulligan, and starts the official Awaken → Beginning → Channel → Draw → Main → Ending turn loop.</p></div>
        </div>
        <div className="help-rules-note"><BookOpen /><span><strong>How rules work in the app</strong>Universal rules—runes, movement, showdowns, combat damage, Hold/Conquer scoring, burnout, and the 8-point strict-lead victory check—run on the host. Resolve printed card text together with the logged manual-effect controls because the bundled public catalog does not contain structured rules text, Champion tags, or Signature metadata.</span></div>
        <div className="help-security"><ShieldCheck /><span><strong>Private network only</strong>Allow the Windows firewall prompt only for Private networks. The app never opens your router or uses cloud matchmaking.</span></div>
        <button className="primary-btn wide" onClick={onClose}>Got it <ArrowLeft className="arrow-right" size={16} /></button>
      </section>
    </div>
  )
}
