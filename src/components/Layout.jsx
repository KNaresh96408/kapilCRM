import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

const NavLink = ({ to, children }) => {
  const { pathname } = useLocation();
  const active = pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={
        "block px-3 py-2 rounded-md " +
        (active
          ? "bg-white/10 text-white"
          : "text-gray-300 hover:text-white hover:bg-white/10")
      }
    >
      {children}
    </Link>
  );
};

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col p-4">
        <h2 className="text-lg font-bold mb-6">Kapil Power CRM</h2>
        <nav className="space-y-1">
          <NavLink to="/home">🏠 Home</NavLink>
          <NavLink to="/leads">🧾 Leads</NavLink>
          <NavLink to="/deals">📑 Deals</NavLink>
          <NavLink to="/orders">🛒 Sales Orders</NavLink>
          <NavLink to="/reports">📊 Reports</NavLink>
        </nav>
        <div className="mt-auto text-xs text-gray-400">
          v0.1 • Phase-3
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
