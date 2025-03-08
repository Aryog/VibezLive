import * as mediasoup from 'mediasoup';
import { config } from './config.js';

// Add type for error handling
interface MediasoupError extends Error {
	message: string;
}

export class Room {
	private router?: mediasoup.types.Router;
	private producers = new Map<string, mediasoup.types.Producer>();
	private consumers = new Map<string, mediasoup.types.Consumer[]>();
	private transports = new Map<string, mediasoup.types.WebRtcTransport>();
	private senderTransports = new Map<string, mediasoup.types.WebRtcTransport>();
	private receiverTransports = new Map<string, mediasoup.types.WebRtcTransport>();
	private producerToSocketId = new Map<string, string>();

	constructor(
		public readonly id: string,
		private worker: mediasoup.types.Worker
	) { }

	async createRouter() {
		this.router = await this.worker.createRouter({
			mediaCodecs: [...config.mediaCodecs] // Convert readonly array to mutable
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
			// Convert readonly array to mutable
			listenIps: [...config.webRtcTransport.listenIps]
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

		transport.on('@close', () => {
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

		const producer = await transport.produce({ kind: kind as mediasoup.types.MediaKind, rtpParameters });
		this.producers.set(producer.id, producer);
		this.producerToSocketId.set(producer.id, socketId);

		producer.on('transportclose', () => {
			console.log('transport closed so producer closed');
			producer.close();
			this.producers.delete(producer.id);
			this.producerToSocketId.delete(producer.id);
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
			peerId: this.getProducerPeerId(producerId),
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
		// Find all producers belonging to this socket
		for (const [producerId, producer] of this.producers.entries()) {
			const producerSocketId = this.producerToSocketId.get(producerId);
			if (producerSocketId === socketId) {
				producer.close();
				this.producers.delete(producerId);
				this.producerToSocketId.delete(producerId);
			}
		}
	}

	closeConsumers(socketId: string) {
		const consumers = this.consumers.get(socketId);
		if (!consumers) return;

		consumers.forEach(consumer => {
			consumer.close();
			// Also remove the consumer from any other maps/references
			this.consumers.get(socketId)?.filter(c => c.id !== consumer.id);
		});
		
		this.consumers.delete(socketId);
	}

	closeTransport(socketId: string) {
		console.log(`Closing transports for peer ${socketId}`);
		
		// Close and remove sender transport
		const senderTransport = this.senderTransports.get(socketId);
		if (senderTransport) {
			console.log(`Closing sender transport for ${socketId}`);
			senderTransport.close();
			this.senderTransports.delete(socketId);
		}

		// Close and remove receiver transport
		const receiverTransport = this.receiverTransports.get(socketId);
		if (receiverTransport) {
			console.log(`Closing receiver transport for ${socketId}`);
			receiverTransport.close();
			this.receiverTransports.delete(socketId);
		}

		// Remove from general transports map if it exists
		const transport = this.transports.get(socketId);
		if (transport) {
			console.log(`Closing general transport for ${socketId}`);
			transport.close();
			this.transports.delete(socketId);
		}
	}

	disconnectPeer(socketId: string) {
		console.log(`Disconnecting peer ${socketId} from room ${this.id}`);
		
		// Close all producers for this peer
		this.closeProducer(socketId);
		
		// Close all consumers for this peer
		this.closeConsumers(socketId);
		
		// Close all transports for this peer
		this.closeTransport(socketId);
	}

	close() {
		this.transports.forEach(transport => transport.close());
		this.producers.forEach(producer => producer.close());
		this.consumers.forEach(consumers => consumers.forEach(consumer => consumer.close()));
		this.router?.close();
	}

	private getProducerPeerId(producerId: string): string {
		const socketId = this.producerToSocketId.get(producerId);
		if (!socketId) {
			throw new Error(`No peer found for producer ${producerId}`);
		}
		return socketId;
	}

	getProducersInfo() {
		const producersInfo = [];
		for (const [producerId, producer] of this.producers.entries()) {
			const socketId = this.producerToSocketId.get(producerId);
			if (socketId) {
				producersInfo.push({
					producerId: producerId,
					peerId: socketId,
					kind: producer.kind
				});
			}
		}
		return producersInfo;
	}

	isEmpty(): boolean {
		const empty = this.senderTransports.size === 0 && 
					 this.receiverTransports.size === 0 && 
					 this.producers.size === 0 && 
					 this.consumers.size === 0;
		
		console.log(`Room ${this.id} isEmpty check:`, {
			senderTransports: this.senderTransports.size,
			receiverTransports: this.receiverTransports.size,
			producers: this.producers.size,
			consumers: this.consumers.size,
			isEmpty: empty
		});
		
		return empty;
	}
}
