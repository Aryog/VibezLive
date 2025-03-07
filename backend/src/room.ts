import * as mediasoup from 'mediasoup';
import { config } from './config';

export class Room {
	private router?: mediasoup.types.Router;
	private producers = new Map<string, mediasoup.types.Producer>();
	private consumers = new Map<string, mediasoup.types.Consumer[]>();
	private transports = new Map<string, mediasoup.types.WebRtcTransport>();
	private senderTransports = new Map<string, mediasoup.types.WebRtcTransport>();
	private receiverTransports = new Map<string, mediasoup.types.WebRtcTransport>();

	constructor(
		public readonly id: string,
		private worker: mediasoup.types.Worker
	) { }

	async createRouter() {
		this.router = await this.worker.createRouter({
			mediaCodecs: config.mediaCodecs
		});
		return this.router;
	}

	async getRtpCapabilities() {
		if (!this.router) {
			await this.createRouter();
		}
		return this.router!.rtpCapabilities;
	}

	async createWebRtcTransport(socketId: string, sender: boolean) {
		const transport = await this.router!.createWebRtcTransport({
			...config.webRtcTransport,
			enableUdp: true,
			enableTcp: true,
			preferUdp: true,
		});

		// Store the transport based on type
		if (sender) {
			this.senderTransports.set(socketId, transport);
		} else {
			this.receiverTransports.set(socketId, transport);
		}

		transport.on('dtlsstatechange', (dtlsState) => {
			if (dtlsState === 'closed') {
				transport.close();
				if (sender) {
					this.senderTransports.delete(socketId);
				} else {
					this.receiverTransports.delete(socketId);
				}
			}
		});

		transport.on('close', () => {
			console.log('transport closed');
			if (sender) {
				this.senderTransports.delete(socketId);
			} else {
				this.receiverTransports.delete(socketId);
			}
		});

		return {
			id: transport.id,
			iceParameters: transport.iceParameters,
			iceCandidates: transport.iceCandidates,
			dtlsParameters: transport.dtlsParameters,
		};
	}

	async connectTransport(socketId: string, dtlsParameters: mediasoup.types.DtlsParameters, sender: boolean) {
		const transport = sender
			? this.senderTransports.get(socketId)
			: this.receiverTransports.get(socketId);

		if (!transport) {
			throw new Error(`transport not found for socket ${socketId}`);
		}

		await transport.connect({ dtlsParameters });
	}

	async produce(socketId: string, kind: string, rtpParameters: mediasoup.types.RtpParameters) {
		const transport = this.senderTransports.get(socketId);
		if (!transport) {
			throw new Error(`sender transport not found for socket ${socketId}`);
		}

		const producer = await transport.produce({ kind, rtpParameters });
		this.producers.set(producer.id, producer);

		producer.on('transportclose', () => {
			console.log('transport closed so producer closed');
			producer.close();
			this.producers.delete(producer.id);
		});

		return producer.id;
	}

	async consume(socketId: string, producerId: string, rtpCapabilities: mediasoup.types.RtpCapabilities) {
		if (!this.router!.canConsume({ producerId, rtpCapabilities })) {
			throw new Error('cannot consume');
		}

		const transport = this.receiverTransports.get(socketId);
		if (!transport) {
			throw new Error(`receiver transport not found for socket ${socketId}`);
		}

		const consumer = await transport.consume({
			producerId,
			rtpCapabilities,
			paused: true, // Start paused and resume after handling 'resume' event
		});

		consumer.on('transportclose', () => {
			console.log('consumer transport closed');
			this.consumers.get(socketId)?.filter(c => c.id !== consumer.id);
		});

		consumer.on('producerclose', () => {
			console.log('consumer producer closed');
			this.consumers.get(socketId)?.filter(c => c.id !== consumer.id);
		});

		const existingConsumers = this.consumers.get(socketId) || [];
		this.consumers.set(socketId, [...existingConsumers, consumer]);

		return {
			id: consumer.id,
			producerId,
			kind: consumer.kind,
			rtpParameters: consumer.rtpParameters,
			type: consumer.type,
			producerPaused: consumer.producerPaused
		};
	}

	async resumeConsumer(socketId: string, consumerId: string) {
		const consumers = this.consumers.get(socketId);
		const consumer = consumers?.find(c => c.id === consumerId);
		if (!consumer) {
			throw new Error(`consumer not found for socket ${socketId}`);
		}
		await consumer.resume();
	}

	getProducerIds() {
		return Array.from(this.producers.keys());
	}

	closeProducer(socketId: string) {
		const producer = this.producers.get(socketId);
		if (!producer) return;

		producer.close();
		this.producers.delete(socketId);
	}

	closeConsumers(socketId: string) {
		const consumers = this.consumers.get(socketId);
		if (!consumers) return;

		consumers.forEach(consumer => consumer.close());
		this.consumers.delete(socketId);
	}

	closeTransport(socketId: string) {
		const senderTransport = this.senderTransports.get(socketId);
		if (senderTransport) {
			senderTransport.close();
			this.senderTransports.delete(socketId);
		}

		const receiverTransport = this.receiverTransports.get(socketId);
		if (receiverTransport) {
			receiverTransport.close();
			this.receiverTransports.delete(socketId);
		}
	}

	close() {
		this.transports.forEach(transport => transport.close());
		this.producers.forEach(producer => producer.close());
		this.consumers.forEach(consumers => consumers.forEach(consumer => consumer.close()));
		this.router?.close();
	}
}
