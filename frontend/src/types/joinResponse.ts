export interface JoinResponse {
  existingProducers?: Array<{
    producerId: string;
    username: string;
  }>;
  // Add other properties as needed
} 