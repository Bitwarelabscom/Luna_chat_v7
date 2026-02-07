'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { plannerApi } from '@/lib/planner-api';

interface ApprovalMessageProps {
  approvalId: string;
  projectId: string;
  stepNumber: number;
  action: string;
  goal: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  changeType: 'structural' | 'iterative' | 'irreversible';
  affectedFiles: string[];
  onApprove?: () => void;
  onReject?: () => void;
}

export default function ApprovalMessage({
  approvalId,
  projectId: _projectId,
  stepNumber,
  action,
  goal,
  riskLevel,
  changeType,
  affectedFiles,
  onApprove,
  onReject,
}: ApprovalMessageProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [showFiles, setShowFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setLoading(true);
    setError(null);

    try {
      await plannerApi.approveStep(approvalId);
      setStatus('approved');
      onApprove?.();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to approve step');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setError(null);

    try {
      await plannerApi.rejectStep(approvalId);
      setStatus('rejected');
      onReject?.();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to reject step');
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (): string => {
    switch (riskLevel) {
      case 'critical':
        return 'border-red-500 bg-red-900/20';
      case 'high':
        return 'border-orange-500 bg-orange-900/20';
      case 'medium':
        return 'border-yellow-500 bg-yellow-900/20';
      case 'low':
        return 'border-blue-500 bg-blue-900/20';
    }
  };

  const getRiskBadgeColor = (): string => {
    switch (riskLevel) {
      case 'critical':
        return 'bg-red-600 text-white';
      case 'high':
        return 'bg-orange-600 text-white';
      case 'medium':
        return 'bg-yellow-600 text-black';
      case 'low':
        return 'bg-blue-600 text-white';
    }
  };

  const getChangeTypeLabel = (): string => {
    switch (changeType) {
      case 'structural':
        return 'Structural Change';
      case 'iterative':
        return 'Iterative Change';
      case 'irreversible':
        return 'Irreversible Action';
    }
  };

  if (status === 'approved') {
    return (
      <div className="p-4 rounded-lg border border-green-500 bg-green-900/20">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-500" />
          <div>
            <div className="font-medium text-green-500">Step Approved</div>
            <div className="text-sm text-gray-300 mt-1">
              Step {stepNumber}: {goal}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="p-4 rounded-lg border border-red-500 bg-red-900/20">
        <div className="flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-500" />
          <div>
            <div className="font-medium text-red-500">Step Rejected</div>
            <div className="text-sm text-gray-300 mt-1">
              Step {stepNumber}: {goal}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-lg border-l-4 ${getRiskColor()}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-orange-500 mt-1" />

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="font-semibold text-white">Approval Required</div>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getRiskBadgeColor()}`}>
              {riskLevel.toUpperCase()}
            </span>
            <span className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300">
              {getChangeTypeLabel()}
            </span>
          </div>

          <div className="text-sm text-gray-300 mb-3">
            <div className="font-medium mb-1">Step {stepNumber}: {goal}</div>
            <div className="text-gray-400">Action: {action}</div>
          </div>

          {/* Affected Files */}
          {affectedFiles.length > 0 && (
            <div className="mb-3">
              <button
                onClick={() => setShowFiles(!showFiles)}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-300"
              >
                {showFiles ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                Affected files ({affectedFiles.length})
              </button>

              {showFiles && (
                <div className="mt-2 pl-5 space-y-1">
                  {affectedFiles.map((file, index) => (
                    <div key={index} className="text-xs font-mono text-gray-400">
                      {file}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleApprove}
              disabled={loading}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-wait rounded text-sm font-medium transition-colors"
            >
              {loading ? 'Processing...' : 'Approve'}
            </button>

            <button
              onClick={handleReject}
              disabled={loading}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-wait rounded text-sm font-medium transition-colors"
            >
              {loading ? 'Processing...' : 'Reject'}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mt-3 p-2 bg-red-900/40 border border-red-700 rounded text-sm text-red-400">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
