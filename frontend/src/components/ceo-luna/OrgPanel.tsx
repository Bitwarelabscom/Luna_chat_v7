'use client';

import { useEffect, useState } from 'react';
import { Loader2, Play, CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronUp, CheckCheck, X, Plus, FileText } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';
import type { OrgTask, DepartmentSlug, CeoProposal, CeoMemo } from '@/lib/api/ceo';

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

const URGENCY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  p1: { bg: 'bg-red-900/50', text: 'text-red-400', label: 'P1' },
  p2: { bg: 'bg-orange-900/50', text: 'text-orange-400', label: 'P2' },
  normal: { bg: 'bg-gray-800', text: 'text-gray-400', label: 'Normal' },
};

const TYPE_LABELS: Record<string, string> = {
  weekly_plan: 'Weekly Plan',
  task: 'Task',
  goal: 'Goal',
  action: 'Action',
  department_task: 'Dept Task',
};

export function OrgPanel() {
  const {
    orgTasks, orgGoals, orgActions,
    isLoadingOrg, orgDeptFilter, loadOrgOverview, setOrgDeptFilter,
    approveOrgTask: approveTask, rejectOrgTask: rejectTask,
    updateOrgAction, approveOrgProposal, rejectOrgProposal,
    ceoProposals, isLoadingProposals, loadCeoProposals,
    approveCeoProposal, rejectCeoProposal, batchDecideProposals,
    orgMemos, isLoadingMemos, loadMemos,
    runningTasks, recentlyCompletedTasks, startTask, pollRunningTasks, startTaskPolling, stopTaskPolling,
    createOrgTask,
  } = useCEOLunaStore();

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    running: true,
    pendingProposals: true,
    createTask: false,
    tasks: true,
    memos: true,
    goals: true,
    actions: false,
  });

  // Create task form
  const [newTaskDept, setNewTaskDept] = useState<DepartmentSlug>('development');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState(5);
  const [isCreating, setIsCreating] = useState(false);

  // Expanded results
  const [expandedResult, setExpandedResult] = useState<string | null>(null);

  useEffect(() => {
    loadOrgOverview();
    loadCeoProposals();
    loadMemos(orgDeptFilter);
    pollRunningTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgDeptFilter]);

  // Start/stop polling based on running tasks
  useEffect(() => {
    if (runningTasks.length > 0) {
      startTaskPolling();
    }
    return () => { stopTaskPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) return;
    setIsCreating(true);
    try {
      await createOrgTask({
        departmentSlug: newTaskDept,
        title: newTaskTitle.trim(),
        description: newTaskDesc.trim() || undefined,
        priority: newTaskPriority,
      });
      setNewTaskTitle('');
      setNewTaskDesc('');
      setNewTaskPriority(5);
      setExpandedSections(prev => ({ ...prev, createTask: false }));
    } finally {
      setIsCreating(false);
    }
  };

  const filteredTasks = orgDeptFilter === 'all'
    ? orgTasks
    : orgTasks.filter((t) => t.departmentSlug === orgDeptFilter);

  const SectionHeader = ({ label, sectionKey, count, right }: { label: string; sectionKey: string; count?: number; right?: React.ReactNode }) => (
    <div className="flex items-center gap-2 w-full">
      <button
        onClick={() => toggleSection(sectionKey)}
        className="flex items-center gap-2 flex-1 text-left text-sm font-medium text-gray-300 hover:text-white py-1"
      >
        {expandedSections[sectionKey] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {label}
        {count !== undefined && <span className="text-gray-500 text-xs">({count})</span>}
      </button>
      {right}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden">
      {/* Filter tabs */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 bg-gray-900 shrink-0">
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
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {isLoadingOrg && orgTasks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading organization...
          </div>
        ) : (
          <>
            {/* Running Tasks Strip */}
            {(runningTasks.length > 0 || recentlyCompletedTasks.length > 0) && (
              <div>
                <SectionHeader label="Running Tasks" sectionKey="running" count={runningTasks.length} />
                {expandedSections.running && (
                  <div className="mt-2 space-y-1.5">
                    {runningTasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-2 px-3 py-2 rounded bg-blue-950/30 border border-blue-800/50 animate-pulse">
                        <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />
                        <span className="text-sm text-blue-300 truncate flex-1">{task.title}</span>
                        <DeptBadge dept={task.departmentSlug} />
                      </div>
                    ))}
                    {recentlyCompletedTasks.map((task) => (
                      <div key={task.id} className={`flex items-center gap-2 px-3 py-2 rounded border ${
                        task.executionStatus === 'completed' ? 'bg-emerald-950/20 border-emerald-800/50' : 'bg-red-950/20 border-red-800/50'
                      }`}>
                        {task.executionStatus === 'completed'
                          ? <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                          : <XCircle size={14} className="text-red-400 shrink-0" />}
                        <span className="text-sm text-gray-300 truncate flex-1">{task.title}</span>
                        <DeptBadge dept={task.departmentSlug} />
                        {task.executionStatus === 'completed' && task.resultSummary && (
                          <button
                            onClick={() => setExpandedResult(expandedResult === task.id ? null : task.id)}
                            className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0"
                          >
                            {expandedResult === task.id ? 'Hide' : 'Result'}
                          </button>
                        )}
                      </div>
                    ))}
                    {expandedResult && (() => {
                      const task = recentlyCompletedTasks.find(t => t.id === expandedResult);
                      return task?.resultSummary ? (
                        <div className="px-3 py-2 text-xs text-gray-400 bg-gray-900 rounded border border-gray-800">
                          {task.resultSummary}
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Pending Proposals */}
            {(ceoProposals.length > 0 || isLoadingProposals) && (
              <div>
                <SectionHeader label="Pending Proposals" sectionKey="pendingProposals" count={ceoProposals.length} />
                {expandedSections.pendingProposals && (
                  <div className="mt-2 space-y-2">
                    {isLoadingProposals ? (
                      <div className="flex items-center text-gray-500 text-xs py-2">
                        <Loader2 size={12} className="animate-spin mr-2" /> Loading...
                      </div>
                    ) : (
                      <>
                        {ceoProposals.length > 1 && (
                          <div className="flex gap-2 mb-2">
                            <button
                              onClick={() => batchDecideProposals('approve')}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60"
                            >
                              <CheckCheck size={12} /> Approve All ({ceoProposals.length})
                            </button>
                            <button
                              onClick={() => batchDecideProposals('reject')}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-red-900/50 text-red-300 hover:bg-red-800/60"
                            >
                              <X size={12} /> Reject All
                            </button>
                          </div>
                        )}
                        {ceoProposals.map((proposal) => (
                          <ProposalCard
                            key={proposal.id}
                            proposal={proposal}
                            onApprove={() => approveCeoProposal(proposal.id)}
                            onReject={() => rejectCeoProposal(proposal.id)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Create Task Form */}
            <div>
              <SectionHeader
                label="Create Task"
                sectionKey="createTask"
                right={
                  !expandedSections.createTask ? (
                    <button
                      onClick={() => setExpandedSections(prev => ({ ...prev, createTask: true }))}
                      className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
                    >
                      <Plus size={14} />
                    </button>
                  ) : undefined
                }
              />
              {expandedSections.createTask && (
                <div className="mt-2 p-3 rounded border border-gray-700 bg-gray-900 space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={newTaskDept}
                      onChange={(e) => setNewTaskDept(e.target.value as DepartmentSlug)}
                      className="px-2 py-1.5 text-xs rounded bg-gray-800 border border-gray-700 text-gray-300"
                    >
                      <option value="economy">Economy</option>
                      <option value="marketing">Marketing</option>
                      <option value="development">Development</option>
                      <option value="research">Research</option>
                    </select>
                    <select
                      value={newTaskPriority}
                      onChange={(e) => setNewTaskPriority(Number(e.target.value))}
                      className="px-2 py-1.5 text-xs rounded bg-gray-800 border border-gray-700 text-gray-300 w-20"
                    >
                      {[1,2,3,4,5,6,7,8,9,10].map(p => (
                        <option key={p} value={p}>P{p}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    placeholder="Task title..."
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm rounded bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-500"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTask(); }}
                  />
                  <textarea
                    placeholder="Description (optional)..."
                    value={newTaskDesc}
                    onChange={(e) => setNewTaskDesc(e.target.value)}
                    rows={2}
                    className="w-full px-2 py-1.5 text-xs rounded bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-500 resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateTask}
                      disabled={!newTaskTitle.trim() || isCreating}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-indigo-900/50 text-indigo-300 hover:bg-indigo-800/60 disabled:opacity-50"
                    >
                      {isCreating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      Create
                    </button>
                    <button
                      onClick={() => setExpandedSections(prev => ({ ...prev, createTask: false }))}
                      className="px-3 py-1.5 text-xs rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Task List */}
            <div>
              <SectionHeader label="Tasks" sectionKey="tasks" count={filteredTasks.length} />
              {expandedSections.tasks && (
                <div className="mt-2 space-y-1.5">
                  {filteredTasks.length === 0 ? (
                    <p className="text-xs text-gray-500 pl-5">No tasks.</p>
                  ) : (
                    filteredTasks.slice(0, 50).map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onStart={() => startTask(task.id)}
                        onApprove={() => approveTask(task.id)}
                        onReject={() => rejectTask(task.id)}
                        expandedResult={expandedResult}
                        onToggleResult={(id) => setExpandedResult(expandedResult === id ? null : id)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Recent Memos */}
            <div>
              <SectionHeader label="Recent Memos" sectionKey="memos" count={orgMemos.length} />
              {expandedSections.memos && (
                <div className="mt-2 space-y-1.5">
                  {isLoadingMemos ? (
                    <div className="flex items-center text-gray-500 text-xs py-2">
                      <Loader2 size={12} className="animate-spin mr-2" /> Loading...
                    </div>
                  ) : orgMemos.length === 0 ? (
                    <p className="text-xs text-gray-500 pl-5">No memos yet.</p>
                  ) : (
                    orgMemos.map((memo) => (
                      <MemoCard key={memo.id} memo={memo} />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Weekly Goals */}
            <div>
              <SectionHeader label="Weekly Goals" sectionKey="goals" count={orgGoals.length} />
              {expandedSections.goals && (
                <div className="mt-2 space-y-2">
                  {orgGoals.length === 0 ? (
                    <p className="text-xs text-gray-500 pl-5">No goals this week. Discuss planning in chat.</p>
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

            {/* Recommended Actions */}
            <div>
              <SectionHeader label="Actions" sectionKey="actions" count={orgActions.length} />
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
                            </div>
                            <p className="text-sm text-gray-200 mt-0.5">{action.title}</p>
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
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function DeptBadge({ dept }: { dept: DepartmentSlug }) {
  const colors = DEPT_COLORS[dept];
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} shrink-0`}>
      {dept.slice(0, 3)}
    </span>
  );
}

function TaskCard({
  task,
  onStart,
  onApprove,
  onReject,
  expandedResult,
  onToggleResult,
}: {
  task: OrgTask;
  onStart: () => void;
  onApprove: () => void;
  onReject: () => void;
  expandedResult: string | null;
  onToggleResult: (id: string) => void;
}) {
  const colors = DEPT_COLORS[task.departmentSlug];
  const statusStyle = STATUS_BADGES[task.status] || STATUS_BADGES.pending;
  const isRunning = task.executionStatus === 'running';
  const isCompleted = task.executionStatus === 'completed';
  const isFailed = task.executionStatus === 'failed';
  const canStart = (task.status === 'pending' || task.status === 'approved') && !task.executionStatus;
  const isHighRisk = task.status === 'pending' && task.riskLevel === 'high';

  return (
    <div className={`p-2.5 rounded border ${
      isHighRisk ? `${colors.border} ${colors.bg}` : 'border-gray-800 bg-gray-900/60'
    }`}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <DeptBadge dept={task.departmentSlug} />
        <span className={`text-xs px-1.5 py-0.5 rounded ${statusStyle.bg} ${statusStyle.text}`}>
          {task.status.replace('_', ' ')}
        </span>
        {isRunning && (
          <span className="flex items-center gap-1 text-xs text-blue-400">
            <Loader2 size={10} className="animate-spin" /> Running
          </span>
        )}
        {isCompleted && <span className="text-xs text-emerald-400">Done</span>}
        {isFailed && <span className="text-xs text-red-400">Failed</span>}
        {isHighRisk && <AlertTriangle size={12} className="text-red-400" />}
        <span className="text-xs text-gray-500 ml-auto">P{task.priority}</span>
        {task.suggestedBy && task.suggestedBy !== 'manual' && (
          <span className="text-xs text-gray-600">{task.suggestedBy}</span>
        )}
      </div>
      <p className="text-sm text-gray-200">{task.title}</p>
      {task.description && (
        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{task.description}</p>
      )}
      <div className="flex items-center gap-2 mt-1.5">
        {canStart && (
          <button
            onClick={onStart}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60"
          >
            <Play size={11} /> Start
          </button>
        )}
        {isHighRisk && (
          <>
            <button
              onClick={onApprove}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60"
            >
              <CheckCircle size={11} /> Approve
            </button>
            <button
              onClick={onReject}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-900/50 text-red-300 hover:bg-red-800/60"
            >
              <XCircle size={11} /> Reject
            </button>
          </>
        )}
        {(isCompleted || isFailed) && task.resultSummary && (
          <button
            onClick={() => onToggleResult(task.id)}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            {expandedResult === task.id ? 'Hide result' : 'View result'}
          </button>
        )}
      </div>
      {expandedResult === task.id && task.resultSummary && (
        <div className="mt-2 px-2 py-1.5 text-xs text-gray-400 bg-gray-800 rounded border border-gray-700">
          {task.resultSummary}
        </div>
      )}
    </div>
  );
}

function MemoCard({ memo }: { memo: CeoMemo }) {
  const deptColors = memo.departmentSlug !== 'ceo' ? DEPT_COLORS[memo.departmentSlug as DepartmentSlug] : null;
  const typeColors: Record<string, string> = {
    decision: 'text-purple-400',
    insight: 'text-cyan-400',
    status_update: 'text-gray-400',
    task_result: 'text-emerald-400',
  };

  return (
    <div className="flex items-start gap-2 px-2 py-2 rounded bg-gray-900/60 border border-gray-800/50">
      <FileText size={14} className={typeColors[memo.memoType] || 'text-gray-500'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          {deptColors && (
            <span className={`px-1 py-0.5 rounded ${deptColors.bg} ${deptColors.text}`}>
              {memo.departmentSlug}
            </span>
          )}
          <span className={typeColors[memo.memoType] || 'text-gray-500'}>
            {memo.memoType.replace('_', ' ')}
          </span>
          <span className="text-gray-600 ml-auto">
            {new Date(memo.createdAt).toLocaleDateString('sv-SE')}
          </span>
        </div>
        <p className="text-sm text-gray-200 mt-0.5">{memo.title}</p>
        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{memo.content}</p>
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  onApprove,
  onReject,
}: {
  proposal: CeoProposal;
  onApprove: () => void;
  onReject: () => void;
}) {
  const deptColors = proposal.departmentSlug
    ? DEPT_COLORS[proposal.departmentSlug as DepartmentSlug]
    : null;
  const urgencyStyle = URGENCY_STYLES[proposal.urgency] || URGENCY_STYLES.normal;
  const typeLabel = TYPE_LABELS[proposal.proposalType] || proposal.proposalType;

  return (
    <div className={`p-3 rounded border ${
      proposal.urgency === 'p1' ? 'border-red-700 bg-red-950/20' :
      proposal.urgency === 'p2' ? 'border-orange-700 bg-orange-950/20' :
      'border-gray-700 bg-gray-900'
    }`}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className={`text-xs px-1.5 py-0.5 rounded ${urgencyStyle.bg} ${urgencyStyle.text} font-medium`}>
          {urgencyStyle.label}
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-400">
          {typeLabel}
        </span>
        {deptColors && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${deptColors.bg} ${deptColors.text}`}>
            {proposal.departmentSlug}
          </span>
        )}
        <span className="text-xs text-gray-500 ml-auto">P{proposal.priority}</span>
      </div>
      <p className="text-sm text-gray-200 font-medium">{proposal.title}</p>
      {proposal.description && (
        <p className="text-xs text-gray-400 mt-1 line-clamp-3">{proposal.description}</p>
      )}
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
