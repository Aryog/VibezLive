import React from 'react';

export interface Peer {
  id: string;
  videoStream?: MediaStream;
  audioStream?: MediaStream;
  screenStream?: MediaStream;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
}
