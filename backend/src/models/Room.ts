import mongoose, { Document, Schema } from 'mongoose';

export interface IRoom extends Document {
	name: string;
	description?: string;
	createdBy: mongoose.Types.ObjectId;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
	participantCount: number;
	maxParticipants: number;
	isPublic: boolean;
	password?: string;
}

const RoomSchema: Schema = new Schema(
	{
		_id: {
			type: String,
			required: true
		},
		name: { type: String, required: true, trim: true },
		description: { type: String, trim: true },
		createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		isActive: { type: Boolean, default: true },
		participantCount: { type: Number, default: 0 },
		maxParticipants: { type: Number, default: 50 },
		isPublic: { type: Boolean, default: true },
		password: { type: String },
	},
	{ timestamps: true }
);

const Room = mongoose.model<IRoom>('Room', RoomSchema);

export default Room;
