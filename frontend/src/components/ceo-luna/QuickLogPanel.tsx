'use client';

import { useState } from 'react';
import { Loader2, CheckCircle } from 'lucide-react';
import {
  logExpense,
  logIncome,
  logBuild,
  logExperiment,
  logLead,
  logProject,
} from '@/lib/api/ceo';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';

type LogTab = 'expense' | 'income' | 'build' | 'experiment' | 'lead' | 'project';
const LOG_TABS: LogTab[] = ['expense', 'income', 'build', 'experiment', 'lead', 'project'];

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-1.5 border border-gray-700 focus:border-slate-500 focus:outline-none placeholder-gray-600"
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-1.5 border border-gray-700 focus:border-slate-500 focus:outline-none placeholder-gray-600 resize-none"
      />
    </div>
  );
}

export function QuickLogPanel() {
  const { loadDashboard } = useCEOLunaStore();
  const [activeTab, setActiveTab] = useState<LogTab>('expense');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Form state - one per tab
  const [expenseForm, setExpenseForm] = useState({ vendor: '', amountUsd: '', category: '', notes: '' });
  const [incomeForm, setIncomeForm] = useState({ vendor: '', amountUsd: '', category: '', notes: '' });
  const [buildForm, setBuildForm] = useState({ projectKey: '', hours: '', item: '', stage: '' });
  const [experimentForm, setExperimentForm] = useState({ channel: '', name: '', costUsd: '', leads: '', outcome: '', notes: '' });
  const [leadForm, setLeadForm] = useState({ source: '', valueEstimateUsd: '', status: '', notes: '' });
  const [projectForm, setProjectForm] = useState({ projectKey: '', stage: '', revenuePotentialUsd: '', estimatedHours: '', notes: '' });

  const showSuccess = () => {
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
    loadDashboard();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      if (activeTab === 'expense') {
        if (!expenseForm.vendor || !expenseForm.amountUsd) throw new Error('Vendor and amount are required');
        await logExpense({ vendor: expenseForm.vendor, amountUsd: parseFloat(expenseForm.amountUsd), category: expenseForm.category || undefined, notes: expenseForm.notes || undefined });
        setExpenseForm({ vendor: '', amountUsd: '', category: '', notes: '' });
      } else if (activeTab === 'income') {
        if (!incomeForm.vendor || !incomeForm.amountUsd) throw new Error('Source and amount are required');
        await logIncome({ vendor: incomeForm.vendor, amountUsd: parseFloat(incomeForm.amountUsd), category: incomeForm.category || undefined, notes: incomeForm.notes || undefined });
        setIncomeForm({ vendor: '', amountUsd: '', category: '', notes: '' });
      } else if (activeTab === 'build') {
        if (!buildForm.projectKey || !buildForm.hours) throw new Error('Project and hours are required');
        await logBuild({ projectKey: buildForm.projectKey, hours: parseFloat(buildForm.hours), item: buildForm.item || undefined, stage: buildForm.stage || undefined });
        setBuildForm({ projectKey: '', hours: '', item: '', stage: '' });
      } else if (activeTab === 'experiment') {
        if (!experimentForm.channel || !experimentForm.name) throw new Error('Channel and name are required');
        await logExperiment({
          channel: experimentForm.channel,
          name: experimentForm.name,
          costUsd: experimentForm.costUsd ? parseFloat(experimentForm.costUsd) : undefined,
          leads: experimentForm.leads ? parseInt(experimentForm.leads) : undefined,
          outcome: experimentForm.outcome || undefined,
          notes: experimentForm.notes || undefined,
        });
        setExperimentForm({ channel: '', name: '', costUsd: '', leads: '', outcome: '', notes: '' });
      } else if (activeTab === 'lead') {
        if (!leadForm.source) throw new Error('Source is required');
        await logLead({
          source: leadForm.source,
          status: leadForm.status || undefined,
          valueEstimateUsd: leadForm.valueEstimateUsd ? parseFloat(leadForm.valueEstimateUsd) : undefined,
          notes: leadForm.notes || undefined,
        });
        setLeadForm({ source: '', valueEstimateUsd: '', status: '', notes: '' });
      } else if (activeTab === 'project') {
        if (!projectForm.projectKey) throw new Error('Project key is required');
        await logProject({
          projectKey: projectForm.projectKey,
          stage: projectForm.stage || undefined,
          revenuePotentialUsd: projectForm.revenuePotentialUsd ? parseFloat(projectForm.revenuePotentialUsd) : undefined,
          estimatedHours: projectForm.estimatedHours ? parseFloat(projectForm.estimatedHours) : undefined,
          notes: projectForm.notes || undefined,
        });
        setProjectForm({ projectKey: '', stage: '', revenuePotentialUsd: '', estimatedHours: '', notes: '' });
      }
      showSuccess();
    } catch (err) {
      setError((err as Error).message || 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 shrink-0">
        <span className="text-sm font-medium text-gray-300">Quick Log</span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-4 py-2 border-b border-gray-800 overflow-x-auto">
        {LOG_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setError(''); setSuccess(false); }}
            className={`shrink-0 px-3 py-1 text-xs rounded transition-colors capitalize ${
              activeTab === tab
                ? 'bg-slate-700 text-white'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <form onSubmit={handleSubmit} className="space-y-3 max-w-md">
          {activeTab === 'expense' && (
            <>
              <Field label="Vendor / Service" value={expenseForm.vendor} onChange={(v) => setExpenseForm((p) => ({ ...p, vendor: v }))} placeholder="e.g. AWS" required />
              <Field label="Amount (USD)" value={expenseForm.amountUsd} onChange={(v) => setExpenseForm((p) => ({ ...p, amountUsd: v }))} type="number" placeholder="0.00" required />
              <Field label="Category" value={expenseForm.category} onChange={(v) => setExpenseForm((p) => ({ ...p, category: v }))} placeholder="e.g. infrastructure" />
              <TextArea label="Notes" value={expenseForm.notes} onChange={(v) => setExpenseForm((p) => ({ ...p, notes: v }))} placeholder="Optional notes" />
            </>
          )}

          {activeTab === 'income' && (
            <>
              <Field label="Source" value={incomeForm.vendor} onChange={(v) => setIncomeForm((p) => ({ ...p, vendor: v }))} placeholder="e.g. Client payment" required />
              <Field label="Amount (USD)" value={incomeForm.amountUsd} onChange={(v) => setIncomeForm((p) => ({ ...p, amountUsd: v }))} type="number" placeholder="0.00" required />
              <Field label="Category" value={incomeForm.category} onChange={(v) => setIncomeForm((p) => ({ ...p, category: v }))} placeholder="e.g. consulting" />
              <TextArea label="Notes" value={incomeForm.notes} onChange={(v) => setIncomeForm((p) => ({ ...p, notes: v }))} />
            </>
          )}

          {activeTab === 'build' && (
            <>
              <Field label="Project Key" value={buildForm.projectKey} onChange={(v) => setBuildForm((p) => ({ ...p, projectKey: v }))} placeholder="e.g. luna-chat" required />
              <Field label="Hours" value={buildForm.hours} onChange={(v) => setBuildForm((p) => ({ ...p, hours: v }))} type="number" placeholder="2.5" required />
              <Field label="Work Item" value={buildForm.item} onChange={(v) => setBuildForm((p) => ({ ...p, item: v }))} placeholder="e.g. CEO window" />
              <Field label="Stage" value={buildForm.stage} onChange={(v) => setBuildForm((p) => ({ ...p, stage: v }))} placeholder="e.g. mvp" />
            </>
          )}

          {activeTab === 'experiment' && (
            <>
              <Field label="Channel" value={experimentForm.channel} onChange={(v) => setExperimentForm((p) => ({ ...p, channel: v }))} placeholder="e.g. linkedin" required />
              <Field label="Experiment Name" value={experimentForm.name} onChange={(v) => setExperimentForm((p) => ({ ...p, name: v }))} placeholder="e.g. Cold outreach batch 1" required />
              <Field label="Cost (USD)" value={experimentForm.costUsd} onChange={(v) => setExperimentForm((p) => ({ ...p, costUsd: v }))} type="number" placeholder="0" />
              <Field label="Leads" value={experimentForm.leads} onChange={(v) => setExperimentForm((p) => ({ ...p, leads: v }))} type="number" placeholder="0" />
              <Field label="Outcome" value={experimentForm.outcome} onChange={(v) => setExperimentForm((p) => ({ ...p, outcome: v }))} placeholder="e.g. positive" />
              <TextArea label="Notes" value={experimentForm.notes} onChange={(v) => setExperimentForm((p) => ({ ...p, notes: v }))} />
            </>
          )}

          {activeTab === 'lead' && (
            <>
              <Field label="Source" value={leadForm.source} onChange={(v) => setLeadForm((p) => ({ ...p, source: v }))} placeholder="e.g. linkedin" required />
              <Field label="Status" value={leadForm.status} onChange={(v) => setLeadForm((p) => ({ ...p, status: v }))} placeholder="e.g. contacted" />
              <Field label="Value Estimate (USD)" value={leadForm.valueEstimateUsd} onChange={(v) => setLeadForm((p) => ({ ...p, valueEstimateUsd: v }))} type="number" placeholder="0" />
              <TextArea label="Notes" value={leadForm.notes} onChange={(v) => setLeadForm((p) => ({ ...p, notes: v }))} />
            </>
          )}

          {activeTab === 'project' && (
            <>
              <Field label="Project Key" value={projectForm.projectKey} onChange={(v) => setProjectForm((p) => ({ ...p, projectKey: v }))} placeholder="e.g. luna-chat" required />
              <Field label="Stage" value={projectForm.stage} onChange={(v) => setProjectForm((p) => ({ ...p, stage: v }))} placeholder="e.g. mvp" />
              <Field label="Revenue Potential (USD)" value={projectForm.revenuePotentialUsd} onChange={(v) => setProjectForm((p) => ({ ...p, revenuePotentialUsd: v }))} type="number" placeholder="0" />
              <Field label="Estimated Hours" value={projectForm.estimatedHours} onChange={(v) => setProjectForm((p) => ({ ...p, estimatedHours: v }))} type="number" placeholder="0" />
              <TextArea label="Notes" value={projectForm.notes} onChange={(v) => setProjectForm((p) => ({ ...p, notes: v }))} />
            </>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800 rounded px-3 py-2">
              <CheckCircle size={12} />
              Logged successfully
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {isSubmitting ? 'Logging...' : `Log ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`}
          </button>
        </form>
      </div>
    </div>
  );
}
