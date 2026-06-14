import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export function GlowOverlay() {
  const [pulseId, setPulseId] = useState(0);

  useEffect(() => {
    setPulseId((current) => current + 1);
    const unlisten = listen("klak-glow-pulse", () => {
      setPulseId((current) => current + 1);
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  return (
    <div className="glow-surface" aria-hidden="true">
      <div key={pulseId} className="screen-edge-glow" />
    </div>
  );
}
