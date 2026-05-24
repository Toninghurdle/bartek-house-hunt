import React, { useState, useEffect } from 'react';
import { 
  MapContainer, 
  TileLayer, 
  CircleMarker, 
  Popup, 
  useMap 
} from 'react-leaflet';
import { 
  Settings, 
  RefreshCw, 
  MapPin, 
  User, 
  Clock, 
  ImageIcon,
  BookOpen,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

const API_BASE = ''; // Vercel API routes are on the same domain

// Component to dynamically adjust map center
function ChangeView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom]);
  return null;
}

function App() {
  const [properties, setProperties] = useState([]);
  const [criteria, setCriteria] = useState({
    maxPrice: 2000,
    preferredLocations: [],
    excludedKeywords: []
  });
  
  // Security State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [dashboardPassword, setDashboardPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // UI States
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [filterStatus, setFilterStatus] = useState('available');
  const [filterMatchOnly, setFilterMatchOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Settings Form State
  const [settingsForm, setSettingsForm] = useState({
    maxPrice: 2000,
    preferredLocationInput: '',
    excludedKeywordInput: ''
  });

  // Map state
  const [mapCenter, setMapCenter] = useState([51.5074, -0.1278]); // Central London
  const [mapZoom, setMapZoom] = useState(11);

  // Card view options
  const [expandedTextCardId, setExpandedTextCardId] = useState(null);
  const [activeImageIndices, setActiveImageIndices] = useState({});

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/properties`);
      const data = await res.json();
      setProperties(data || []);
      
      const settingsRes = await fetch(`${API_BASE}/api/settings`);
      const criteriaData = await settingsRes.json();
      if (criteriaData) {
        setCriteria(criteriaData);
        setSettingsForm(prev => ({
          ...prev,
          maxPrice: criteriaData.maxPrice || 2000
        }));
      }
    } catch (e) {
      console.error('Error fetching properties', e);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
      // Simple polling for updates since we removed WebSockets
      const interval = setInterval(fetchData, 60000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  // Update center when a property is clicked
  const handleLocateProperty = (lat, lon) => {
    if (lat && lon) {
      setMapCenter([lat, lon]);
      setMapZoom(14);
      // Smooth scroll to map
      const mapElement = document.getElementById('map-view');
      if (mapElement) {
        mapElement.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  // Auth Functions
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch(`${API_BASE}/api/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: dashboardPassword })
      });
      const data = await res.json();
      if (data.success) {
        setIsAuthenticated(true);
      } else {
        setAuthError(data.error || 'Incorrect password');
      }
    } catch (err) {
      setAuthError('Connection failed.');
    } finally {
      setAuthLoading(false);
    }
  };
  // Settings Functions
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    
    // Format criteria
    const updatedCriteria = {
      maxPrice: parseFloat(settingsForm.maxPrice),
      preferredLocations: criteria.preferredLocations,
      excludedKeywords: criteria.excludedKeywords
    };

    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedCriteria)
      });
      const data = await res.json();
      if (data.success) {
        setShowSettingsDrawer(false);
        fetchData();
      }
    } catch (err) {
      console.error('Failed to save settings', err);
    }
  };

  const addPreferredLocation = () => {
    if (settingsForm.preferredLocationInput.trim()) {
      setCriteria(prev => ({
        ...prev,
        preferredLocations: [...new Set([...prev.preferredLocations, settingsForm.preferredLocationInput.trim()])]
      }));
      setSettingsForm(prev => ({ ...prev, preferredLocationInput: '' }));
    }
  };

  const removePreferredLocation = (loc) => {
    setCriteria(prev => ({
      ...prev,
      preferredLocations: prev.preferredLocations.filter(l => l !== loc)
    }));
  };

  const addExcludedKeyword = () => {
    if (settingsForm.excludedKeywordInput.trim()) {
      setCriteria(prev => ({
        ...prev,
        excludedKeywords: [...new Set([...prev.excludedKeywords, settingsForm.excludedKeywordInput.trim()])]
      }));
      setSettingsForm(prev => ({ ...prev, excludedKeywordInput: '' }));
    }
  };

  const removeExcludedKeyword = (kw) => {
    setCriteria(prev => ({
      ...prev,
      excludedKeywords: prev.excludedKeywords.filter(k => k !== kw)
    }));
  };

  // Property Actions
  const handleUpdateStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_BASE}/api/properties/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {
      console.error('Failed to update status', e);
    }
  };

  // Sync History
  const [syncing, setSyncing] = useState(false);
  const handleSyncHistory = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 30 })
      });
      if (!res.ok) {
        console.error('Sync failed with status:', res.status);
        let errorMsg = 'Unknown error';
        try {
          const errData = await res.json();
          errorMsg = errData.error || errorMsg;
        } catch (e) {}
        alert(`Sync encountered an issue (Status: ${res.status}).\nError: ${errorMsg}\n\nPlease try again to process the next batch.`);
      } else {
        const data = await res.json();
        console.log(`Sync complete. Processed ${data.processed} messages.`);
      }
      fetchData();
    } catch (e) {
      console.error('Sync failed', e);
      alert(`Network error during sync. Please check your connection. Details: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  // Filter properties list
  const filteredProperties = properties.filter(prop => {
    // 1. Status Filter
    if (filterStatus !== 'all' && prop.status !== filterStatus) return false;
    
    // 2. Alert Match Filter
    if (filterMatchOnly && !prop.isAlertMatch) return false;

    // 3. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchLocation = prop.location.toLowerCase().includes(q);
      const matchDesc = prop.description.toLowerCase().includes(q);
      const matchSender = prop.sender_name.toLowerCase().includes(q);
      const matchTag = prop.tags.some(t => t.toLowerCase().includes(q));
      
      return matchLocation || matchDesc || matchSender || matchTag;
    }

    return true;
  });

  // Calculate stats
  const availableCount = properties.filter(p => p.status === 'available').length;
  const matchCount = properties.filter(p => p.isAlertMatch && p.status === 'available').length;

  if (!isAuthenticated) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-color)' }}>
        <form className="auth-form" onSubmit={handleLoginSubmit} style={{ maxWidth: '400px', width: '100%', padding: '2rem', background: '#fff', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', marginBottom: '1rem', textAlign: 'center' }}>LBS Apartment Hunt</h2>
          <p style={{ textAlign: 'center', marginBottom: '2rem', color: 'var(--text-muted)' }}>Enter dashboard password to continue</p>
          
          <label className="form-label">Password</label>
          <input
            type="password"
            className="form-input"
            value={dashboardPassword}
            onChange={(e) => setDashboardPassword(e.target.value)}
            required
            autoFocus
          />
          
          {authError && <div className="error-message">{authError}</div>}
          
          <button type="submit" className="btn-primary" disabled={authLoading} style={{ width: '100%', marginTop: '1rem' }}>
            {authLoading ? 'Verifying...' : 'Access Dashboard'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="brand-info">
          <h1>LBS Apartment Hunt</h1>
          <p>House hunting dashboard</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button 
            className="btn-secondary" 
            onClick={handleSyncHistory} 
            disabled={syncing}
          >
            {syncing ? <RefreshCw className="spin" size={16} /> : <RefreshCw size={16} />}
            {syncing ? 'Syncing...' : 'Sync History'}
          </button>
          <button className="btn-secondary" onClick={() => setShowSettingsDrawer(true)}>
            <Settings size={16} />
            Settings
          </button>
        </div>
      </header>

      {/* DASHBOARD SPLIT (MAP & CRITERIA INFO) */}
      <section className="dashboard-grid">
        {/* MAP CONTAINER */}
        <div className="panel" id="map-view">
          <div className="panel-header">
            <h2>Location Map</h2>
            <span className="help-text">Click circles to view properties</span>
          </div>
          <MapContainer 
            center={mapCenter} 
            zoom={mapZoom} 
            className="map-container"
            style={{ background: '#F0ECE6' }}
          >
            <ChangeView center={mapCenter} zoom={mapZoom} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
            {filteredProperties.map(prop => {
              if (!prop.latitude || !prop.longitude) return null;
              
              // Define marker colors based on matches/status
              let color = '#8A6B50'; // Default Oak/Leather
              if (prop.status === 'snapped_up') color = '#A75D4E'; // Rust
              else if (prop.isAlertMatch) color = '#4F6443'; // Muted Green

              return (
                <CircleMarker
                  key={prop.id}
                  center={[prop.latitude, prop.longitude]}
                  radius={prop.isAlertMatch ? 10 : 7}
                  fillColor={color}
                  color="#ffffff"
                  weight={1.5}
                  opacity={0.8}
                  fillOpacity={0.6}
                >
                  <Popup>
                    <div style={{ fontFamily: 'var(--font-sans)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', margin: 0 }}>
                        {prop.location}
                      </h3>
                      <p style={{ fontWeight: '600', color: 'var(--accent-color)', margin: 0 }}>
                        {prop.price ? `£${prop.price} ${prop.currency || 'GBP'}` : 'Price not specified'}
                      </p>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                        {prop.description.substring(0, 100)}...
                      </p>
                      <button 
                        style={{
                          background: 'var(--text-main)',
                          color: '#fff',
                          border: 'none',
                          padding: '0.25rem 0.5rem',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          borderRadius: '2px',
                          alignSelf: 'flex-start'
                        }}
                        onClick={() => {
                          const element = document.getElementById(`property-${prop.id}`);
                          if (element) {
                            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            element.style.borderColor = 'var(--accent-color)';
                            setTimeout(() => {
                              element.style.borderColor = prop.isAlertMatch ? 'var(--alert-match-border)' : 'var(--border-color)';
                            }, 2000);
                          }
                        }}
                      >
                        Find in Grid
                      </button>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        {/* METRICS & ALERT PREVIEW */}
        <div className="panel">
          <div className="panel-header">
            <h2>Current Overview</h2>
            <div className="help-text">Tracked via backend</div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div style={{ border: '1px solid var(--border-color)', padding: '1.25rem', borderRadius: '4px', background: '#FCFAF7' }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '2.5rem', fontWeight: '500', color: 'var(--text-main)' }}>
                {availableCount}
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Available properties</div>
            </div>
            
            <div style={{ border: '1px solid var(--alert-match-border)', padding: '1.25rem', borderRadius: '4px', background: 'var(--alert-match-bg)' }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '2.5rem', fontWeight: '500', color: 'var(--alert-match-text)' }}>
                {matchCount}
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Match alerts criteria</div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', fontFamily: 'var(--font-serif)' }}>Current Alert Criteria</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.95rem' }}>
              <div>
                <strong style={{ color: 'var(--text-muted)' }}>Max Price:</strong> £{criteria.maxPrice} / month
              </div>
              <div>
                <strong style={{ color: 'var(--text-muted)' }}>Locations:</strong>{' '}
                {criteria.preferredLocations.length === 0 ? (
                  <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Any location</span>
                ) : (
                  criteria.preferredLocations.map(l => (
                    <span key={l} style={{ marginRight: '0.5rem' }} className="tag">{l}</span>
                  ))
                )}
              </div>
              <div>
                <strong style={{ color: 'var(--text-muted)' }}>Excluded Keywords:</strong>{' '}
                {criteria.excludedKeywords.length === 0 ? (
                  <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>None</span>
                ) : (
                  criteria.excludedKeywords.map(k => (
                    <span key={k} style={{ marginRight: '0.5rem' }} className="tag">{k}</span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROPERTY GRID & FILTERS */}
      <section className="listings-section">
        <div className="listings-header">
          <h2>Property Listings ({filteredProperties.length})</h2>
          
          <div className="filters-bar">
            {/* Search Bar */}
            <input 
              type="text" 
              placeholder="Search listings..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                border: '1px solid var(--border-color)',
                padding: '0.4rem 0.8rem',
                fontSize: '0.85rem',
                borderRadius: '2px',
                width: '200px'
              }}
            />

            {/* Status Filters */}
            {['all', 'available', 'contacted', 'snapped_up', 'rejected'].map(status => (
              <button
                key={status}
                className={`filter-badge ${filterStatus === status ? 'active' : ''}`}
                onClick={() => setFilterStatus(status)}
                style={{ textTransform: 'capitalize' }}
              >
                {status.replace('_', ' ')}
              </button>
            ))}

            {/* Match Only Filter */}
            <button
              className={`filter-badge ${filterMatchOnly ? 'active' : ''}`}
              onClick={() => setFilterMatchOnly(!filterMatchOnly)}
            >
              Match Alerts Only
            </button>
          </div>
        </div>

        <div className="listings-grid">
          {filteredProperties.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.2rem', marginBottom: '0.5rem' }}>No listings match your selection.</p>
              <p style={{ fontSize: '0.9rem' }}>If you just logged in, please click "Sync History" to fetch past properties.</p>
            </div>
          ) : (
            filteredProperties.map(prop => (
              <article 
                key={prop.id} 
                id={`property-${prop.id}`} 
                className={`listing-card ${prop.isAlertMatch && prop.status === 'available' ? 'alert-match' : ''}`}
              >
                {prop.isAlertMatch && prop.status === 'available' && (
                  <span className="match-ribbon">Alert Match</span>
                )}
                
                 {/* Images */}
                <div className="listing-image-container">
                  {prop.image_paths && prop.image_paths.length > 0 ? (
                    <>
                      <img 
                        key={prop.image_paths[activeImageIndices[prop.id] || 0]}
                        src={`${API_BASE}${prop.image_paths[activeImageIndices[prop.id] || 0]}`} 
                        alt="Property" 
                        className="listing-image"
                        onLoad={(e) => {
                          e.target.style.display = 'block';
                          const parent = e.target.parentElement;
                          const placeholder = parent.querySelector('.no-image-placeholder');
                          if (placeholder) placeholder.style.display = 'none';
                        }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          const parent = e.target.parentElement;
                          const placeholder = parent.querySelector('.no-image-placeholder');
                          if (placeholder) placeholder.style.display = 'flex';
                        }}
                      />
                      {prop.image_paths.length > 1 && (
                        <>
                          <button 
                            type="button"
                            className="carousel-btn prev"
                            onClick={(e) => {
                              e.stopPropagation();
                              const currentIdx = activeImageIndices[prop.id] || 0;
                              setActiveImageIndices(prev => ({
                                ...prev,
                                [prop.id]: (currentIdx - 1 + prop.image_paths.length) % prop.image_paths.length
                              }));
                            }}
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <button 
                            type="button"
                            className="carousel-btn next"
                            onClick={(e) => {
                              e.stopPropagation();
                              const currentIdx = activeImageIndices[prop.id] || 0;
                              setActiveImageIndices(prev => ({
                                ...prev,
                                [prop.id]: (currentIdx + 1) % prop.image_paths.length
                              }));
                            }}
                          >
                            <ChevronRight size={16} />
                          </button>
                          <span className="carousel-indicator">
                            {(activeImageIndices[prop.id] || 0) + 1} / {prop.image_paths.length}
                          </span>
                        </>
                      )}
                    </>
                  ) : null}
                  
                  {/* Fallback/Placeholder if no image */}
                  <div 
                    className="no-image-placeholder"
                    style={{ display: (!prop.image_paths || prop.image_paths.length === 0) ? 'flex' : 'none' }}
                  >
                    <ImageIcon size={32} strokeWidth={1} />
                    <span style={{ fontSize: '0.8rem', fontStyle: 'italic' }}>No photos available</span>
                  </div>
                </div>

                {/* Content */}
                <div className="listing-content">
                  <div className="listing-top">
                    <div className="listing-price">
                      {prop.price && prop.price > 0 ? `£${prop.price}` : 'Price on Request'}
                      {prop.price && prop.price > 0 && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', fontWeight: '400', fontFamily: 'var(--font-sans)' }}>
                          {prop.price_type === 'nightly' ? 'per night' : prop.price_type === 'weekly' ? 'per week' : 'per month'}
                        </span>
                      )}
                    </div>
                    <span className={`status-badge ${prop.status}`}>
                      {prop.status.replace('_', ' ')}
                    </span>
                  </div>

                  <div>
                    <h3 className="listing-location">{prop.location}</h3>
                  </div>

                  <p className="listing-desc">{prop.description}</p>

                  {/* Tags */}
                  {prop.tags && prop.tags.length > 0 && (
                    <div className="listing-tags">
                      {prop.tags.map(tag => (
                        <span key={tag} className="tag">{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Toggle Message body */}
                  <div style={{ marginTop: 'auto', borderTop: '1px solid var(--bg-color)', paddingTop: '0.75rem' }}>
                    <button 
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-color)',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem'
                      }}
                      onClick={() => setExpandedTextCardId(expandedTextCardId === prop.id ? null : prop.id)}
                    >
                      <BookOpen size={14} />
                      {expandedTextCardId === prop.id ? 'Hide Chat Text' : 'View Original Message'}
                    </button>
                    
                    {expandedTextCardId === prop.id && (
                      <pre 
                        style={{
                          marginTop: '0.5rem',
                          background: 'var(--bg-color)',
                          padding: '0.75rem',
                          borderRadius: '2px',
                          whiteSpace: 'pre-wrap',
                          fontSize: '0.8rem',
                          fontFamily: 'monospace',
                          maxHeight: '150px',
                          overflowY: 'auto',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-main)'
                        }}
                      >
                        {prop.raw_message}
                      </pre>
                    )}
                  </div>
                </div>

                {/* Footer details */}
                <div className="listing-footer">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <User size={12} />
                      <span>{prop.sender_name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Clock size={12} />
                      <span>{new Date(prop.date_posted).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="listing-actions">
                    {prop.latitude && prop.longitude && (
                      <button 
                        className="btn-secondary" 
                        style={{ padding: '0.35rem', borderRadius: '2px' }}
                        title="Locate on Map"
                        onClick={() => handleLocateProperty(prop.latitude, prop.longitude)}
                      >
                        <MapPin size={14} />
                      </button>
                    )}

                    {prop.status === 'available' ? (
                      <>
                        <button 
                          className="btn-secondary" 
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '2px' }}
                          onClick={() => handleUpdateStatus(prop.id, 'contacted')}
                        >
                          Contacted
                        </button>
                        <button 
                          className="btn-secondary" 
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '2px' }}
                          onClick={() => handleUpdateStatus(prop.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </>
                    ) : prop.status === 'contacted' ? (
                      <>
                        <button 
                          className="btn-primary" 
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '2px', backgroundColor: 'var(--status-snapped-text)' }}
                          onClick={() => handleUpdateStatus(prop.id, 'snapped_up')}
                        >
                          Snapped!
                        </button>
                        <button 
                          className="btn-secondary" 
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '2px' }}
                          onClick={() => handleUpdateStatus(prop.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <button 
                        className="btn-secondary" 
                        style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '2px' }}
                        onClick={() => handleUpdateStatus(prop.id, 'available')}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>



      {/* SETTINGS DRAWER */}
      {showSettingsDrawer && (
        <div className="modal-overlay" onClick={() => setShowSettingsDrawer(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <h2 className="modal-title">Alert & Target Settings</h2>
            
            <form onSubmit={handleSaveSettings} className="modal-body">
              <div className="form-group">
                <label>Telegram Group Name to Monitor</label>
                <input 
                  type="text" 
                  required 
                  value={settingsForm.targetChatName}
                  onChange={(e) => setSettingsForm({ ...settingsForm, targetChatName: e.target.value })}
                />
                <span className="help-text">Must match the exact name of the private/public group in your Telegram app (e.g. <strong>LBS Apartment Hunt</strong>)</span>
              </div>

              <div className="form-group" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                <label>Max Budget (£ per month)</label>
                <input 
                  type="number" 
                  required
                  value={settingsForm.maxPrice}
                  onChange={(e) => setSettingsForm({ ...settingsForm, maxPrice: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Preferred Locations</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    type="text" 
                    placeholder="e.g. Clapham"
                    value={settingsForm.preferredLocationInput}
                    onChange={(e) => setSettingsForm({ ...settingsForm, preferredLocationInput: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPreferredLocation())}
                  />
                  <button type="button" className="btn-secondary" onClick={addPreferredLocation}>Add</button>
                </div>
                <div className="criteria-pill-container">
                  {criteria.preferredLocations.map(loc => (
                    <span key={loc} className="criteria-pill">
                      {loc}
                      <button type="button" onClick={() => removePreferredLocation(loc)}><X size={10} /></button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Excluded Keywords</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    type="text" 
                    placeholder="e.g. female only"
                    value={settingsForm.excludedKeywordInput}
                    onChange={(e) => setSettingsForm({ ...settingsForm, excludedKeywordInput: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addExcludedKeyword())}
                  />
                  <button type="button" className="btn-secondary" onClick={addExcludedKeyword}>Add</button>
                </div>
                <div className="criteria-pill-container">
                  {criteria.excludedKeywords.map(kw => (
                    <span key={kw} className="criteria-pill">
                      {kw}
                      <button type="button" onClick={() => removeExcludedKeyword(kw)}><X size={10} /></button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="modal-actions" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowSettingsDrawer(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Settings</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
