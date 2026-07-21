import { Link } from 'react-router-dom';
import { useBreadcrumbContext } from '../BreadcrumbContext.jsx';

export default function Breadcrumbs() {
  const { crumbs } = useBreadcrumbContext();
  if (crumbs.length === 0) return null;

  return (
    <nav className="breadcrumb-bar" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => (
        <span key={i} className="breadcrumb-item">
          {i > 0 && <span className="breadcrumb-sep">›</span>}
          {crumb.to && i < crumbs.length - 1 ? (
            <Link to={crumb.to}>{crumb.label}</Link>
          ) : (
            <span className="breadcrumb-current">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
