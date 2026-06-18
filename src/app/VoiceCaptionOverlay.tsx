import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export function VoiceCaptionOverlay() {
  const [caption, setCaption] = useState("I'm listening...");

  useEffect(() => {
    const unlisten = listen<string>("klak-caption-update", (event) => {
      setCaption(event.payload);
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  return (
    <div className="voice-caption-surface" aria-live="polite">
      <div className="voice-caption-pulse" />
      <span>{caption}</span>
    </div>
  );
}
