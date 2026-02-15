import { useState, useEffect } from 'react';

export const thinkingPhrases = [
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

export function useThinkingMessage(isActive: boolean) {
  const [message, setMessage] = useState(thinkingPhrases[0]);

  useEffect(() => {
    if (!isActive) {
      setMessage(thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)]);
      return;
    }

    const interval = setInterval(() => {
      setMessage(thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)]);
    }, 4000);

    return () => clearInterval(interval);
  }, [isActive]);

  return message;
}
