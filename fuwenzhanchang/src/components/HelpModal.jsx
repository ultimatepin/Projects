import { ArrowLeft, Copy, Layers3, ShieldCheck, Swords, Wifi, X } from 'lucide-react'

export default function HelpModal({ onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="help-modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="help-title">
        <button className="modal-close" onClick={onClose} aria-label="Close help"><X /></button>
        <span className="eyebrow">Quick start</span>
        <h2 id="help-title">Play across two devices</h2>
        <p className="help-lead">Only one device hosts the table. Device two must open the host’s full invite link—not its own localhost copy.</p>
        <div className="help-steps">
          <div><span><Layers3 /></span><strong>1. Build or choose a deck</strong><p>Decks are saved on each device. A 40-card demo deck is available for a quick test.</p></div>
          <div><span><Wifi /></span><strong>2. Create on the host</strong><p>Install and open Rift Local on one Windows computer connected to your private Wi-Fi.</p></div>
          <div><span><Copy /></span><strong>3. Share the full invite</strong><p>Copy the invite link shown in the waiting room and open it on device two.</p></div>
          <div><span><Swords /></span><strong>4. Join, ready, and start</strong><p>Both players ready up. The host starts; cards and hidden zones synchronize over the LAN.</p></div>
        </div>
        <div className="help-security"><ShieldCheck /><span><strong>Private network only</strong>Allow the Windows firewall prompt only for Private networks. The app never opens your router or uses cloud matchmaking.</span></div>
        <button className="primary-btn wide" onClick={onClose}>Got it <ArrowLeft className="arrow-right" size={16} /></button>
      </section>
    </div>
  )
}
