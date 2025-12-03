'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, ExternalLink } from 'lucide-react';
import { autonomousApi } from '../lib/api';
import type { AutonomousQuestion } from '../lib/api';

interface QuestionNotificationProps {
  onOpenTheater?: () => void;
}

export default function QuestionNotification({ onOpenTheater }: QuestionNotificationProps) {
  const [questions, setQuestions] = useState<AutonomousQuestion[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [answeringQuestion, setAnsweringQuestion] = useState<string | null>(null);
  const [questionResponse, setQuestionResponse] = useState('');
  const [isDismissed, setIsDismissed] = useState(false);

  const loadQuestions = useCallback(async () => {
    try {
      const { questions: pendingQuestions } = await autonomousApi.getPendingQuestions();
      setQuestions(pendingQuestions || []);
      // Reset dismissed state if new questions arrive
      if (pendingQuestions && pendingQuestions.length > 0 && isDismissed) {
        setIsDismissed(false);
      }
    } catch {
      // Silently fail - questions API may not be available
    }
  }, [isDismissed]);

  // Poll for questions every 10 seconds
  useEffect(() => {
    loadQuestions();
    const interval = setInterval(loadQuestions, 10000);
    return () => clearInterval(interval);
  }, [loadQuestions]);

  const handleAnswerQuestion = async (questionId: string) => {
    if (!questionResponse.trim()) return;
    try {
      await autonomousApi.answerQuestion(questionId, questionResponse);
      setQuestionResponse('');
      setAnsweringQuestion(null);
      await loadQuestions();
    } catch (e) {
      console.error('Failed to answer question:', e);
    }
  };

  const handleDismissQuestion = async (questionId: string) => {
    try {
      await autonomousApi.dismissQuestion(questionId);
      await loadQuestions();
    } catch (e) {
      console.error('Failed to dismiss question:', e);
    }
  };

  // Don't render if no questions or dismissed
  if (questions.length === 0 || isDismissed) {
    return null;
  }

  const urgentQuestions = questions.filter(q => q.priority >= 8);
  const hasUrgent = urgentQuestions.length > 0;

  // Collapsed view - just a badge
  if (!isExpanded) {
    return (
      <div className="fixed bottom-24 right-6 z-40 animate-bounce-slow">
        <button
          onClick={() => setIsExpanded(true)}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg transition-all hover:scale-105 ${
            hasUrgent
              ? 'bg-gradient-to-r from-red-500 to-orange-500 text-white'
              : 'bg-gradient-to-r from-purple-500 to-blue-500 text-white'
          }`}
        >
          <MessageCircle className="w-5 h-5" />
          <span className="font-medium">
            Luna has {questions.length} question{questions.length !== 1 ? 's' : ''}
          </span>
          {hasUrgent && (
            <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
              {urgentQuestions.length} urgent
            </span>
          )}
        </button>
        <style jsx>{`
          @keyframes bounce-slow {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
          }
          .animate-bounce-slow {
            animation: bounce-slow 2s ease-in-out infinite;
          }
        `}</style>
      </div>
    );
  }

  // Expanded view - show questions
  return (
    <div className="fixed bottom-24 right-6 z-40 w-96 max-h-96 bg-theme-bg-secondary border border-theme-border rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${
        hasUrgent ? 'bg-red-500/20' : 'bg-purple-500/20'
      }`}>
        <div className="flex items-center gap-2">
          <MessageCircle className={`w-5 h-5 ${hasUrgent ? 'text-red-400' : 'text-purple-400'}`} />
          <span className="font-medium">Luna's Questions</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            hasUrgent ? 'bg-red-500/30 text-red-300' : 'bg-purple-500/30 text-purple-300'
          }`}>
            {questions.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onOpenTheater && (
            <button
              onClick={onOpenTheater}
              className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary rounded"
              title="Open Theater Mode"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary rounded"
            title="Minimize"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Questions List */}
      <div className="max-h-72 overflow-y-auto p-3 space-y-3">
        {questions.map((question) => (
          <div
            key={question.id}
            className={`bg-theme-bg-tertiary rounded-lg p-3 border-l-2 ${
              question.priority >= 8 ? 'border-red-400' : 'border-purple-400'
            }`}
          >
            {question.priority >= 8 && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-400/20 text-red-400 mb-2 inline-block">
                Urgent
              </span>
            )}
            <p className="text-sm mb-2">{question.question}</p>
            {question.context && (
              <p className="text-xs text-theme-text-muted mb-2 italic">{question.context}</p>
            )}

            {answeringQuestion === question.id ? (
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={questionResponse}
                  onChange={(e) => setQuestionResponse(e.target.value)}
                  placeholder="Type your response..."
                  className="flex-1 px-3 py-1.5 bg-theme-bg-primary border border-theme-border rounded text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleAnswerQuestion(question.id)}
                  autoFocus
                />
                <button
                  onClick={() => handleAnswerQuestion(question.id)}
                  className="px-3 py-1.5 bg-theme-accent-primary text-white rounded hover:bg-theme-accent-primary/80"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setAnsweringQuestion(question.id)}
                  className="text-xs px-3 py-1.5 bg-theme-accent-primary/20 text-theme-accent-primary rounded hover:bg-theme-accent-primary/30"
                >
                  Reply
                </button>
                <button
                  onClick={() => handleDismissQuestion(question.id)}
                  className="text-xs px-3 py-1.5 bg-theme-bg-secondary rounded hover:bg-theme-bg-primary text-theme-text-muted"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-theme-border bg-theme-bg-tertiary">
        <button
          onClick={() => setIsDismissed(true)}
          className="w-full text-xs text-theme-text-muted hover:text-theme-text-secondary py-1"
        >
          Hide for now
        </button>
      </div>
    </div>
  );
}
