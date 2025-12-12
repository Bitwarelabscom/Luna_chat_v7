/**
 * Display types for Luna-controlled content in Trading Dashboard
 */

export interface ChartDisplay {
  type: 'chart';
  symbol: string;
}

export interface YouTubeDisplay {
  type: 'youtube';
  videoId: string;
  title?: string;
  channel?: string;
}

export interface WebsiteDisplay {
  type: 'website';
  url: string;
  title?: string;
}

export type DisplayContent = ChartDisplay | YouTubeDisplay | WebsiteDisplay;
