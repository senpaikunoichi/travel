// Dibujos del camión (líneas) para la silueta de la cámara y el plano de daños.
// Lados: el izquierdo mira con el frente hacia la izquierda; el derecho es su espejo.

function Side() {
  return <>
    <rect x="70" y="14" width="158" height="74" rx="3" />
    <path d="M12 92 V54 Q12 36 28 33 H66 V92" />
    <rect x="22" y="39" width="36" height="20" rx="3" />
    <line x1="44" y1="62" x2="44" y2="88" />
    <rect x="6" y="80" width="10" height="12" rx="2" />
    <rect x="10" y="88" width="222" height="7" rx="2" />
    <circle cx="38" cy="101" r="12" /><circle cx="38" cy="101" r="4" />
    <circle cx="168" cy="101" r="12" /><circle cx="168" cy="101" r="4" />
    <circle cx="196" cy="101" r="12" /><circle cx="196" cy="101" r="4" />
  </>
}
function Front() {
  return <>
    <rect x="14" y="6" width="92" height="18" rx="2" />
    <rect x="18" y="22" width="84" height="70" rx="8" />
    <rect x="24" y="28" width="72" height="26" rx="4" />
    <rect x="36" y="62" width="48" height="20" rx="2" />
    <line x1="36" y1="69" x2="84" y2="69" /><line x1="36" y1="75" x2="84" y2="75" />
    <rect x="22" y="66" width="12" height="8" rx="2" /><rect x="86" y="66" width="12" height="8" rx="2" />
    <rect x="14" y="90" width="92" height="10" rx="2" />
    <rect x="20" y="100" width="16" height="16" rx="3" /><rect x="84" y="100" width="16" height="16" rx="3" />
    <rect x="5" y="30" width="9" height="17" rx="2" /><rect x="106" y="30" width="9" height="17" rx="2" />
  </>
}
function Rear() {
  return <>
    <rect x="10" y="6" width="100" height="88" rx="3" />
    <line x1="60" y1="10" x2="60" y2="90" />
    <line x1="53" y1="38" x2="53" y2="66" /><line x1="67" y1="38" x2="67" y2="66" />
    <rect x="14" y="94" width="92" height="6" rx="2" />
    <rect x="12" y="98" width="11" height="6" rx="1" /><rect x="97" y="98" width="11" height="6" rx="1" />
    <rect x="18" y="102" width="24" height="14" rx="3" /><rect x="78" y="102" width="24" height="14" rx="3" />
  </>
}

export function TruckShape({ view }) {
  if (view === 'frente') return <Front />
  if (view === 'posterior') return <Rear />
  return view === 'derecho' ? <g transform="translate(240 0) scale(-1 1)"><Side /></g> : <Side />
}
