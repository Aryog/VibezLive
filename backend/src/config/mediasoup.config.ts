export const config = {
	mediaCodecs: [
		{
			kind: 'audio',
			mimeType: 'audio/opus',
			clockRate: 48000,
			channels: 2
		},
		{
			kind: 'video',
			mimeType: 'video/VP8',
			clockRate: 90000,
			parameters: {
				'x-google-start-bitrate': 1000
			}
		},
		{
			kind: 'video',
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
				announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1'
			}
		],
		initialAvailableOutgoingBitrate: 1000000
	}
} as const;
