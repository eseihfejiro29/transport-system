import { useState } from 'react'
import PassengerApp from './PassengerApp'
import DriverApp from './DriverApp'

export default function App() {
  const [view, setView] = useState('both')

  return (
    <div style={{ fontFamily: 'sans-serif', background: '#0a0f1e', minHeight: '100vh' }}>
      
      {/* Top switcher bar */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, padding: '12px', background: '#111827' }}>
        {['passenger', 'both', 'driver'].map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: view === v ? '#2563eb' : '#1e293b',
            color: '#fff', fontWeight: 600, fontSize: 13, textTransform: 'capitalize'
          }}>
            {v === 'both' ? '⬛ Side by Side' : v === 'passenger' ? '👤 Passenger' : '🚌 Driver'}
          </button>
        ))}
      </div>

      {/* App views */}
      <div style={{
        display: 'flex',
        gap: 16,
        padding: 16,
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        {(view === 'passenger' || view === 'both') && (
          <div style={{ width: 390, border: '2px solid #2563eb', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ background: '#2563eb', color: '#fff', textAlign: 'center', padding: '6px', fontSize: 13, fontWeight: 600 }}>
              👤 PASSENGER VIEW
            </div>
            <PassengerApp />
          </div>
        )}
        {(view === 'driver' || view === 'both') && (
          <div style={{ width: 390, border: '2px solid #0d9488', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ background: '#0d9488', color: '#fff', textAlign: 'center', padding: '6px', fontSize: 13, fontWeight: 600 }}>
              🚌 DRIVER VIEW
            </div>
            <DriverApp />
          </div>
        )}
      </div>
    </div>
  )
}