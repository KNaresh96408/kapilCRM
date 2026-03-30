import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import PurchaseLayout from './purchase/PurchaseLayout';
import InventoryLayout from './inventory/InventoryLayout';
import { auth, onAuthStateChanged } from '../../firebaseConfig';
import { BRAND_MAROON_PURPLE_GRADIENT } from '../../styles/brandTheme';


const MAROON = '#8B0000';

const salesLinks = [
  { label: "Customer Details", to: "/books/sales/customer-details" },
  { label: "Delivery Challans", to: "/books/sales/delivery-challans" },
  { label: "Invoices", to: "/books/sales/invoices" },
  { label: "Credit Notes", to: "/books/sales/credit-notes" },
  { label: "Payment Receivables", to: "/books/sales/payment-receivables" },
];

const BooksLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('sales');
  const [activeSalesItem, setActiveSalesItem] = useState('/books/sales/customer-details');
  const [authReady, setAuthReady] = useState(false);
  const [hasFirebaseUser, setHasFirebaseUser] = useState(Boolean(auth.currentUser));
  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setHasFirebaseUser(Boolean(user));
      setAuthReady(true);
    });

    // local session fallback for mobile/webview
    try {
      const stored = localStorage.getItem("kp-user");
      if (stored) {
        setHasFirebaseUser(true);
        setAuthReady(true);
      }
    } catch (_) {}

    return () => unsub();
  }, []);

  useEffect(() => {
    const path = location.pathname || '';
    if (path.startsWith('/books/purchase')) {
      setActiveTab('purchase');
    } else if (path.startsWith('/books/inventory')) {
      setActiveTab('inventory');
    } else {
      setActiveTab('sales');
    }

    const matchedSales = salesLinks.find((link) => path.startsWith(link.to));
    if (matchedSales) setActiveSalesItem(matchedSales.to);
  }, [location.pathname]);

  const isSales = activeTab === 'sales';

  const handleTabClick = (tab) => {
    setActiveTab(tab);
    if (tab === 'sales') {
      navigate(activeSalesItem || '/books/sales/customer-details');
    }
    if (tab === 'purchase') {
      navigate('/books/purchase');
    }
    if (tab === 'inventory') {
      navigate('/books/inventory');
    }
  };

  const contentView = useMemo(() => {
    if (activeTab === 'purchase') {
      return <PurchaseLayout />;
    }
    if (activeTab === 'inventory') {
      return <InventoryLayout />;
    }
    return <Outlet />;
  }, [activeTab]);

  if (!authReady) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#333' }}>
        Syncing session...
      </div>
    );
  }

  if (!hasFirebaseUser) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#800000' }}>
        Session not ready. Please logout and login again.
      </div>
    );
  }

  return (
    <div className="books-layout" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>
      <header
        style={{
          width: '100%',
          height: isMobile ? 'auto' : 60,
          background: BRAND_MAROON_PURPLE_GRADIENT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '0 12px' : '0 20px',
          paddingTop: isMobile ? 'calc(env(safe-area-inset-top, 0px) + 8px)' : 0,
          paddingBottom: isMobile ? '8px' : 0,
          boxSizing: 'border-box',
          color: '#fff',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: 700, fontSize: isMobile ? 18 : 24 }}>
          <button
            type="button"
            onClick={() => navigate("/apps")}
            style={{
              border: "1px solid rgba(255,255,255,0.65)",
              background: "transparent",
              color: "#fff",
              borderRadius: 10,
              padding: "6px 10px",
              fontWeight: 700,
              cursor: "pointer",
            }}
            aria-label="Back to apps"
          >
            ←
          </button>
          Books
        </div>
        <div style={{ display: 'flex', gap: isMobile ? 12 : 24, alignItems: 'center', overflowX: isMobile ? 'auto' : 'visible' }}>
          {['sales', 'purchase', 'inventory'].map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabClick(tab)}
                style={{
                  display: isMobile ? 'none' : 'inline-block',
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontSize: isMobile ? 14 : 18,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: '8px 0',
                  borderBottom: isActive ? '3px solid #fff' : '3px solid transparent',
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            );
          })}
        </div>
      </header>

      {isMobile && (
        <div style={{ background: BRAND_MAROON_PURPLE_GRADIENT, padding: '0 10px 8px', display: 'flex', gap: 8, overflowX: 'auto' }}>
          {['sales', 'purchase', 'inventory'].map((tab) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabClick(tab)}
                style={{
                  background: active ? '#fff' : 'rgba(255,255,255,0.14)',
                  color: active ? MAROON : '#fff',
                  border: 'none',
                  borderRadius: 999,
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            );
          })}
        </div>
      )}

      {isSales && isMobile && (
        <div style={{ background: BRAND_MAROON_PURPLE_GRADIENT, padding: '8px 10px', display: 'flex', gap: 8, overflowX: 'auto' }}>
          {salesLinks.map((link) => (
            <button
              key={link.to}
              type="button"
              onClick={() => {
                setActiveSalesItem(link.to);
                navigate(link.to);
              }}
              style={{
                background: activeSalesItem === link.to ? '#fff' : 'rgba(255,255,255,0.14)',
                color: activeSalesItem === link.to ? MAROON : '#fff',
                border: 'none',
                borderRadius: 999,
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {link.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: isSales ? 12 : 0, paddingRight: isSales ? 12 : 0 }}>
        {isSales && !isMobile && (
          <aside
            className="books-sidebar"
            style={{
              width: 240,
              background: BRAND_MAROON_PURPLE_GRADIENT,
              color: '#fff',
              padding: '12px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 16,
              fontWeight: 500,
              minHeight: 'calc(100vh - 60px)',
              boxShadow: '2px 0 8px rgba(0,0,0,0.04)',
            }}
          >
            {salesLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setActiveSalesItem(link.to)}
                style={({ isActive }) => ({
                  color: '#fff',
                  background: isActive ? 'rgba(255,255,255,0.2)' : 'transparent',
                  fontWeight: isActive ? 700 : 500,
                  padding: '10px 16px',
                  border: 'none',
                  borderLeft: isActive ? '3px solid #fff' : '3px solid transparent',
                  textDecoration: 'none',
                  borderRadius: '0 16px 16px 0',
                  transition: 'background 0.2s, border 0.2s ease',
                  marginRight: 8,
                  display: 'block',
                })}
                end
              >
                {link.label}
              </NavLink>
            ))}
          </aside>
        )}
        <main className="books-main" style={{ flex: 1, background: '#fff', minHeight: 0, overflow: 'auto' }}>
          {contentView}
        </main>
      </div>
    </div>
  );
};

export default BooksLayout;
