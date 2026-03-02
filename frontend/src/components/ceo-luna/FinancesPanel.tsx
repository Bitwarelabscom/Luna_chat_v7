'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Loader2, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useCEOLunaStore } from '@/lib/ceo-luna-store';
import { formatMoneyPrecise } from '@/lib/format-currency';
import { useLocaleStore } from '@/lib/locale-store';
import type { FinanceCreatePayload, FinanceUpdatePayload, FinanceEntry } from '@/lib/api/ceo';

type EntryFilter = 'all' | 'expense' | 'income' | 'owner_pay';

const FILTERS: Array<{ id: EntryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'expense', label: 'Expenses' },
  { id: 'income', label: 'Income' },
  { id: 'owner_pay', label: 'Owner Pay' },
];

const PERIODS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: 'All', value: 3650 },
];

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  expense:   { bg: 'bg-red-900/40', text: 'text-red-400', label: 'Expense' },
  income:    { bg: 'bg-emerald-900/40', text: 'text-emerald-400', label: 'Income' },
  owner_pay: { bg: 'bg-blue-900/40', text: 'text-blue-400', label: 'Owner Pay' },
};

const CADENCE_OPTIONS = ['one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

function Field({
  label, value, onChange, type = 'text', placeholder, required, className,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full bg-gray-800 text-gray-200 text-sm rounded px-2 py-1 border border-gray-700 focus:border-slate-500 focus:outline-none placeholder-gray-600"
      />
    </div>
  );
}

function Select({
  label, value, onChange, options, className,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 text-gray-200 text-sm rounded px-2 py-1 border border-gray-700 focus:border-slate-500 focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

export function FinancesPanel() {
  const {
    financeEntries, financesTotal, isLoadingFinances,
    financeFilter, financePeriod,
    loadFinances, setFinanceFilter, setFinancePeriod,
    createFinance, updateFinance, deleteFinance,
  } = useCEOLunaStore();

  const currency = useLocaleStore((s) => s.currency);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Add form
  const [addForm, setAddForm] = useState({
    entryType: 'expense' as FinanceCreatePayload['entryType'],
    vendor: '', amount: '', category: '', cadence: 'one_time', notes: '', date: '',
  });

  // Edit form
  const [editForm, setEditForm] = useState({
    vendor: '', amount: '', category: '', cadence: '', notes: '', occurredOn: '', entryType: '' as string,
  });

  useEffect(() => {
    loadFinances();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!addForm.vendor || !addForm.amount) {
      setError('Vendor and amount are required');
      return;
    }
    try {
      await createFinance({
        entryType: addForm.entryType,
        vendor: addForm.vendor,
        amount: parseFloat(addForm.amount),
        currency,
        category: addForm.category || undefined,
        cadence: addForm.cadence || undefined,
        notes: addForm.notes || undefined,
        date: addForm.date || undefined,
      });
      setAddForm({ entryType: 'expense', vendor: '', amount: '', category: '', cadence: 'one_time', notes: '', date: '' });
      setShowAdd(false);
    } catch {
      setError('Failed to create entry');
    }
  };

  const startEdit = (entry: FinanceEntry) => {
    setEditingId(entry.id);
    setEditForm({
      vendor: entry.vendor,
      amount: String(entry.amount),
      category: entry.category,
      cadence: entry.cadence,
      notes: entry.notes || '',
      occurredOn: entry.occurredOn,
      entryType: entry.entryType,
    });
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    try {
      const updates: FinanceUpdatePayload = {};
      if (editForm.vendor) updates.vendor = editForm.vendor;
      if (editForm.amount) updates.amount = parseFloat(editForm.amount);
      if (editForm.category) updates.category = editForm.category;
      if (editForm.cadence) updates.cadence = editForm.cadence;
      if (editForm.notes !== undefined) updates.notes = editForm.notes;
      if (editForm.occurredOn) updates.occurredOn = editForm.occurredOn;
      if (editForm.entryType) updates.entryType = editForm.entryType as FinanceUpdatePayload['entryType'];
      await updateFinance(editingId, updates);
      setEditingId(null);
    } catch {
      setError('Failed to update entry');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFinance(id);
      setDeleteConfirmId(null);
    } catch {
      setError('Failed to delete entry');
    }
  };

  // Totals
  const expenseSum = financeEntries.filter((e) => e.entryType === 'expense').reduce((s, e) => s + e.amount, 0);
  const incomeSum = financeEntries.filter((e) => e.entryType === 'income').reduce((s, e) => s + e.amount, 0);
  const ownerPaySum = financeEntries.filter((e) => e.entryType === 'owner_pay').reduce((s, e) => s + e.amount, 0);

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-300">Finances</span>
          {isLoadingFinances && <Loader2 size={12} className="text-gray-500 animate-spin" />}
          <span className="text-xs text-gray-500">({financesTotal} entries)</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex gap-1">
            {PERIODS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setFinancePeriod(value)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  financePeriod === value
                    ? 'bg-slate-700 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => loadFinances()} className="p-1 text-gray-500 hover:text-gray-300 transition-colors">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
          >
            {showAdd ? <ChevronUp size={12} /> : <Plus size={12} />}
            Add
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1 px-4 py-2 border-b border-gray-800 shrink-0">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFinanceFilter(id)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              financeFilter === id
                ? 'bg-slate-700 text-white'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Summary strip */}
      <div className="flex gap-4 px-4 py-2 border-b border-gray-800 text-xs shrink-0">
        <span className="text-red-400">Expenses: {formatMoneyPrecise(expenseSum)}</span>
        <span className="text-emerald-400">Income: {formatMoneyPrecise(incomeSum)}</span>
        <span className="text-blue-400">Owner Pay: {formatMoneyPrecise(ownerPaySum)}</span>
        <span className="text-gray-400">Net: {formatMoneyPrecise(incomeSum + ownerPaySum - expenseSum)}</span>
      </div>

      {/* Add form (collapsible) */}
      {showAdd && (
        <form onSubmit={handleAdd} className="px-4 py-3 border-b border-gray-800 bg-gray-900/50 shrink-0">
          <div className="grid grid-cols-6 gap-2">
            <Select
              label="Type"
              value={addForm.entryType}
              onChange={(v) => setAddForm((p) => ({ ...p, entryType: v as FinanceCreatePayload['entryType'] }))}
              options={[
                { value: 'expense', label: 'Expense' },
                { value: 'income', label: 'Income' },
                { value: 'owner_pay', label: 'Owner Pay' },
              ]}
            />
            <Field label="Vendor" value={addForm.vendor} onChange={(v) => setAddForm((p) => ({ ...p, vendor: v }))} placeholder="e.g. AWS" required />
            <Field label="Amount" value={addForm.amount} onChange={(v) => setAddForm((p) => ({ ...p, amount: v }))} type="number" placeholder="0.00" required />
            <Field label="Category" value={addForm.category} onChange={(v) => setAddForm((p) => ({ ...p, category: v }))} placeholder="e.g. hosting" />
            <Select
              label="Cadence"
              value={addForm.cadence}
              onChange={(v) => setAddForm((p) => ({ ...p, cadence: v }))}
              options={CADENCE_OPTIONS.map((c) => ({ value: c, label: c.replace('_', ' ') }))}
            />
            <Field label="Date" value={addForm.date} onChange={(v) => setAddForm((p) => ({ ...p, date: v }))} type="date" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={addForm.notes}
              onChange={(e) => setAddForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Notes (optional)"
              className="flex-1 bg-gray-800 text-gray-200 text-sm rounded px-2 py-1 border border-gray-700 focus:border-slate-500 focus:outline-none placeholder-gray-600"
            />
            <button type="submit" className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors">
              Save
            </button>
          </div>
          {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
        </form>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-900 z-10">
            <tr className="text-gray-500 text-xs border-b border-gray-800">
              <th className="text-left px-4 py-2 font-medium">Date</th>
              <th className="text-left px-2 py-2 font-medium">Type</th>
              <th className="text-left px-2 py-2 font-medium">Vendor</th>
              <th className="text-right px-2 py-2 font-medium">Amount</th>
              <th className="text-left px-2 py-2 font-medium">Category</th>
              <th className="text-left px-2 py-2 font-medium">Cadence</th>
              <th className="text-left px-2 py-2 font-medium">Notes</th>
              <th className="text-right px-4 py-2 font-medium w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {financeEntries.map((entry) => {
              const style = TYPE_STYLES[entry.entryType] || TYPE_STYLES.expense;

              if (editingId === entry.id) {
                return (
                  <tr key={entry.id} className="border-b border-gray-800 bg-gray-900/30">
                    <td className="px-4 py-1">
                      <input type="date" value={editForm.occurredOn} onChange={(e) => setEditForm((p) => ({ ...p, occurredOn: e.target.value }))}
                        className="bg-gray-800 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-700 w-full" />
                    </td>
                    <td className="px-2 py-1">
                      <select value={editForm.entryType} onChange={(e) => setEditForm((p) => ({ ...p, entryType: e.target.value }))}
                        className="bg-gray-800 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-700">
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                        <option value="owner_pay">Owner Pay</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input value={editForm.vendor} onChange={(e) => setEditForm((p) => ({ ...p, vendor: e.target.value }))}
                        className="bg-gray-800 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-700 w-full" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={editForm.amount} onChange={(e) => setEditForm((p) => ({ ...p, amount: e.target.value }))}
                        className="bg-gray-800 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-700 w-full text-right" />
                    </td>
                    <td className="px-2 py-1">
                      <input value={editForm.category} onChange={(e) => setEditForm((p) => ({ ...p, category: e.target.value }))}
                        className="bg-gray-800 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-700 w-full" />
                    </td>
                    <td className="px-2 py-1">
                      <select value={editForm.cadence} onChange={(e) => setEditForm((p) => ({ ...p, cadence: e.target.value }))}
                        className="bg-gray-800 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-700">
                        {CADENCE_OPTIONS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input value={editForm.notes} onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                        className="bg-gray-800 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-700 w-full" />
                    </td>
                    <td className="px-4 py-1 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={handleUpdate} className="p-1 text-emerald-500 hover:text-emerald-400"><Check size={12} /></button>
                        <button onClick={() => setEditingId(null)} className="p-1 text-gray-500 hover:text-gray-300"><X size={12} /></button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={entry.id} className="border-b border-gray-800 hover:bg-gray-900/30 transition-colors">
                  <td className="px-4 py-1.5 text-gray-400 text-xs">{entry.occurredOn}</td>
                  <td className="px-2 py-1.5">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${style.bg} ${style.text}`}>
                      {style.label}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-200">{entry.vendor}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-gray-200">{formatMoneyPrecise(entry.amount)}</td>
                  <td className="px-2 py-1.5 text-gray-400 text-xs">{entry.category}</td>
                  <td className="px-2 py-1.5 text-gray-400 text-xs">{entry.cadence.replace('_', ' ')}</td>
                  <td className="px-2 py-1.5 text-gray-500 text-xs truncate max-w-[150px]">{entry.notes || '-'}</td>
                  <td className="px-4 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => startEdit(entry)} className="p-1 text-gray-500 hover:text-gray-300 transition-colors">
                        <Pencil size={12} />
                      </button>
                      {deleteConfirmId === entry.id ? (
                        <>
                          <button onClick={() => handleDelete(entry.id)} className="p-1 text-red-500 hover:text-red-400"><Check size={12} /></button>
                          <button onClick={() => setDeleteConfirmId(null)} className="p-1 text-gray-500 hover:text-gray-300"><X size={12} /></button>
                        </>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(entry.id)} className="p-1 text-gray-500 hover:text-red-400 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {financeEntries.length === 0 && !isLoadingFinances && (
          <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
            No finance entries found
          </div>
        )}
      </div>
    </div>
  );
}
