import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import MaterialVendors from './MaterialVendors';
import MaterialPI from './MaterialPI';
import MaterialPO from './MaterialPO';
import GRN from './GRN';
import ServiceVendors from './ServiceVendors';
import ServicePO from './ServicePO';

const MAROON = '#8B0000';

const PurchaseLayout = () => {
  const location = useLocation();
  const [activeSidebarItem, setActiveSidebarItem] = useState('material-vendors');
  const [expandedMenus, setExpandedMenus] = useState({ material: true, service: false });

  const toggleMenu = (key) => {
    setExpandedMenus((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const purchaseItem = String(params.get('purchaseItem') || '').toLowerCase();
    if (purchaseItem === 'service-po') {
      setExpandedMenus((prev) => ({ ...prev, service: true }));
      setActiveSidebarItem('service-po');
    } else if (purchaseItem === 'material-po') {
      setExpandedMenus((prev) => ({ ...prev, material: true }));
      setActiveSidebarItem('material-po');
    }
  }, [location.search]);

  const renderContent = useMemo(() => {
    switch (activeSidebarItem) {
      case 'material-pi':
        return <MaterialPI />;
      case 'material-po':
        return <MaterialPO />;
      case 'material-grn':
        return <GRN />;
      case 'service-vendors':
        return <ServiceVendors />;
      case 'service-po':
        return <ServicePO />;
      case 'material-vendors':
      default:
        return <MaterialVendors />;
    }
  }, [activeSidebarItem]);

  return (
    <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 60px)', paddingRight: 12 }}>
      <aside
        style={{
          width: 240,
          background: MAROON,
          color: '#fff',
          padding: '12px 0',
          boxSizing: 'border-box',
          overflowY: 'auto',
        }}
      >
        <SidebarSection
          title="MATERIAL"
          open={expandedMenus.material}
          onToggle={() => toggleMenu('material')}
          items={[
            { key: 'material-vendors', label: 'Material Vendors' },
            { key: 'material-pi', label: 'PI' },
            { key: 'material-po', label: 'PO' },
            { key: 'material-grn', label: 'GRN' },
          ]}
          activeSidebarItem={activeSidebarItem}
          setActiveSidebarItem={setActiveSidebarItem}
        />

        <SidebarSection
          title="SERVICE"
          open={expandedMenus.service}
          onToggle={() => toggleMenu('service')}
          items={[
            { key: 'service-vendors', label: 'Service Vendors' },
            { key: 'service-po', label: 'PO' },
          ]}
          activeSidebarItem={activeSidebarItem}
          setActiveSidebarItem={setActiveSidebarItem}
        />
      </aside>

      <section
        style={{
          flex: 1,
          background: '#f7f7f7',
          padding: 16,
          overflowY: 'auto',
          minWidth: 0,
        }}
      >
        {renderContent}
      </section>
    </div>
  );
};

const SidebarSection = ({ title, open, onToggle, items, activeSidebarItem, setActiveSidebarItem }) => {
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          background: 'transparent',
          color: '#fff',
          border: 'none',
          textAlign: 'left',
          padding: '10px 16px',
          fontSize: 17,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {title}
      </button>

      <div
        style={{
          maxHeight: open ? 180 : 0,
          overflow: 'hidden',
          transition: 'max-height 220ms ease',
        }}
      >
        {items.map((item) => {
          const isActive = activeSidebarItem === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveSidebarItem(item.key)}
              style={{
                width: '100%',
                background: isActive ? 'rgba(255,255,255,0.2)' : 'transparent',
                color: '#fff',
                border: 'none',
                textAlign: 'left',
                padding: '9px 28px',
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PurchaseLayout;
