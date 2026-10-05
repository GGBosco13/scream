import React, { useState, useEffect } from 'react';
import ScreamConnect from './ScreamConnect';
import StaffDashboard from './StaffDashboard';
import AdminPanel from './AdminPanel';

function App() {
  const [view, setView] = useState('caller');

  // Read path from URL
  useEffect(() => {
    const hash = window.location.hash.replace('#', '') || 'caller';
    setView(hash);
  }, []);

  // Update hash on view change
  useEffect(() => {
    window.location.hash = view;
  }, [view]);

  return (
    <>
      {view === 'caller' && <ScreamConnect />}
      {view === 'staff' && <StaffDashboard />}
      {view === 'admin' && <AdminPanel />}

      {/* Dev View Switcher */}
      <div className="view-switcher">
        <button
          className={view === 'caller' ? 'active' : ''}
          onClick={() => setView('caller')}
        >
          Caller
        </button>
        <button
          className={view === 'staff' ? 'active' : ''}
          onClick={() => setView('staff')}
        >
          Staff
        </button>
        <button
          className={view === 'admin' ? 'active' : ''}
          onClick={() => setView('admin')}
        >
          Admin
        </button>
      </div>
    </>
  );
}

export default App;
