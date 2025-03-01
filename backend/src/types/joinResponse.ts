export interface JoinResponse {
  routerRtpCapabilities: any;
  existingProducers: Array<{
    producerId: string;
    username: string;
    kind: string;
  }>;
  consumerTransportId: string;
} 