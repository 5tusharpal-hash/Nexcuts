"use client";

import { useEffect } from "react";
import { useOverlayScrollbars } from "overlayscrollbars-react";

export function GlobalScrollbars() {
  const [initialize, getInstance] = useOverlayScrollbars({
    defer: true,
    options: {
      scrollbars: {
        theme: "os-theme-salonix",
        autoHide: "scroll",
        autoHideDelay: 700,
      },
    },
  });

  useEffect(() => {
    initialize(document.body);
    return () => getInstance()?.destroy();
  }, [getInstance, initialize]);

  return null;
}
