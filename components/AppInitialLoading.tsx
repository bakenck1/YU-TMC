import { LoaderCircle } from "lucide-react";
import type { AppLanguage } from "@/lib/app-settings";
import { translate } from "@/lib/i18n";

export interface AppInitialLoadingProps {
  language: AppLanguage;
  authPage: boolean;
}

export default function AppInitialLoading({ language, authPage }: AppInitialLoadingProps) {
  if (authPage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" aria-busy="true" aria-label={translate(language, "common.loading")}>
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-base font-bold text-white">YU</div>
          <LoaderCircle className="h-6 w-6 animate-spin text-emerald-600" aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background" aria-busy="true" aria-label={translate(language, "common.loading")}>
      <div className="hidden w-[248px] border-r border-black/5 bg-white p-4 md:block">
        <div className="h-9 w-32 animate-pulse rounded-xl bg-zinc-100" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-10 animate-pulse rounded-xl bg-zinc-100" />)}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-16 border-b border-black/5 bg-white" />
        <div className="flex flex-1 items-center justify-center"><LoaderCircle className="h-7 w-7 animate-spin text-emerald-600" aria-hidden="true" /></div>
      </div>
    </div>
  );
}
