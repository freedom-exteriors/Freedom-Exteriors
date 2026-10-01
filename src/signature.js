// Shared bits for the signature pads.

// Dark ink: signatures are drawn and shown on white, and printed on contracts.
export const SIGNATURE_INK = "#1a2535";

// Pointer position in the canvas's own pixels. The canvas is drawn at a fixed
// size but shown at whatever width the screen allows (e.g. ~340px on a phone),
// so screen coordinates have to be scaled or the line lands off the finger.
export function canvasPoint(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const p = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
  const sx = rect.width ? canvas.width / rect.width : 1;
  const sy = rect.height ? canvas.height / rect.height : 1;
  return { x: (p.clientX - rect.left) * sx, y: (p.clientY - rect.top) * sy };
}
