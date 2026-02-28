'use client';

import { useEffect, useState } from 'react';
import { Loader2, Play, CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';
import type { OrgTask, DepartmentSlug } from '@/lib/api/ceo';

const DEPT_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'economy', label: 'Economy' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'development', label: 'Development' },
  { id: 'research', label: 'Research' },
];

const DEPT_COLORS: Record<DepartmentSlug, { bg: string; text: string; border: string }> = {
  economy: { bg: 'bg-emerald-900/30', text: 'text-emerald-400', border: 'border-emerald-700' },
  marketing: { bg: 'bg-purple-900/30', text: 'text-purple-400', border: 'border-purple-700' },
  development: { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-700' },
  research: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-700' },
};

const STATUS_BADGES: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-yellow-900/40', text: 'text-yellow-400' },
  in_progress: { bg: 'bg-blue-900/40', text: 'text-blue-400' },
  done: { bg: 'bg-emerald-900/40', text: 'text-emerald-400' },
  approved: { bg: 'bg-emerald-900/40', text: 'text-emerald-400' },
  rejected: { bg: 'bg-red-900/40', text: 'text-red-400' },
};

export function OrgPanel() {
  const {
    orgDepartments, orgTasks, orgGoals, orgProposals, orgActions,
    isLoadingOrg, orgDeptFilter, loadOrgOverview, setOrgDeptFilter,
    approveOrgTask, rejectOrgTask: rejectTask,
    updateOrgAction, approveOrgProposal, rejectOrgProposal,
  } = useCEOLunaStore();

  const [isRunningWeekly, setIsRunningWeekly] = useState(false);
  const [isRunningDaily, setIsRunningDaily] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    goals: true,
    departments: true,
    approval: true,
    tasks: true,
    actions: true,
    proposals: false,
  });

  useEffect(() => {
    loadOrgOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgDeptFilter]);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleRunWeekly = async () => {
    setIsRunningWeekly(true);
    try {
      const { triggerWeeklyPlan } = await import('@/lib/api/ceo');
      await triggerWeeklyPlan();
      await loadOrgOverview();
    } catch (err) {
      console.error('Weekly plan trigger failed:', err);
    } finally {
      setIsRunningWeekly(false);
    }
  };

  const handleRunDaily = async () => {
    setIsRunningDaily(true);
    try {
      const { triggerDailyCheck } = await import('@/lib/api/ceo');
      await triggerDailyCheck();
      await loadOrgOverview();
    } catch (err) {
      console.error('Daily check trigger failed:', err);
    } finally {
      setIsRunningDaily(false);
    }
  };

  const filteredTasks = orgDeptFilter === 'all'
    ? orgTasks
    : orgTasks.filter((t) => t.departmentSlug === orgDeptFilter);

  const highRiskPending = filteredTasks.filter((t) => t.status === 'pending' && t.riskLevel === 'high');
  const taskLog = filteredTasks.filter((t) => !(t.status === 'pending' && t.riskLevel === 'high'));

  const SectionHeader = ({ label, sectionKey, count }: { label: string; sectionKey: string; count?: number }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="flex items-center gap-2 w-full text-left text-sm font-medium text-gray-300 hover:text-white py-1"
    >
      {expandedSections[sectionKey] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      {label}
      {count !== undefined && <span className="text-gray-500 text-xs">({count})</span>}
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden">
      {/* Filter tabs + action buttons */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 bg-gray-900 shrink-0 flex-wrap">
        <div className="flex items-center gap-1">
          {DEPT_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setOrgDeptFilter(id)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                orgDeptFilter === id
                  ? 'bg-slate-700 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={handleRunWeekly}
          disabled={isRunningWeekly}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-indigo-900/50 text-indigo-300 hover:bg-indigo-800/60 disabled:opacity-50"
        >
          {isRunningWeekly ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Run Weekly
        </button>
        <button
          onClick={handleRunDaily}
          disabled={isRunningDaily}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-slate-700/60 text-slate-300 hover:bg-slate-600/60 disabled:opacity-50"
        >
          {isRunningDaily ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Run Daily
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {isLoadingOrg && orgDepartments.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading organization...
          </div>
        ) : (
          <>
            {/* Weekly Goals */}
            <div>
              <SectionHeader label="Weekly Goals" sectionKey="goals" count={orgGoals.length} />
              {expandedSections.goals && (
                <div className="mt-2 space-y-2">
                  {orgGoals.length === 0 ? (
                    <p className="text-xs text-gray-500 pl-5">No goals this week. Run weekly planning to create them.</p>
                  ) : (
                    orgGoals.map((goal) => {
                      const colors = DEPT_COLORS[goal.departmentSlug];
                      return (
                        <div key={goal.id} className={`p-2.5 rounded border ${colors.border} ${colors.bg}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-medium ${colors.text}`}>
                              {goal.departmentSlug.charAt(0).toUpperCase() + goal.departmentSlug.slice(1)}
                            </span>
                            <span className="text-xs text-gray-400">{goal.progressPct}%</span>
                          </div>
                          <p className="text-sm text-gray-200">{goal.goalText}</p>
                          <div className="mt-1.5 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                goal.progressPct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'
                              }`}
                              style={{ width: `${Math.min(100, goal.progressPct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Department Cards */}
            <div>
              <SectionHeader label="Departments" sectionKey="departments" count={orgDepartments.length} />
              {expandedSections.departments && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {orgDepartments.map((dept) => {
                    const colors = DEPT_COLORS[dept.slug];
                    return (
                      <div
                        key={dept.slug}
                        className={`p-3 rounded border ${colors.border} ${colors.bg} cursor-pointer hover:brightness-110`}
                        onClick={() => setOrgDeptFilter(dept.slug)}
                      >
                        <div className={`text-sm font-medium ${colors.text}`}>{dept.name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{dept.persona}</div>
                        <div className="flex gap-3 mt-2 text-xs">
                          <span className="text-yellow-400">{dept.pendingTasks} pending</span>
                          <span className="text-emerald-400">{dept.doneTasks} done</span>
                          {dept.highRiskPending > 0 && (
                            <span className="text-red-400">{dept.highRiskPending} high-risk</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Approval Queue */}
            {highRiskPending.length > 0 && (
              <div>
                <SectionHeader label="Approval Queue" sectionKey="approval" count={highRiskPending.length} />
                {expandedSections.approval && (
                  <div className="mt-2 space-y-2">
                    {highRiskPending.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onApprove={() => approveOrgTask(task.id)}
                        onReject={() => rejectTask(task.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Task Log */}
            <div>
              <SectionHeader label="Task Log" sectionKey="tasks" count={taskLog.length} />
              {expandedSections.tasks && (
                <div className="mt-2 space-y-1.5">
                  {taskLog.length === 0 ? (
                    <p className="text-xs text-gray-500 pl-5">No tasks yet.</p>
                  ) : (
                    taskLog.slice(0, 30).map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Recommended Actions */}
            <div>
              <SectionHeader label="Recommended Actions" sectionKey="actions" count={orgActions.length} />
              {expandedSections.actions && (
                <div className="mt-2 space-y-1.5">
                  {orgActions.length === 0 ? (
                    <p className="text-xs text-gray-500 pl-5">No pending actions.</p>
                  ) : (
                    orgActions.map((action) => {
                      const colors = DEPT_COLORS[action.departmentSlug];
                      return (
                        <div key={action.id} className="flex items-start gap-2 p-2 rounded bg-gray-900 border border-gray-800">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
                                {action.departmentSlug}
                              </span>
                              <span className="text-xs text-gray-500">P{action.priority}</span>
                              {action.category && <span className="text-xs text-gray-500">{action.category}</span>}
                            </div>
                            <p className="text-sm text-gray-200 mt-0.5">{action.title}</p>
                            {action.description && (
                              <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{action.description}</p>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => updateOrgAction(action.id, 'done')}
                              className="p-1 rounded text-emerald-400 hover:bg-emerald-900/30"
                              title="Mark done"
                            >
                              <CheckCircle size={14} />
                            </button>
                            <button
                              onClick={() => updateOrgAction(action.id, 'dismissed')}
                              className="p-1 rounded text-gray-400 hover:bg-gray-800"
                              title="Dismiss"
                            >
                              <XCircle size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Ability Proposals */}
            <div>
              <SectionHeader label="Ability Proposals" sectionKey="proposals" count={orgProposals.length} />
              {expandedSections.proposals && (
                <div className="mt-2 space-y-1.5">
                  {orgProposals.length === 0 ? (
                    <p className="text-xs text-gray-500 pl-5">No pending proposals.</p>
                  ) : (
                    orgProposals.map((proposal) => {
                      const colors = DEPT_COLORS[proposal.departmentSlug];
                      return (
                        <div key={proposal.id} className="flex items-start gap-2 p-2 rounded bg-gray-900 border border-gray-800">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
                                {proposal.departmentSlug}
                              </span>
                              {proposal.estimatedEffort && (
                                <span className="text-xs text-gray-500">{proposal.estimatedEffort}</span>
                              )}
                            </div>
                            <p className="text-sm text-gray-200 mt-0.5">{proposal.title}</p>
                            {proposal.rationale && (
                              <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{proposal.rationale}</p>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => approveOrgProposal(proposal.id)}
                              className="p-1 rounded text-emerald-400 hover:bg-emerald-900/30"
                              title="Approve"
                            >
                              <CheckCircle size={14} />
                            </button>
                            <button
                              onClick={() => rejectOrgProposal(proposal.id)}
                              className="p-1 rounded text-red-400 hover:bg-red-900/30"
                              title="Reject"
                            >
                              <XCircle size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, onApprove, onReject }: { task: OrgTask; onApprove: () => void; onReject: () => void }) {
  const colors = DEPT_COLORS[task.departmentSlug];
  return (
    <div className={`p-3 rounded border ${colors.border} ${colors.bg}`}>
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={14} className="text-red-400" />
        <span className={`text-xs font-medium ${colors.text}`}>{task.departmentSlug}</span>
        <span className="text-xs text-gray-500">P{task.priority}</span>
        <span className="text-xs text-red-400 ml-auto">HIGH RISK</span>
      </div>
      <p className="text-sm text-gray-200 font-medium">{task.title}</p>
      {task.description && <p className="text-xs text-gray-400 mt-1 line-clamp-3">{task.description}</p>}
      <div className="flex gap-2 mt-2">
        <button
          onClick={onApprove}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60"
        >
          <CheckCircle size={12} /> Approve
        </button>
        <button
          onClick={onReject}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-red-900/50 text-red-300 hover:bg-red-800/60"
        >
          <XCircle size={12} /> Reject
        </button>
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: OrgTask }) {
  const colors = DEPT_COLORS[task.departmentSlug];
  const statusStyle = STATUS_BADGES[task.status] || STATUS_BADGES.pending;
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-900/60 border border-gray-800/50 text-xs">
      <span className={`px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} shrink-0`}>
        {task.departmentSlug.slice(0, 3)}
      </span>
      <span className={`px-1.5 py-0.5 rounded ${statusStyle.bg} ${statusStyle.text} shrink-0`}>
        {task.status.replace('_', ' ')}
      </span>
      <span className="text-gray-300 truncate flex-1">{task.title}</span>
      <span className="text-gray-500 shrink-0">P{task.priority}</span>
      {task.source !== 'manual' && <span className="text-gray-600 shrink-0">{task.source}</span>}
    </div>
  );
}
