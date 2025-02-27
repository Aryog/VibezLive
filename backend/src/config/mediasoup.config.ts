import os from 'os';
import { RtpCodecCapability } from 'mediasoup/node/lib/rtpParametersTypes';
import { WorkerLogLevel, WorkerLogTag } from 'mediasoup/node/lib/WorkerTypes';

const numCPUs = os.cpus().length;

interface ListenIp {
  ip: string;
  announcedIp?: string;
}

interface MediasoupConfig {
  worker: {
    rtcMinPort: number;
    rtcMaxPort: number;
    logLevel: WorkerLogLevel;
    logTags: WorkerLogTag[];
    numWorkers?: number;
  };
  router: {
    mediaCodecs: RtpCodecCapability[];
  };
  webRtcTransport: {
    listenIps: ListenIp[];
    initialAvailableOutgoingBitrate: number;
    minimumAvailableOutgoingBitrate?: number;
    maxIncomingBitrate?: number;
    maxSctpMessageSize?: number;
  };
}

const config: MediasoupConfig = {
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 59999,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
      'rtx',
      'bwe',
      'score',
      'simulcast',
      'svc',
      'sctp'
    ],
    numWorkers: numCPUs
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1', // replace with your public IP
      },
    ],
    initialAvailableOutgoingBitrate: 1000000,
  },
};

export { config as mediasoupConfig };
