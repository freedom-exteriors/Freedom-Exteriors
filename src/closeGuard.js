import { useRef } from "react";

// Closing a document with unsaved changes (e.g. a signature the homeowner just
// gave in person) asks first instead of silently throwing the changes away.
// Returns [close, remember]: call remember(data) whenever the document is saved.
export function useCloseGuard(data, onSave, onClose) {
  const savedRef = useRef(JSON.stringify(data));
  const remember = (d) => { savedRef.current = JSON.stringify(d); };
  const close = () => {
    if (JSON.stringify(data) !== savedRef.current) {
      if (window.confirm("This document has unsaved changes (including any new signatures).\n\nOK = save and close\nCancel = more options")) {
        onSave(data);
      } else if (!window.confirm("Close WITHOUT saving? Your changes will be lost.")) {
        return;
      }
    }
    onClose();
  };
  return [close, remember];
}
