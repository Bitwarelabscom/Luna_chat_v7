'use client';

import { useState } from 'react';
import { RefreshCw, FolderOpen, FileMusic, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { useDJLunaStore } from '@/lib/dj-luna-store';

interface NewSongFormProps {
  onClose: () => void;
}

function NewSongForm({ onClose }: NewSongFormProps) {
  const { newSong, projects } = useDJLunaStore();
  const [title, setTitle] = useState('');
  const [project, setProject] = useState(projects[0]?.name || '');
  const [newProject, setNewProject] = useState('');
  const [useNewProject, setUseNewProject] = useState(projects.length === 0);

  const handleSubmit = () => {
    const finalProject = useNewProject ? newProject.trim() : project;
    if (!title.trim() || !finalProject) return;
    newSong(title.trim(), finalProject);
    onClose();
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 mx-2 mb-2">
      <div className="text-xs font-semibold text-purple-300 mb-2">New Song</div>
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose(); }}
        placeholder="Song title..."
        className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-purple-500 focus:outline-none mb-2"
      />
      {!useNewProject && projects.length > 0 ? (
        <select
          value={project}
          onChange={(e) => {
            if (e.target.value === '__new__') setUseNewProject(true);
            else setProject(e.target.value);
          }}
          className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-purple-500 focus:outline-none mb-2"
        >
          {projects.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
          <option value="__new__">+ New project...</option>
        </select>
      ) : (
        <input
          type="text"
          value={newProject}
          onChange={(e) => setNewProject(e.target.value)}
          placeholder="Project/album name..."
          className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-purple-500 focus:outline-none mb-2"
        />
      )}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!title.trim() || (!project && !newProject.trim())}
          className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs rounded transition-colors"
        >
          Create
        </button>
        <button onClick={onClose} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SongList() {
  const { projects, currentSong, loadSong, loadSongList, isLoadingSongs, canvasDirty } = useDJLunaStore();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(projects.map((p) => p.name)));
  const [showNewSong, setShowNewSong] = useState(false);

  const handleSongClick = async (path: string) => {
    if (canvasDirty) {
      const confirmed = confirm('You have unsaved changes. Load this song anyway?');
      if (!confirmed) return;
    }
    await loadSong(path);
  };

  const toggleProject = (name: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Songs</span>
        <div className="flex gap-1">
          <button
            onClick={() => setShowNewSong((v) => !v)}
            className="p-1 text-gray-400 hover:text-purple-300 hover:bg-gray-800 rounded transition-colors"
            title="New song"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => loadSongList()}
            disabled={isLoadingSongs}
            className="p-1 text-gray-400 hover:text-purple-300 hover:bg-gray-800 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={isLoadingSongs ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {showNewSong && <NewSongForm onClose={() => setShowNewSong(false)} />}

      {/* Song tree */}
      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-xs">
            No songs yet - ask DJ Luna to help write one!
          </div>
        ) : (
          projects.map((project) => {
            const isExpanded = expandedProjects.has(project.name);
            return (
              <div key={project.name}>
                <button
                  onClick={() => toggleProject(project.name)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800 text-left transition-colors"
                >
                  {isExpanded ? <ChevronDown size={12} className="text-gray-400 shrink-0" /> : <ChevronRight size={12} className="text-gray-400 shrink-0" />}
                  <FolderOpen size={13} className="text-purple-400 shrink-0" />
                  <span className="text-xs text-gray-300 font-medium truncate">{project.name}</span>
                  <span className="ml-auto text-gray-600 text-xs">{project.songs.length}</span>
                </button>
                {isExpanded && project.songs.map((song) => {
                  const isActive = currentSong?.path === song.path;
                  return (
                    <button
                      key={song.path}
                      onClick={() => handleSongClick(song.path)}
                      className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 hover:bg-gray-800 text-left transition-colors ${
                        isActive ? 'bg-purple-900/30 border-l-2 border-purple-500' : ''
                      }`}
                    >
                      <FileMusic size={12} className={isActive ? 'text-purple-400 shrink-0' : 'text-gray-500 shrink-0'} />
                      <span className={`text-xs truncate ${isActive ? 'text-purple-300' : 'text-gray-400'}`}>
                        {song.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
