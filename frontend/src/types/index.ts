export interface Participant {
  id: string;
  videoRef: React.RefObject<HTMLVideoElement> | null;
  isLocal: boolean;
  hasVideo: boolean;
  videoStream: MediaStream | null;
  screenStream: MediaStream | null;
  name: string;
  isSpeaking?: boolean;
} 