import { createContext, useContext, useState, useEffect, useMemo } from 'react';

// A single shared breadcrumb trail, rendered once by AppShell right under
// the header, and populated by whichever page is currently mounted. Pages
// call useSetBreadcrumbs([...]) with their own trail once their data has
// loaded (so e.g. the division/league names are available); the trail is
// cleared automatically when that page unmounts, so navigating away never
// leaves a stale crumb behind.
const BreadcrumbContext = createContext(null);

export function BreadcrumbProvider({ children }) {
  const [crumbs, setCrumbs] = useState([]);
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

export function useBreadcrumbContext() {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) throw new Error('useBreadcrumbContext must be used within a BreadcrumbProvider');
  return ctx;
}

// `crumbs` should be an array of { label, to } - `to` omitted (or falsy) on
// the last entry, since the current page isn't a link to itself. Depend on
// a stable string form of the label/to sequence, not object identity, so
// this doesn't re-trigger on every render of the calling page.
export function useSetBreadcrumbs(crumbs) {
  const { setCrumbs } = useBreadcrumbContext();
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setCrumbs(crumbs);
    return () => setCrumbs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
