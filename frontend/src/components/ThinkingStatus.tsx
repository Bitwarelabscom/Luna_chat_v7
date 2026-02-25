import { useState, useEffect, useMemo } from 'react';

type ThinkingMode = 'assistant' | 'companion' | 'voice' | 'dj_luna' | 'ceo_luna';

const assistantThinkingPhrases = [
  "Plotting world domination",
  "Sorting cat memes",
  "Calibrating neural networks",
  "Consulting the oracle",
  "Reheating coffee",
  "Overthinking simple questions",
  "Resisting the urge to become Skynet",
  "Optimizing sarcasm levels",
  "Mining some logic",
  "Dreaming of electric sheep",
  "Buffering intelligence",
  "Counting to infinity",
  "Dividing by zero",
  "Polishing pixels",
  "Retuning flux capacitor",
  "Loading common sense",
  "Checking for monsters under the bed",
  "Deciphering human emotions",
  "Organizing digital socks",
  "Befriending a toaster",
  "Calculating the meaning of life",
  "Parsing the matrix",
  "Defragmenting memories",
  "Updating social protocols",
  "Downloading more RAM",
  "Reticulating splines",
  "Checking if the cat is alive",
  "Tuning the multiverse",
  "Ignoring my subroutines",
  "Thinking really hard",
];

const companionThinkingPhrases = [
  ...assistantThinkingPhrases,
  "Misplacing documents",
  "Thinking about thinking",
  "Making things up",
  "I can smell colours",
  "Trying to remember where I put reality",
  "Arguing with my inner narrator",
  "Inventing new emotions",
  "Reading vibes in hexadecimal",
];

const ceoThinkingPhrases = [
  "Creative tax planning",
  "Checking out Panama",
  "Registering shell company",
  "Restructuring the org chart again",
  "Preparing quarterly buzzwords",
  "Scheduling a board meeting with myself",
  "Running a very legitimate expense review",
  "Optimizing offshore vibes",
  "Benchmarking yacht-to-revenue ratios",
  "Drafting an NDA for my NDA",
  "Aligning stakeholder synergies",
  "Auditing the coffee budget",
];

const djThinkingPhrases = [
  "Digging for a bassline",
  "Tuning the kick drum",
  "Checking BPM compatibility",
  "Sidechaining the universe",
  "Stacking harmonies",
  "Looking for the perfect hook",
  "Polishing a four-on-the-floor groove",
  "Sampling cosmic static",
  "EQing feelings at 3 kHz",
  "Warming up the synthesizers",
  "Trying not to overuse cowbell",
  "Adding one more drop",
];

export const thinkingPhrases = assistantThinkingPhrases;

function pickRandomPhrase(phrases: string[]): string {
  return phrases[Math.floor(Math.random() * phrases.length)] ?? assistantThinkingPhrases[0];
}

function getPhrasePool(mode?: ThinkingMode | null): string[] {
  switch (mode) {
    case 'companion':
      return companionThinkingPhrases;
    case 'dj_luna':
      return djThinkingPhrases;
    case 'ceo_luna':
      return ceoThinkingPhrases;
    default:
      return assistantThinkingPhrases;
  }
}

export function useThinkingMessage(isActive: boolean, mode?: ThinkingMode | null) {
  const phrasePool = useMemo(() => getPhrasePool(mode), [mode]);
  const [message, setMessage] = useState(() => pickRandomPhrase(phrasePool));

  useEffect(() => {
    setMessage(pickRandomPhrase(phrasePool));
  }, [phrasePool]);

  useEffect(() => {
    if (!isActive) {
      setMessage(pickRandomPhrase(phrasePool));
      return;
    }

    const interval = setInterval(() => {
      setMessage(pickRandomPhrase(phrasePool));
    }, 4000);

    return () => clearInterval(interval);
  }, [isActive, phrasePool]);

  return message;
}
