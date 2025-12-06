'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CheckSquare, Square, Trash2, RefreshCw,
  Plus, Calendar, Flag, CheckCircle, PauseCircle, Play, Pencil, X
} from 'lucide-react';
import { tasksApi, Task } from '../../lib/api';

const statusConfig = {
  pending: { icon: Square, color: 'text-gray-400', bg: 'bg-gray-400/10', label: 'Not Started' },
  in_progress: { icon: Play, color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'In Progress' },
  completed: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-400/10', label: 'Complete' },
  cancelled: { icon: PauseCircle, color: 'text-orange-400', bg: 'bg-orange-400/10', label: 'Paused' },
};

const priorityConfig = {
  low: { color: 'text-gray-400', bg: 'bg-gray-400/10', label: 'Low' },
  medium: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Medium' },
  high: { color: 'text-red-400', bg: 'bg-red-400/10', label: 'High' },
};

export default function TasksTab() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('active');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium', dueDate: '' });
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', priority: 'medium', status: 'pending', dueDate: '' });

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await tasksApi.list();
      setTasks(res.tasks || []);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;

    try {
      await tasksApi.create({
        title: newTask.title,
        description: newTask.description || undefined,
        priority: newTask.priority,
        dueDate: newTask.dueDate || undefined,
      });
      setNewTask({ title: '', description: '', priority: 'medium', dueDate: '' });
      setShowCreateForm(false);
      await loadTasks();
    } catch (error) {
      console.error('Failed to create task:', error);
      alert('Failed to create task');
    }
  };

  const handleStatusChange = async (taskId: string, status: string) => {
    try {
      await tasksApi.updateStatus(taskId, status);
      await loadTasks();
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      await tasksApi.delete(taskId);
      await loadTasks();
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const startEditing = (task: Task) => {
    setEditingTask(task);
    setEditForm({
      title: task.title,
      description: task.description || '',
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '',
    });
  };

  const handleUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask || !editForm.title.trim()) return;

    try {
      // Update task details
      await tasksApi.update(editingTask.id, {
        title: editForm.title,
        description: editForm.description || undefined,
        priority: editForm.priority,
        dueDate: editForm.dueDate || undefined,
      });
      // Update status separately if changed
      if (editForm.status !== editingTask.status) {
        await tasksApi.updateStatus(editingTask.id, editForm.status);
      }
      setEditingTask(null);
      await loadTasks();
    } catch (error) {
      console.error('Failed to update task:', error);
      alert('Failed to update task');
    }
  };

  const filteredTasks = tasks.filter((task) => {
    if (filter === 'active') return task.status !== 'completed' && task.status !== 'cancelled';
    if (filter === 'completed') return task.status === 'completed';
    return true;
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { text: 'Overdue', color: 'text-red-400' };
    if (diffDays === 0) return { text: 'Today', color: 'text-yellow-400' };
    if (diffDays === 1) return { text: 'Tomorrow', color: 'text-yellow-400' };
    if (diffDays <= 7) return { text: `${diffDays} days`, color: 'text-theme-text-muted' };
    return {
      text: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      color: 'text-theme-text-muted',
    };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-theme-accent-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-theme-text-primary flex items-center gap-2">
          <CheckSquare className="w-5 h-5" />
          Todo
        </h3>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-3 py-1.5 text-sm bg-theme-accent-primary/10 text-theme-accent-primary rounded-lg hover:bg-theme-accent-primary/20 transition flex items-center gap-1"
        >
          <Plus className="w-4 h-4" />
          New Todo
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-theme-border">
        {(['active', 'completed', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium transition -mb-px capitalize ${
              filter === f
                ? 'text-theme-accent-primary border-b-2 border-theme-accent-primary'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            {f} ({tasks.filter(t => {
              if (f === 'active') return t.status !== 'completed' && t.status !== 'cancelled';
              if (f === 'completed') return t.status === 'completed';
              return true;
            }).length})
          </button>
        ))}
      </div>

      {/* Create Todo Form */}
      {showCreateForm && (
        <form onSubmit={handleCreateTask} className="p-4 bg-theme-bg-tertiary rounded-lg border border-theme-border space-y-4">
          <div>
            <input
              type="text"
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              placeholder="What needs to be done..."
              className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-theme-accent-primary"
              autoFocus
            />
          </div>
          <div>
            <textarea
              value={newTask.description}
              onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
              placeholder="Notes (optional)..."
              rows={2}
              className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-theme-accent-primary resize-none"
            />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm text-theme-text-muted mb-1">Priority</label>
              <select
                value={newTask.priority}
                onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-theme-accent-primary"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm text-theme-text-muted mb-1">Due Date</label>
              <input
                type="date"
                value={newTask.dueDate}
                onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-theme-accent-primary"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-theme-accent-primary text-white rounded-lg hover:bg-theme-accent-primary/90 transition"
            >
              Create Todo
            </button>
          </div>
        </form>
      )}

      {/* Edit Modal */}
      {editingTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary rounded-lg border border-theme-border w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-theme-border">
              <h3 className="text-lg font-medium text-theme-text-primary">Edit Todo</h3>
              <button
                onClick={() => setEditingTask(null)}
                className="text-theme-text-muted hover:text-theme-text-primary transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateTask} className="p-4 space-y-4">
              <div>
                <label className="block text-sm text-theme-text-muted mb-1">Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-theme-accent-primary"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-muted mb-1">Notes</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-theme-accent-primary resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-theme-text-muted mb-1">Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-theme-accent-primary"
                  >
                    <option value="pending">Not Started</option>
                    <option value="in_progress">In Progress</option>
                    <option value="cancelled">Paused</option>
                    <option value="completed">Complete</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-theme-text-muted mb-1">Priority</label>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-theme-accent-primary"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-theme-text-muted mb-1">Due Date</label>
                <input
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                  className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-theme-accent-primary"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm bg-theme-accent-primary text-white rounded-lg hover:bg-theme-accent-primary/90 transition"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Todo List */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-8 text-theme-text-muted">
          <CheckSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No {filter === 'all' ? '' : filter} todos</p>
          <p className="text-sm">Create a todo or ask Luna to add one</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((task) => {
            const status = statusConfig[task.status];
            const priority = priorityConfig[task.priority];
            const StatusIcon = status.icon;
            const dueInfo = formatDate(task.dueDate);

            return (
              <div
                key={task.id}
                className={`p-4 bg-theme-bg-tertiary rounded-lg border border-theme-border ${
                  task.status === 'completed' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Status Toggle */}
                    <button
                      onClick={() => handleStatusChange(
                        task.id,
                        task.status === 'completed' ? 'pending' : 'completed'
                      )}
                      className={`mt-0.5 ${status.color} hover:opacity-80 transition`}
                    >
                      <StatusIcon className="w-5 h-5" />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className={`font-medium ${task.status === 'completed' ? 'line-through text-theme-text-muted' : 'text-theme-text-primary'}`}>
                        {task.title}
                      </div>
                      {task.description && (
                        <div className="text-sm text-theme-text-muted mt-1">
                          {task.description}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {/* Status Badge */}
                        <span className={`text-xs px-2 py-0.5 rounded ${status.bg} ${status.color}`}>
                          {status.label}
                        </span>
                        {/* Priority Badge */}
                        <span className={`text-xs px-2 py-0.5 rounded ${priority.bg} ${priority.color}`}>
                          <Flag className="w-3 h-3 inline mr-1" />
                          {priority.label}
                        </span>
                        {/* Due Date */}
                        {dueInfo && (
                          <span className={`text-xs ${dueInfo.color} flex items-center gap-1`}>
                            <Calendar className="w-3 h-3" />
                            {dueInfo.text}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {task.status !== 'completed' && task.status !== 'in_progress' && (
                      <button
                        onClick={() => handleStatusChange(task.id, 'in_progress')}
                        className="p-1.5 text-theme-text-muted hover:text-blue-400 transition"
                        title="Start"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => startEditing(task)}
                      className="p-1.5 text-theme-text-muted hover:text-theme-accent-primary transition"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1.5 text-theme-text-muted hover:text-red-400 transition"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Refresh Button */}
      <div className="flex justify-center pt-4">
        <button
          onClick={loadTasks}
          disabled={loading}
          className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary transition flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
    </div>
  );
}
