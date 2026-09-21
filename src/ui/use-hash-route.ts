import { useEffect, useState } from "react";

const read = () => window.location.hash.replace(/^#/, "") || "/";

/** URL の hash をルートとして使う（GitHub Pages ではサーバ側のルーティングができないため） */
export function useHashRoute(): string {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
