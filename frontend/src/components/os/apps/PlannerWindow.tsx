'use client';

import { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  Filter,
  Grid3x3,
  List,
} from 'lucide-react';
import { plannerApi, type ExecutionProject, type ExecutionStep, type ExecutionEvent } from '@/lib/planner-api';

export default function PlannerWindow() {
  const [projects, setProjects] = useState<ExecutionProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<ExecutionProject | null>(null);
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [executionLog, setExecutionLog] = useState<ExecutionEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');
  const [loading, setLoading] = useState(true);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, [statusFilter]);

  // Load project details when selected
  useEffect(() => {
    if (selectedProject) {
      loadProjectDetails(selectedProject.id);
    }
  }, [selectedProject]);

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [eventSource]);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const params = statusFilter !== 'all' ? { status: statusFilter } : undefined;
      const data = await plannerApi.listProjects(params);
      setProjects(data.projects);

      // Auto-select first project if none selected
      if (!selectedProject && data.projects.length > 0) {
        setSelectedProject(data.projects[0]);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectDetails = async (projectId: string) => {
    try {
      const data = await plannerApi.getProject(projectId);
      setSteps(data.steps);
    } catch (error) {
      console.error('Failed to load project details:', error);
    }
  };

  const handleExecute = async () => {
    if (!selectedProject) return;

    try {
      // Close existing event source
      if (eventSource) {
        eventSource.close();
      }

      // Create new event source for SSE
      const es = plannerApi.executeProject(selectedProject.id);

      es.onmessage = (event) => {
        const executionEvent: ExecutionEvent = JSON.parse(event.data);
        setExecutionLog((prev) => [...prev, executionEvent]);

        // Update project status in real-time
        if (executionEvent.type === 'execution_started') {
          setSelectedProject((prev) => prev ? { ...prev, status: 'executing' } : null);
        } else if (executionEvent.type === 'execution_completed') {
          setSelectedProject((prev) => prev ? { ...prev, status: 'completed' } : null);
        } else if (executionEvent.type === 'execution_failed') {
          setSelectedProject((prev) => prev ? { ...prev, status: 'failed' } : null);
        }

        // Update step status
        if (executionEvent.stepId) {
          setSteps((prev) =>
            prev.map((step) =>
              step.id === executionEvent.stepId
                ? { ...step, status: getStepStatusFromEvent(executionEvent.type) as any }
                : step
            )
          );
        }

        // Reload project details on step completion
        if (executionEvent.type === 'step_completed' || executionEvent.type === 'step_failed') {
          loadProjectDetails(selectedProject.id);
        }
      };

      es.onerror = (error) => {
        console.error('SSE error:', error);
        es.close();
      };

      setEventSource(es);
    } catch (error) {
      console.error('Failed to execute project:', error);
    }
  };

  const handlePause = async () => {
    if (!selectedProject) return;

    try {
      await plannerApi.pauseProject(selectedProject.id);
      setSelectedProject((prev) => prev ? { ...prev, status: 'paused' } : null);
      if (eventSource) {
        eventSource.close();
        setEventSource(null);
      }
    } catch (error) {
      console.error('Failed to pause project:', error);
    }
  };

  const getStepStatusFromEvent = (eventType: string): string => {
    switch (eventType) {
      case 'step_started':
        return 'in_progress';
      case 'step_completed':
        return 'done';
      case 'step_failed':
        return 'failed';
      case 'awaiting_approval':
        return 'awaiting_approval';
      default:
        return 'pending';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed':
      case 'done':
        return 'text-green-500';
      case 'executing':
      case 'in_progress':
        return 'text-yellow-500';
      case 'failed':
        return 'text-red-500';
      case 'paused':
      case 'awaiting_approval':
        return 'text-orange-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'done':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'executing':
      case 'in_progress':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'failed':
        return <XCircle className="w-4 h-4" />;
      case 'paused':
      case 'awaiting_approval':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  return (
    <div className="flex h-full bg-gray-900 text-white">
      {/* Left Panel: Project List */}
      <div className="w-64 border-r border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold mb-3">Projects</h2>

          {/* Filter */}
          <div className="flex gap-1">
            {['all', 'ready', 'executing', 'completed', 'failed'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-2 py-1 text-xs rounded ${
                  statusFilter === status
                    ? 'bg-indigo-600'
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Project List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : projects.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 text-center">
              No projects found
            </div>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                onClick={() => setSelectedProject(project)}
                className={`w-full p-3 text-left border-b border-gray-700 hover:bg-gray-800 transition-colors ${
                  selectedProject?.id === project.id ? 'bg-gray-800' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{project.name}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {project.completedSteps}/{project.totalSteps} steps
                    </div>
                  </div>
                  <div className={`ml-2 ${getStatusColor(project.status)}`}>
                    {getStatusIcon(project.status)}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Center Panel: Graph/Steps View */}
      <div className="flex-1 flex flex-col">
        {selectedProject ? (
          <>
            {/* Toolbar */}
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selectedProject.name}</h2>
                <div className="text-sm text-gray-400 mt-1">
                  {selectedProject.description || `${selectedProject.projectType} project`}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* View Toggle */}
                <div className="flex gap-1 mr-4">
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 rounded ${
                      viewMode === 'list' ? 'bg-indigo-600' : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('graph')}
                    className={`p-2 rounded ${
                      viewMode === 'graph' ? 'bg-indigo-600' : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    <Grid3x3 className="w-4 h-4" />
                  </button>
                </div>

                {/* Execute/Pause Button */}
                {selectedProject.status === 'executing' ? (
                  <button
                    onClick={handlePause}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded flex items-center gap-2"
                  >
                    <Pause className="w-4 h-4" />
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={handleExecute}
                    disabled={selectedProject.status === 'completed'}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="w-4 h-4" />
                    Execute
                  </button>
                )}

                <button
                  onClick={() => loadProjectDetails(selectedProject.id)}
                  className="p-2 bg-gray-700 hover:bg-gray-600 rounded"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Steps View */}
            <div className="flex-1 overflow-y-auto p-4">
              {viewMode === 'list' ? (
                <div className="space-y-2">
                  {steps.map((step) => (
                    <div
                      key={step.id}
                      className="p-4 bg-gray-800 rounded-lg border border-gray-700"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <div className={`${getStatusColor(step.status)}`}>
                              {getStatusIcon(step.status)}
                            </div>
                            <div>
                              <div className="font-medium">
                                Step {step.stepNumber}: {step.goal}
                              </div>
                              <div className="text-sm text-gray-400 mt-1">
                                Action: {step.action}
                                {step.artifact && ` • Artifact: ${step.artifact}`}
                                {step.agentName && ` • Agent: ${step.agentName}`}
                              </div>
                            </div>
                          </div>

                          {step.errorMessage && (
                            <div className="mt-2 p-2 bg-red-900/20 border border-red-700 rounded text-sm text-red-400">
                              {step.errorMessage}
                              {step.retryCount > 0 && (
                                <span className="ml-2">
                                  (Retry {step.retryCount}/{step.maxRetries})
                                </span>
                              )}
                            </div>
                          )}

                          {step.executionTimeMs && (
                            <div className="mt-2 text-xs text-gray-500">
                              Execution time: {step.executionTimeMs}ms
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <div className="text-center">
                    <Grid3x3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <div>Graph view coming soon</div>
                    <div className="text-sm mt-1">
                      DAG visualization with D3.js/Cytoscape
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <Filter className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <div>Select a project to view details</div>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel: Execution Log */}
      <div className="w-80 border-l border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold">Execution Log</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {executionLog.length === 0 ? (
            <div className="text-sm text-gray-400 text-center mt-8">
              No execution events yet
            </div>
          ) : (
            <div className="space-y-3">
              {executionLog.map((event, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border ${
                    event.type.includes('failed')
                      ? 'bg-red-900/20 border-red-700'
                      : event.type.includes('completed')
                      ? 'bg-green-900/20 border-green-700'
                      : event.type.includes('approval')
                      ? 'bg-orange-900/20 border-orange-700'
                      : 'bg-gray-800 border-gray-700'
                  }`}
                >
                  <div className="text-xs text-gray-400 mb-1">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </div>
                  <div className="text-sm">{event.message}</div>
                  {event.stepNumber && (
                    <div className="text-xs text-gray-500 mt-1">
                      Step {event.stepNumber}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
