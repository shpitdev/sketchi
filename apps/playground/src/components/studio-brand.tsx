import { SKETCHI_WEB_HOME_URL } from "@/features/playground/home-url";
import { cn } from "@/lib/utils";

export function StudioBrand({ className }: { className?: string }) {
  return (
    <a
      aria-label="Sketchi home"
      className={cn("studio-brand", className)}
      href={SKETCHI_WEB_HOME_URL}
    >
      <span className="studio-brand__tile" aria-hidden="true">
        <img alt="" height="30" src="/icon.svg" width="30" />
      </span>
      <span className="studio-brand__wordmark">Sketchi</span>
      <span className="studio-brand__surface">Playground</span>
    </a>
  );
}
