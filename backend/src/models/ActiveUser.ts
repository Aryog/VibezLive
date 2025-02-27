import mongoose, { Document, Schema } from 'mongoose';

export interface IActiveUser extends Document {
  userId: string;
  roomId: string | null;
  isActive: boolean;
  joinedAt: Date;
  lastActiveAt: Date;
}

const ActiveUserSchema: Schema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    roomId: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'joinedAt', updatedAt: 'lastActiveAt' } }
);

// Index for efficient queries
ActiveUserSchema.index({ userId: 1 });
ActiveUserSchema.index({ roomId: 1 });
ActiveUserSchema.index({ isActive: 1 });

export default mongoose.model<IActiveUser>('ActiveUser', ActiveUserSchema);
