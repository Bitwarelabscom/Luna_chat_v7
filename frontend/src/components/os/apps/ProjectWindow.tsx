'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, RefreshCw, Pause,
  FileText, Image as ImageIcon, Code, Eye,
  ChevronRight, Trash2, AlertCircle, CheckCircle2,
  Clock, Circle
} from 'lucide-react';
import { projectsApi, Project, ProjectFile } from '@/lib/api';

type StepStatus = 'pending' | 'active' | 'waiting_input' | 'complete' | 'completed' | 'error' | 'skipped';

function getStepIcon(stepType: string) {
  switch (stepType) {
    case 'generate_file':
      return <FileText className="w-4 h-4" />;
    case 'generate_image':
      return <ImageIcon className="w-4 h-4" />;
    case 'execute':
      return <Code className="w-4 h-4" />;
    case 'preview':
      return <Eye className="w-4 h-4" />;
    default:
      return <Circle className="w-4 h-4" />;
  }
}

function getStatusIcon(status: StepStatus) {
  switch (status) {
    case 'completed':
    case 'complete':
      return <CheckCircle2 className="w-4 h-4 text-green-400" />;
    case 'active':
      return <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />;
    case 'waiting_input':
      return <Clock className="w-4 h-4 text-yellow-400" />;
    case 'error':
      return <AlertCircle className="w-4 h-4 text-red-400" />;
    case 'skipped':
      return <ChevronRight className="w-4 h-4 text-gray-400" />;
    default:
      return <Circle className="w-4 h-4" style={{ color: 'var(--theme-text-muted)' }} />;
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'complete':
      return 'bg-green-500/20 text-green-400';
    case 'building':
      return 'bg-blue-500/20 text-blue-400';
    case 'paused':
      return 'bg-yellow-500/20 text-yellow-400';
    case 'questioning':
      return 'bg-purple-500/20 text-purple-400';
    case 'error':
      return 'bg-red-500/20 text-red-400';
    default:
      return 'bg-gray-500/20 text-gray-400';
  }
}

export default function ProjectWindow() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<ProjectFile[]>([]);

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const data = await projectsApi.list();
      setProjects(data.projects || []);

      // If there's an active project, select it
      const active = data.projects?.find((p: Project) =>
        p.status === 'building' || p.status === 'questioning' || p.status === 'paused'
      );
      if (active) {
        setSelectedProject(active);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjectFiles = useCallback(async (projectId: string) => {
    try {
      const data = await projectsApi.getFiles(projectId);
      setFiles(data.files || []);
    } catch (error) {
      console.error('Failed to load project files:', error);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (selectedProject) {
      loadProjectFiles(selectedProject.id);
    }
  }, [selectedProject, loadProjectFiles]);

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await projectsApi.delete(id);
      if (selectedProject?.id === id) {
        setSelectedProject(null);
      }
      await loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <FolderOpen className="w-5 h-5" style={{ color: 'var(--theme-accent-primary)' }} />
          <span className="font-medium" style={{ color: 'var(--theme-text-primary)' }}>Projects</span>
        </div>
        <button
          onClick={loadProjects}
          disabled={loading}
          className="p-1.5 rounded transition hover:bg-[var(--theme-bg-tertiary)]"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Project List */}
        <div
          className="w-64 border-r overflow-auto"
          style={{ borderColor: 'var(--theme-border-default)' }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
              <FolderOpen className="w-12 h-12 mb-2 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>No projects yet</p>
              <p className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                Ask Luna to create a website or app to get started
              </p>
            </div>
          ) : (
            <div className="p-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => setSelectedProject(project)}
                  className={`p-3 rounded cursor-pointer transition mb-1 ${
                    selectedProject?.id === project.id
                      ? 'bg-[var(--theme-accent-primary)]/20'
                      : 'hover:bg-[var(--theme-bg-tertiary)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--theme-text-primary)' }}>
                      {project.name}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusColor(project.status)}`}>
                      {project.status}
                    </span>
                  </div>
                  <p className="text-xs mt-1 truncate" style={{ color: 'var(--theme-text-muted)' }}>
                    {project.description || 'No description'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                    {formatDate(project.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Project Details */}
        <div className="flex-1 overflow-auto">
          {selectedProject ? (
            <div className="p-4">
              {/* Project Header */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
                    {selectedProject.name}
                  </h2>
                  <button
                    onClick={() => handleDeleteProject(selectedProject.id)}
                    className="p-1.5 rounded hover:bg-red-500/20 transition"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
                  {selectedProject.description || 'No description'}
                </p>
                <div className="flex items-center gap-4 mt-2">
                  <span className={`text-xs px-2 py-1 rounded ${getStatusColor(selectedProject.status)}`}>
                    {selectedProject.status}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                    Type: {selectedProject.type}
                  </span>
                </div>
              </div>

              {/* Questions (if in questioning state) */}
              {selectedProject.status === 'questioning' && selectedProject.questions && (
                <div className="mb-4 p-4 rounded-lg" style={{ background: 'var(--theme-bg-tertiary)' }}>
                  <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--theme-text-primary)' }}>
                    Questions
                  </h3>
                  <ul className="space-y-2">
                    {selectedProject.questions.map((q, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--theme-accent-primary)]/20 text-[var(--theme-accent-primary)]">
                          {i + 1}
                        </span>
                        <span className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>
                          {q.question}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs mt-3" style={{ color: 'var(--theme-text-muted)' }}>
                    Answer these questions in the chat to continue
                  </p>
                </div>
              )}

              {/* Steps */}
              {selectedProject.plan && selectedProject.plan.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--theme-text-primary)' }}>
                    Build Steps
                  </h3>
                  <div className="space-y-2">
                    {selectedProject.plan.map((step, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 p-3 rounded-lg"
                        style={{ background: 'var(--theme-bg-tertiary)' }}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {getStatusIcon(step.status as StepStatus)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {getStepIcon(step.stepType)}
                            <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                              Step {step.stepNumber}
                            </span>
                            {step.filename && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--theme-bg-secondary)]" style={{ color: 'var(--theme-text-muted)' }}>
                                {step.filename}
                              </span>
                            )}
                          </div>
                          <p className="text-sm mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                            {step.description}
                          </p>
                          {step.error && (
                            <p className="text-xs mt-1 text-red-400">
                              Error: {step.error}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Files */}
              {files.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--theme-text-primary)' }}>
                    Generated Files
                  </h3>
                  <div className="grid gap-2">
                    {files.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center gap-3 p-3 rounded-lg"
                        style={{ background: 'var(--theme-bg-tertiary)' }}
                      >
                        <FileText className="w-5 h-5" style={{ color: 'var(--theme-accent-primary)' }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate" style={{ color: 'var(--theme-text-primary)' }}>
                            {file.filename}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                            {file.fileType} - {formatDate(file.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Help text for empty states */}
              {selectedProject.status === 'planning' && (
                <div className="text-center py-8">
                  <Clock className="w-12 h-12 mx-auto mb-2 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
                    Project is being planned...
                  </p>
                </div>
              )}

              {selectedProject.status === 'paused' && (
                <div className="text-center py-8">
                  <Pause className="w-12 h-12 mx-auto mb-2 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
                    Project paused - say &quot;continue&quot; in chat to resume
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
              <ChevronRight className="w-12 h-12 mb-2 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
                Select a project to view details
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
