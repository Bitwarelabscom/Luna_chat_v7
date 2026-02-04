'use client';

import React, { useState } from 'react';
import type { Session } from '@/lib/api';

interface MobileSessionsOverlayProps {
  sessions: Session[];
  currentSession: Session | null;
  isLoading: boolean;
  isOpen: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: (mode: 'assistant' | 'companion' | 'voice' | 'dj_luna') => void;
  onClose: () => void;
}

export default function MobileSessionsOverlay({
  sessions,
  currentSession,
  isLoading,
  isOpen,
  onSelect,
  onDelete,
  onCreate,
  onClose,
}: MobileSessionsOverlayProps) {
  const [showModeSelector, setShowModeSelector] = useState(false);

  const handleCreate = (mode: 'assistant' | 'companion' | 'voice' | 'dj_luna') => {
    onCreate(mode);
    setShowModeSelector(false);
    onClose();
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 90,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
        }}
      />

      {/* Slide-in panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: '280px',
        maxWidth: '85vw',
        background: 'linear-gradient(180deg, #151d28 0%, #0d1520 100%)',
        borderRight: '1px solid #2a3545',
        zIndex: 91,
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s ease',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {/* Header with close button */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid #2a3545',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{
            color: '#607080',
            fontSize: '12px',
            letterSpacing: '2px',
          }}>
            SESSIONS
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#607080',
              cursor: 'pointer',
              fontSize: '20px',
              padding: '4px 8px',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* New session button */}
        <div style={{ padding: '12px', position: 'relative' }}>
          <button
            onClick={() => setShowModeSelector(!showModeSelector)}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #00ff9f20, #00ff9f10)',
              border: '1px solid #00ff9f50',
              color: '#00ff9f',
              padding: '12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontFamily: 'inherit',
              fontWeight: 500,
            }}
          >
            + NEW SESSION
          </button>

          {/* Mode selector dropdown */}
          {showModeSelector && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '12px',
              right: '12px',
              background: '#1a2535',
              border: '1px solid #00ff9f30',
              borderRadius: '6px',
              marginTop: '4px',
              zIndex: 100,
              overflow: 'hidden',
            }}>
              <button
                onClick={() => handleCreate('assistant')}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: '#a0c0ff',
                  padding: '14px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                }}
              >
                <strong style={{ display: 'block', marginBottom: '4px' }}>Assistant</strong>
                <span style={{ color: '#607080', fontSize: '11px' }}>Task-focused help</span>
              </button>
              <button
                onClick={() => handleCreate('companion')}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderTop: '1px solid #2a3545',
                  color: '#ff80c0',
                  padding: '14px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                }}
              >
                <strong style={{ display: 'block', marginBottom: '4px' }}>Companion</strong>
                <span style={{ color: '#607080', fontSize: '11px' }}>Friendly conversation</span>
              </button>
              <button
                onClick={() => handleCreate('voice')}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderTop: '1px solid #2a3545',
                  color: '#00ff9f',
                  padding: '14px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                }}
              >
                <strong style={{ display: 'block', marginBottom: '4px' }}>Voice</strong>
                <span style={{ color: '#607080', fontSize: '11px' }}>Talk with Luna</span>
              </button>
              <button
                onClick={() => handleCreate('dj_luna')}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderTop: '1px solid #2a3545',
                  color: '#facc15',
                  padding: '14px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                }}
              >
                <strong style={{ display: 'block', marginBottom: '4px' }}>DJ Luna</strong>
                <span style={{ color: '#607080', fontSize: '11px' }}>Suno Music Gen</span>
              </button>
            </div>
          )}
        </div>

        {/* Sessions list - scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
          {isLoading ? (
            <div style={{
              color: '#607080',
              textAlign: 'center',
              padding: '30px 20px',
              fontSize: '12px',
            }}>
              Loading sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{
              color: '#607080',
              textAlign: 'center',
              padding: '30px 20px',
              fontSize: '12px',
            }}>
              No sessions yet
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => handleSelect(session.id)}
                style={{
                  padding: '12px',
                  background: currentSession?.id === session.id ? '#1a2535' : 'transparent',
                  borderLeft: currentSession?.id === session.id ? '3px solid #00ff9f' : '3px solid transparent',
                  cursor: 'pointer',
                  marginBottom: '4px',
                  borderRadius: '0 6px 6px 0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  minHeight: '44px',
                }}
              >
                <div style={{ flex: 1, overflow: 'hidden', marginRight: '8px' }}>
                  <span style={{
                    fontSize: '12px',
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: currentSession?.id === session.id ? '#00ff9f' : '#c0c8d0',
                  }}>
                    {session.title}
                  </span>
                  <span style={{
                    fontSize: '10px',
                    color: '#607080',
                    marginTop: '2px',
                    display: 'block',
                  }}>
                    {session.mode}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session.id);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ff6b6b',
                    cursor: 'pointer',
                    padding: '8px',
                    fontSize: '14px',
                    minWidth: '32px',
                    minHeight: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
