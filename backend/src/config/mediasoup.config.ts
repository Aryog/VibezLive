// Load RTC port configuration from environment
const RTC_MIN_PORT = parseInt(process.env.RTC_MIN_PORT || '40000');
const RTC_MAX_PORT = parseInt(process.env.RTC_MAX_PORT || '49999');
const ANNOUNCED_IP = process.env.ANNOUNCED_IP || '127.0.0.1';

export const config = {
	worker: {
		rtcMinPort: RTC_MIN_PORT,
		rtcMaxPort: RTC_MAX_PORT,
		logLevel: 'warn' as const,
	},
	mediaCodecs: [
		{
			kind: 'audio' as const,
			mimeType: 'audio/opus',
			clockRate: 48000,
			channels: 2
		},
		{
			kind: 'video' as const,
			mimeType: 'video/VP8',
			clockRate: 90000,
			parameters: {
				'x-google-start-bitrate': 1000
			}
		},
		{
			kind: 'video' as const,
			mimeType: 'video/H264',
			clockRate: 90000,
			parameters: {
				'packetization-mode': 1,
				'profile-level-id': '4d0032',
				'level-asymmetry-allowed': 1,
				'x-google-start-bitrate': 1000
			}
		}
	],
	webRtcTransport: {
		listenIps: [
			{
				ip: '0.0.0.0',
				announcedIp: ANNOUNCED_IP
			}
		],
		initialAvailableOutgoingBitrate: 1000000,
		maxIncomingBitrate: 1500000
	}
} as const;
