import { NavLink } from "react-router-dom";
import {
  LayoutGrid,
  MapPin,
  FileText,
  AlertTriangle,
  MessageSquare,
  ClipboardCheck,
} from "lucide-react";

/**
 * Left navigation rail. Mirrors the MusterGo admin shell (Screens 2–6).
 * `exceptionCount` drives the red pill on the Exceptions item.
 */
export default function Sidebar({ exceptionCount = 0 }) {
  const items = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
    { to: "/trips", label: "Trips", icon: MapPin },
    { to: "/onboarding", label: "Documents", icon: FileText },
    { to: "/exceptions", label: "Exceptions", icon: AlertTriangle, badge: exceptionCount },
    { to: "/assistant", label: "Chat assistant", icon: MessageSquare },
  ];

  return (
    <nav className="sidebar" aria-label="Primary">
      <div className="sidebar-brand wordmark">
        <ClipboardCheck size={22} strokeWidth={2.4} /> MusterGo
      </div>
      {items.map(({ to, label, icon: Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
        >
          <Icon size={18} strokeWidth={2} />
          {label}
          {badge ? <span className="nav-badge">{badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}
