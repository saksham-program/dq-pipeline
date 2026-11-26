import darkLogo from "@/assets/dq-pipeline-logo-dark.png";
import lightLogo from "@/assets/dq-pipeline-logo-light.png";

/** Both variants retain the supplied artwork; only its background differs. */
export function BrandLogo() {
  return (
    <span className="relative block size-9 shrink-0" role="img" aria-label="DQ Pipeline logo">
      <img src={lightLogo} alt="" width={36} height={36} className="size-full object-contain dark:hidden" />
      <img src={darkLogo} alt="" width={36} height={36} className="hidden size-full object-contain dark:block" />
    </span>
  );
}