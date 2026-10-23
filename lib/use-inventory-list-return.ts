"use client";

import { useEffect } from "react";

const KEY = "yu-inventory:list-return:v1";

/** The shell scrolls its main element, independently of window/Next scroll. */
export function useInventoryListReturn(listHref: string | undefined) {
  useEffect(() => {
    if (!listHref) return;
    let first = 0;
    let second = 0;
    const restore = () => {
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          try {
            const raw = sessionStorage.getItem(KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved.href !== listHref || !Number.isFinite(saved.top) || saved.top < 0) return;
            const main = document.querySelector("main");
            if (!main) return;
            const row = [...main.querySelectorAll<HTMLElement>("[data-inventory-entry]")].find(entry => entry.dataset.inventoryEntry === saved.id && entry.getClientRects().length > 0);
            const top = row && Number.isFinite(saved.offset)
              ? main.scrollTop + row.getBoundingClientRect().top - main.getBoundingClientRect().top - saved.offset
              : saved.top;
            main.scrollTo({ top, behavior: "instant" });
            if (Number.isFinite(saved.windowTop)) window.scrollTo({ top: saved.windowTop, behavior: "instant" });
            sessionStorage.removeItem(KEY);
          } catch { /* Storage can be unavailable in private browsing. */ }
        });
      });
    };
    restore();
    window.addEventListener("popstate", restore);
    window.addEventListener("pageshow", restore);
    return () => {
      cancelAnimationFrame(first); cancelAnimationFrame(second);
      window.removeEventListener("popstate", restore);
      window.removeEventListener("pageshow", restore);
    };
  }, [listHref]);

  return (element: HTMLElement, id: string) => {
    if (!listHref) return;
    const main = element.closest("main");
    const row = element.closest<HTMLElement>("[data-inventory-entry]");
    if (!main) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ href: listHref, id, top: main.scrollTop, windowTop: window.scrollY,
        offset: row ? row.getBoundingClientRect().top - main.getBoundingClientRect().top : undefined }));
    } catch { /* Navigation remains available when storage is disabled. */ }
  };
}
